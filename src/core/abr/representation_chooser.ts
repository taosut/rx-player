/**
 * Copyright 2015 CANAL+ Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import objectAssign from "object-assign";
import {
  BehaviorSubject,
  combineLatest as observableCombineLatest,
  Observable,
  of as observableOf,
  Subject,
} from "rxjs";
import {
  distinctUntilChanged,
  filter,
  map,
  startWith,
  switchMap,
  takeUntil,
} from "rxjs/operators";
import log from "../../log";
import {
  ISegment,
  Representation,
} from "../../manifest";
import { IBufferType } from "../source_buffers";
import BufferBasedChooser from "./buffer_based_chooser";
import EWMA from "./ewma";
import filterByBitrate from "./filter_by_bitrate";
import filterByWidth from "./filter_by_width";
import fromBitrateCeil from "./from_bitrate_ceil";
import ThroughputChooser from "./throughput_chooser";

import { getLeftSizeOfRange } from "../../utils/ranges";

// Adaptive BitRate estimation object
export interface IABREstimation {
  bitrate: undefined|number; // If defined, the currently calculated bitrate
  manual: boolean; // True if the representation choice was manually dictated
                   // by the user
  representation: Representation; // The chosen representation
  urgent : boolean; // True if current downloads should be canceled to
                    // download the one of the chosen Representation
                    // immediately
                    // False if we can chose to wait for the current
                    // download(s) to finish before switching.
  lastStableBitrate?: number;
}

interface IRepresentationChooserClockTick {
  downloadBitrate : number|undefined; // bitrate of the currently downloaded
                                      // segments, in bit per seconds
  bufferGap : number; // time to the end of the buffer, in seconds
  currentTime : number; // current position, in seconds
  speed : number; // current playback rate
  duration : number; // whole duration of the content
}

interface IProgressEventValue {
  duration : number; // current duration for the request, in ms
  id: string|number; // unique ID for the request
  size : number; // current downloaded size, in bytes
  timestamp : number; // timestamp of the progress event since unix epoch, in ms
  totalSize : number; // total size to download, in bytes
}

type IRequest = IProgressRequest | IBeginRequest | IEndRequest;

interface IProgressRequest {
  type: IBufferType;
  event: "progress";
  value: IProgressEventValue;
}

interface IBeginRequest {
  type: IBufferType;
  event: "requestBegin";
  value: {
    id: string|number;
    time: number;
    duration: number;
    requestTimestamp: number;
  };
}

interface IEndRequest {
  type: IBufferType;
  event: "requestEnd";
  value: {
    id: string|number;
  };
}

interface IFilters {
  bitrate?: number;
  width?: number;
}

// Event emitted each time the current Representation considered changes
interface IBufferEventRepresentationChange {
  type : "representation-buffer-change";
  value : {
    representation : Representation;
  };
}

// Event emitted each time a segment is added
interface IBufferEventAddedSegment {
  type : "added-segment";
  value : {
    bufferGap : number; // Actualization of the buffer gap
  };
}

// Buffer events needed by the ABRManager
export type IABRBufferEvents =
  IBufferEventRepresentationChange |
  IBufferEventAddedSegment;

interface IRepresentationChooserOptions {
  limitWidth$?: Observable<number>; // Emit maximum useful width
  throttle$?: Observable<number>; // Emit temporary bandwidth throttle
  initialBitrate?: number; // The initial wanted bitrate
  manualBitrate?: number; // A bitrate set manually
  maxAutoBitrate?: number; // The maximum bitrate we should set in adaptive mode
}

interface IBeginRequest {
  type: IBufferType;
  event: "requestBegin";
  value: {
    id: string|number;
    time: number;
    duration: number;
    requestTimestamp: number;
  };
}

interface IProgressRequest {
  type: IBufferType;
  event: "progress";
  value: IProgressEventValue;
}

/**
 * Get the pending request starting with the asked segment position.
 * @param {Object} requests
 * @param {number} position
 * @returns {IRequestInfo|undefined}
 */
function getConcernedRequest(
  requests : Partial<Record<string, IRequestInfo>>,
  neededPosition : number
) : IRequestInfo|undefined {
  const currentRequestIds = Object.keys(requests);
  const len = currentRequestIds.length;

  for (let i = 0; i < len; i++) {
    const request = requests[currentRequestIds[i]];
    if (request != null && request.duration > 0) {
      const segmentEnd = request.time + request.duration;
      if (segmentEnd > neededPosition && neededPosition - request.time > -0.3) {
        return request;
      }
    }
  }
}

/**
 * Filter representations given through filters options.
 * @param {Array.<Representation>} representations
 * @param {Object} filters - Filter Object.
 * _Can_ contain each of the following properties:
 *   - bitrate {Number} - max bitrate authorized (included).
 *   - width {Number} - max width authorized (included).
 * @returns {Array.<Representation>}
 */
function getFilteredRepresentations(
  representations : Representation[],
  filters : IFilters
) : Representation[] {
  let _representations = representations;

  if (filters.bitrate != null) {
    _representations = filterByBitrate(_representations, filters.bitrate);
  }

  if (filters.width != null) {
    _representations = filterByWidth(_representations, filters.width);
  }

  return _representations;
}

function createDeviceEvents(
  limitWidth$ : Observable<number>|undefined,
  throtthleBitrate$ : Observable<number>|undefined
) : Observable<IFilters> {
  const _deviceEventsArray : Array<Observable<IFilters>> = [];
  if (limitWidth$) {
    _deviceEventsArray.push(
      limitWidth$.pipe(map(width => ({ width })))
    );
  }
  if (throtthleBitrate$) {
    _deviceEventsArray.push(
      throtthleBitrate$.pipe(map(bitrate => ({ bitrate })))
    );
  }
  return _deviceEventsArray.length ?
    observableCombineLatest(..._deviceEventsArray)
      .pipe(map((args : IFilters[]) => objectAssign({}, ...args))) :
    observableOf({});
}

interface IRequestInfo {
  duration : number; // duration of the corresponding chunk, in seconds
  progress: IProgressEventValue[]; // progress events for this request
  requestTimestamp: number; // unix timestamp at which the request began, in ms
  time: number; // time at which the corresponding segment begins, in seconds
}

interface IProgressEventValue {
  duration : number; // current duration for the request, in ms
  id: string|number; // unique ID for the request
  size : number; // current downloaded size, in bytes
  timestamp : number; // timestamp of the progress event since unix epoch, in ms
  totalSize : number; // total size to download, in bytes
}

/**
 * Estimate the __VERY__ recent bandwidth based on a single unfinished request.
 * Useful when the current bandwidth seemed to have fallen quickly.
 *
 * @param {Object} request
 * @returns {number|undefined}
 */
function estimateRequestBandwidth(request : IRequestInfo) : number|undefined {
  if (request.progress.length < 2) {
    return undefined;
  }

  // try to infer quickly the current bitrate based on the
  // progress events
  const ewma1 = new EWMA(2);
  const { progress } = request;
  for (let i = 1; i < progress.length; i++) {
    const bytesDownloaded = progress[i].size - progress[i - 1].size;
    const timeElapsed = progress[i].timestamp - progress[i - 1].timestamp;
    const reqBitrate = (bytesDownloaded * 8) / (timeElapsed / 1000);
    ewma1.addSample(timeElapsed / 1000, reqBitrate);
  }
  return ewma1.getEstimate();
}

/**
 * Estimate remaining time for a pending request from a progress event.
 * @param {Object} lastProgressEvent
 * @param {number} bandwidthEstimate
 * @returns {number}
 */
function estimateRemainingTime(
  lastProgressEvent: IProgressEventValue,
  bandwidthEstimate : number
) : number {
  const remainingData = (lastProgressEvent.totalSize - lastProgressEvent.size) * 8;
  return Math.max(remainingData / bandwidthEstimate, 0);
}

/**
 * Check if the request for the most needed segment is too slow.
 * If that's the case, re-calculate the bandwidth urgently based on
 * this single request.
 * @param {Object} pendingRequests - Current pending requests.
 * @param {Object} clock - Informations on the current playback.
 * @param {Number} lastEstimatedBitrate - Last bitrate estimation emitted.
 * @returns {Number|undefined}
 */
function estimateStarvationModeBitrate(
  pendingRequests : Partial<Record<string, IRequestInfo>>,
  clock : IRepresentationChooserClockTick,
  lastEstimatedBitrate : number|undefined
) : number|undefined {
  const nextNeededPosition = clock.currentTime + clock.bufferGap;
  const concernedRequest = getConcernedRequest(pendingRequests, nextNeededPosition);
  if (!concernedRequest) {
    return undefined;
  }

  const chunkDuration = concernedRequest.duration;
  const now = performance.now();
  const lastProgressEvent = concernedRequest.progress ?
    concernedRequest.progress[concernedRequest.progress.length - 1] :
    null;

  // first, try to do a quick estimate from progress events
  const bandwidthEstimate = estimateRequestBandwidth(concernedRequest);
  if (lastProgressEvent != null && bandwidthEstimate != null) {
    const remainingTime =
      estimateRemainingTime(lastProgressEvent, bandwidthEstimate) * 1.2;

    // if this remaining time is reliable and is not enough to avoid buffering
    if (
      (now - lastProgressEvent.timestamp) / 1000 <= remainingTime &&
      remainingTime > (clock.bufferGap / clock.speed)
    ) {
      return bandwidthEstimate;
    }
  }

  const requestElapsedTime = (now - concernedRequest.requestTimestamp) / 1000;
  const currentBitrate = clock.downloadBitrate;
  if (
    currentBitrate == null ||
    requestElapsedTime <= ((chunkDuration * 1.5 + 1) / clock.speed)
  ) {
    return undefined;
  }

  // calculate a reduced bitrate from the current one
  const reducedBitrate = currentBitrate * 0.7;
  if (lastEstimatedBitrate == null || reducedBitrate < lastEstimatedBitrate) {
    return reducedBitrate;
  }
}

/**
 * Choose the right Representation thanks to "choosers":
 *
 * - The throughput chooser choose the Representation relatively to the current
 *   user's bandwidth.
 *
 * - The buffer-based chooser choose the Representation relatively to the
 *   current size of the buffer.
 *
 * To have more control over which Representation should be choosen, you can
 * also use the following exposed subjects:
 *
 *   - manualBitrate$ {Subject}: Set the bitrate manually, if no representation
 *     is found with the given bitrate. An immediately inferior one will be
 *     taken instead. If still, none are found, the representation with the
 *     minimum bitrate will be taken.
 *     Set it to a negative value to go into automatic bitrate mode.
 *
 *   - maxBitrate$ {Subject}: Set the maximum automatic bitrate. If the manual
 *     bitrate is not set / set to a negative value, this will be the maximum
 *     switch-able bitrate. If no representation is found inferior or equal to
 *     this bitrate, the representation with the minimum bitrate will be taken.
 *
 * @class RepresentationChooser
 */
export default class RepresentationChooser {
  public readonly manualBitrate$ : BehaviorSubject<number>;
  public readonly maxAutoBitrate$ : BehaviorSubject<number>;

  private readonly _dispose$ : Subject<void>;
  private readonly _limitWidth$ : Observable<number>|undefined;
  private readonly _throttle$ : Observable<number>|undefined;
  private readonly _throughputChooser : ThroughputChooser;
  private _currentRequests: Partial<Record<string, IRequestInfo>>;

  /**
   * Score estimator for the current Representation.
   * null when no representation has been chosen yet.
   * @type {BehaviorSubject}
   */
  private _scoreEstimator : EWMA|null;

  /**
   * @param {Object} options
   */
  constructor(options : IRepresentationChooserOptions) {
    this._throughputChooser = new ThroughputChooser(options.initialBitrate || 0);

    this._dispose$ = new Subject();
    this._scoreEstimator = null;

    this.manualBitrate$ = new BehaviorSubject(
      options.manualBitrate != null ? options.manualBitrate : -1);

    this.maxAutoBitrate$ = new BehaviorSubject(
      options.maxAutoBitrate != null ? options.maxAutoBitrate : Infinity);

    this._limitWidth$ = options.limitWidth$;
    this._throttle$ = options.throttle$;
  }

  public get$(
    representations : Representation[],
    clock$: Observable<IRepresentationChooserClockTick>,
    bufferEvents$ : Observable<IABRBufferEvents>
  ): Observable<IABREstimation> {
    if (!representations.length) {
      throw new Error("ABRManager: no representation choice given");
    }
    if (representations.length === 1) {
      return observableOf({
        bitrate: undefined, // Bitrate estimation is deactivated here
        representation: representations[0],
        manual: false,
        urgent: true,
        lastStableBitrate: undefined,
      });
    }
    const { manualBitrate$, maxAutoBitrate$ }  = this;
    const deviceEvents$ = createDeviceEvents(this._limitWidth$, this._throttle$);

    let currentRepresentation : Representation|null|undefined;
    bufferEvents$.pipe(
      filter((evt) : evt is IBufferEventRepresentationChange =>
        evt.type === "representation-buffer-change"
      ),
      takeUntil(this._dispose$)
    ).subscribe(evt => {
      currentRepresentation = evt.value.representation;
      this._scoreEstimator = null; // reset the score
    });

    return manualBitrate$.pipe(switchMap(manualBitrate => {
      if (manualBitrate >= 0) {
        // -- MANUAL mode --
        return observableOf({
          representation: fromBitrateCeil(representations, manualBitrate) ||
            representations[0],

          bitrate: undefined, // Bitrate estimation is deactivated here
          lastStableBitrate: undefined,
          manual: true,
          urgent: true, // a manual bitrate switch should happen immediately
        });
      }

      // -- AUTO mode --
      let lastEstimatedBitrate: number|undefined;
      let forceBandwidthMode = true;

      // Emit each time a buffer-based estimation should be actualized.
      // (basically, each time a segment is added)
      const updateBufferEstimation$ = bufferEvents$.pipe(
        filter((evt) : evt is IBufferEventAddedSegment =>
          evt.type === "added-segment"
        ),
        map((addedSegmentEvt) => {
          const currentScore = this._scoreEstimator == null ?
            undefined : this._scoreEstimator.getEstimate();
          return {
            bufferGap: addedSegmentEvt.value.bufferGap,
            currentRepresentation,
            currentScore,
          };
        })
      );
      const bufferBasedEstimation$ =
        BufferBasedChooser(updateBufferEstimation$, representations);

      return observableCombineLatest(
        clock$,
        maxAutoBitrate$,
        deviceEvents$,
        bufferBasedEstimation$.pipe(startWith(undefined))
      ).pipe(
        map(([
          clock,
          maxAutoBitrate,
          deviceEvents,
          chosenRepFromBufferBasedABR,
        ]): IABREstimation => {
          const _representations =
            getFilteredRepresentations(representations, deviceEvents);

          const {
            bandwidthEstimate,
            representation: chosenRepFromBandwidth,
          } = this._throughputChooser.getBandwidthEstimate(
            _representations, clock, maxAutoBitrate, lastEstimatedBitrate);
          lastEstimatedBitrate = bandwidthEstimate;

          const { bufferGap } = clock;
          if (!forceBandwidthMode && bufferGap <= 5) {
            forceBandwidthMode = true;
          } else if (Number.isFinite(bufferGap) && bufferGap > 10) {
            forceBandwidthMode = false;
          }

          const videal = document.querySelector("video");
          console.log(
            "!!! MODE",
            forceBandwidthMode,
            this._scoreEstimator && this._scoreEstimator.getEstimate(),
            videal && getLeftSizeOfRange(videal.buffered, videal.currentTime)
          );

          let lastStableBitrate : number|undefined;
          if (this._scoreEstimator) {
            if (currentRepresentation == null) {
              lastStableBitrate = lastStableBitrate;
            } else {
              lastStableBitrate = this._scoreEstimator.getEstimate() > 1 ?
                currentRepresentation.bitrate : lastStableBitrate;
            }
          }

          if (forceBandwidthMode) {
            return {
              bitrate: bandwidthEstimate,
              representation: chosenRepFromBandwidth,
              urgent: this._throughputChooser
                .isUrgent(chosenRepFromBandwidth.bitrate, clock),
              manual: false,
              lastStableBitrate,
            };
          }

          if (
            chosenRepFromBufferBasedABR == null ||
            chosenRepFromBandwidth.bitrate >= chosenRepFromBufferBasedABR.bitrate
          ) {
            return {
              bitrate: bandwidthEstimate,
              representation: chosenRepFromBandwidth,
              urgent: this._throughputChooser
                .isUrgent(chosenRepFromBandwidth.bitrate, clock),
              manual: false,
              lastStableBitrate,
            };
          }
          return {
            bitrate: bandwidthEstimate,
            representation: chosenRepFromBufferBasedABR,
            urgent: this._throughputChooser.isUrgent(
              chosenRepFromBufferBasedABR.bitrate, clock),
            manual: false,
            lastStableBitrate,
          };
        }),
        distinctUntilChanged((a, b) => {
          return a.representation.id === b.representation.id &&
            b.lastStableBitrate === a.lastStableBitrate;
        }),
        takeUntil(this._dispose$)
      );
    }));
  }

  /**
   * Add bandwidth and "maintainability score" estimate by giving:
   *   - the duration of the request, in s
   *   - the size of the request in bytes
   *   - the content downloaded
   * @param {number} duration
   * @param {number} size
   * @param {Object} content
   */
  public addEstimate(
    duration : number,
    size : number,
    content: { segment: ISegment } // XXX TODO compare with current representation?
  ) : void {
    this._throughputChooser.addEstimate(duration, size); // calculate bandwidth

    // calculate "maintainability score"
    const { segment } = content;
    if (segment.duration == null) {
      return;
    }
    const requestDuration = duration / 1000;
    const segmentDuration = segment.duration / segment.timescale;
    const ratio = segmentDuration / requestDuration;

    if (this._scoreEstimator != null) {
      this._scoreEstimator.addSample(requestDuration, ratio);
      return;
    }
    const newEWMA = new EWMA(5);
    newEWMA.addSample(requestDuration, ratio);
    this._scoreEstimator = newEWMA;
  }

  /**
   * Add informations about a new pending request.
   * This can be useful if the network bandwidth drastically changes to infer
   * a new bandwidth through this single request.
   * @param {string|number} id
   * @param {Object} payload
   */
  public addPendingRequest(id : string|number, payload: IBeginRequest) : void {
    if (this._currentRequests[id]) {
      if (__DEV__) {
        throw new Error("ABR: request already added.");
      }
      log.warn("ABR: request already added.");
      return;
    }
    const { time, duration, requestTimestamp } = payload.value;
    this._currentRequests[id] = {
      time,
      duration,
      requestTimestamp,
      progress: [],
    };
  }

  /**
   * Add progress informations to a pending request.
   * Progress objects are a key part to calculate the bandwidth from a single
   * request, in the case the user's bandwidth changes drastically while doing
   * it.
   * @param {string|number} id
   * @param {Object} progress
   */
  public addRequestProgress(id : string|number, progress: IProgressRequest) : void {
    const request = this._currentRequests[id];
    if (!request) {
      if (__DEV__) {
        throw new Error("ABR: progress for a request not added");
      }
      log.warn("ABR: progress for a request not added");
      return;
    }
    request.progress.push(progress.value);
  }

  /**
   * Remove a request previously set as pending through the addPendingRequest
   * method.
   * @param {string|number} id
   */
  public removePendingRequest(id : string|number) : void {
    if (!this._currentRequests[id]) {
      if (__DEV__) {
        throw new Error("ABR: can't remove unknown request");
      }
      log.warn("ABR: can't remove unknown request");
    }
    delete this._currentRequests[id];
  }

  /**
   * Free up the resources used by the RepresentationChooser.
   */
  public dispose() : void {
    this._dispose$.next();
    this._dispose$.complete();
    this.manualBitrate$.complete();
    this.maxAutoBitrate$.complete();
    this._throughputChooser.dispose();
  }
}

export {
  IRequest,
  IRepresentationChooserClockTick,
  IRepresentationChooserOptions,
};

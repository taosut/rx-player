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
import { Representation } from "../../manifest";
import { IBufferType } from "../source_buffers";
import BufferBasedChooser, {
  ILoadSegmentEvent
} from "./buffer_based_chooser";
import filterByBitrate from "./filter_by_bitrate";
import filterByWidth from "./filter_by_width";
import fromBitrateCeil from "./from_bitrate_ceil";
import ThroughputChooser from "./throughput_chooser";

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

interface IRepresentationChooserOptions {
  limitWidth$?: Observable<number>; // Emit maximum useful width
  throttle$?: Observable<number>; // Emit temporary bandwidth throttle
  initialBitrate?: number; // The initial wanted bitrate
  manualBitrate?: number; // A bitrate set manually
  maxAutoBitrate?: number; // The maximum bitrate we should set in adaptive mode
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

/**
 * Choose the right representation thanks to choosers:
 * - The throughput chooser measures the current user's bandwidth.
 * - The buffer based chooser applies BOLA rule to pick a representation.
 *
 * The representation are filtered according to the chosen manual bitrate, the max
 * bitrate authorized and the size of the video element. Those parameters can be set
 * through different subjects and methods.
 * The subjects (undocumented here are):
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

  /**
   * @param {Object} options
   */
  constructor(options : IRepresentationChooserOptions) {
    this._throughputChooser = new ThroughputChooser(options.initialBitrate || 0);

    this._dispose$ = new Subject();

    this.manualBitrate$ = new BehaviorSubject(
      options.manualBitrate != null ?
      options.manualBitrate : -1
    );

    this.maxAutoBitrate$ = new BehaviorSubject(
      options.maxAutoBitrate != null ?
      options.maxAutoBitrate : Infinity
    );

    this._limitWidth$ = options.limitWidth$;
    this._throttle$ = options.throttle$;
  }

  public get$(
    clock$: Observable<IRepresentationChooserClockTick>,
    representations : Representation[],
    loadSegmentEvents$ : Subject<ILoadSegmentEvent>
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
    const _deviceEventsArray : Array<Observable<IFilters>> = [];

    if (this._limitWidth$) {
      _deviceEventsArray.push(
        this._limitWidth$
          .pipe(map(width => ({ width })))
      );
    }
    if (this._throttle$) {
      _deviceEventsArray.push(
        this._throttle$
          .pipe(map(bitrate => ({ bitrate })))
      );
    }

    // Emit restrictions on the pools of available representations to choose
    // from.
    const deviceEvents$ : Observable<IFilters> = _deviceEventsArray.length ?
      observableCombineLatest(..._deviceEventsArray)
        .pipe(map((args : IFilters[]) => objectAssign({}, ...args))) :
      observableOf({});

    return manualBitrate$.pipe(switchMap(manualBitrate => {
      if (manualBitrate >= 0) {
        // -- MANUAL mode --
        return observableOf({
          bitrate: undefined, // Bitrate estimation is deactivated here
          representation: fromBitrateCeil(representations, manualBitrate) ||
            representations[0],
          manual: true,
          urgent: true, // a manual bitrate switch should happen immediately
          lastStableBitrate: Infinity,
        });
      }

      // -- AUTO mode --
      let lastEstimatedBitrate: number|undefined;
      let lastEstimationMode: "bandwidth"|"BOLA"|undefined = "bandwidth";
      const bufferBasedEstimation$ =
        BufferBasedChooser(loadSegmentEvents$, representations);

      return observableCombineLatest(
        clock$,
        maxAutoBitrate$,
        deviceEvents$,
        bufferBasedEstimation$.pipe(
          startWith({ representation: undefined, score: undefined })
        )
      ).pipe(
        map(([
          clock,
          maxAutoBitrate,
          deviceEvents,
          { representation: chosenRepFromBufferBasedABR, score },
        ]): IABREstimation|undefined => {
          const _representations =
            getFilteredRepresentations(representations, deviceEvents);

          const {
            bandwidthEstimate,
            representation: chosenRepFromBandwidth,
          } = this._throughputChooser.getBandwidthEstimate(
            _representations, clock, maxAutoBitrate, lastEstimatedBitrate);
          lastEstimatedBitrate = bandwidthEstimate;

          lastEstimationMode = (() => {
            if (lastEstimationMode === "bandwidth") {
              if (
                chosenRepFromBufferBasedABR &&
                chosenRepFromBufferBasedABR.bitrate >= chosenRepFromBandwidth.bitrate &&
                clock.bufferGap < Infinity &&
                clock.bufferGap > 10
              ) {
                return "BOLA";
              }
            } else {
              if (
                lastEstimationMode === "BOLA" && clock.bufferGap < 5 &&
                (
                  !chosenRepFromBufferBasedABR ||
                  chosenRepFromBufferBasedABR.bitrate > chosenRepFromBandwidth.bitrate
                )
              ) {
                return "bandwidth";
              }
            }
            return lastEstimationMode;
          })();

          if (lastEstimationMode === "BOLA" && chosenRepFromBufferBasedABR != null) {
            return {
              bitrate: bandwidthEstimate,
              representation: chosenRepFromBufferBasedABR,
              urgent: this._throughputChooser.isUrgent(
                chosenRepFromBufferBasedABR.bitrate, clock),
              manual: false,
              lastStableBitrate: score && score > 1 ?
                chosenRepFromBufferBasedABR.bitrate :
                undefined,
            };
          } else if (lastEstimationMode === "bandwidth") {
            return {
              bitrate: bandwidthEstimate,
              representation: chosenRepFromBandwidth,
              urgent: this._throughputChooser.isUrgent(
                chosenRepFromBandwidth.bitrate, clock),
              manual: false,
              lastStableBitrate: (score && score > 1 && chosenRepFromBufferBasedABR) ?
                chosenRepFromBufferBasedABR.bitrate :
                undefined,
            };
          }
        }),
        filter((e): e is IABREstimation => !!e),
        distinctUntilChanged((a, b) => {
          return a.representation.id === b.representation.id &&
            b.lastStableBitrate === a.lastStableBitrate;
        }),
        takeUntil(this._dispose$)
      );
    }));
  }

  /**
   * Add a bandwidth estimate by giving:
   *   - the duration of the request, in s
   *   - the size of the request in bytes
   * @param {number} duration
   * @param {number} size
   */
  public addEstimate(duration : number, size : number) : void {
    this._throughputChooser.addEstimate(duration, size);
  }

  /**
   * Add informations about a new pending request.
   * This can be useful if the network bandwidth drastically changes to infer
   * a new bandwidth through this single request.
   * @param {string|number} id
   * @param {Object} payload
   */
  public addPendingRequest(id : string|number, payload: IBeginRequest) : void {
    this._throughputChooser.addPendingRequest(id, payload);
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
    this._throughputChooser.addRequestProgress(id, progress);
  }

  /**
   * Remove a request previously set as pending through the addPendingRequest
   * method.
   * @param {string|number} id
   */
  public removePendingRequest(id : string|number) : void {
    this._throughputChooser.removePendingRequest(id);
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

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

import { Subject } from "rxjs";
import config from "../../config";
import log from "../../log";
import { Representation } from "../../manifest";
import arrayFind from "../../utils/array_find";
import objectValues from "../../utils/object_values";
import BandwidthEstimator from "./bandwidth_estimator";
import fromBitrateCeil from "./from_bitrate_ceil";

const {
    ABR_REGULAR_FACTOR,
    ABR_STARVATION_DURATION_DELTA,
    ABR_STARVATION_FACTOR,
    ABR_STARVATION_GAP,
    OUT_OF_STARVATION_GAP,
  } = config;

interface IRepresentationChooserClockTick {
  downloadBitrate : number|undefined; // bitrate of the currently downloaded
                                      // segments, in bit per seconds
  bufferGap : number; // time to the end of the buffer, in seconds
  currentTime : number; // current position, in seconds
  speed : number; // current playback rate
  duration : number; // whole duration of the content
}

/**
 * Estimates bandwidth and chooses the maximum downloadable representation.
 */
export default class ThroughputChooser {
  private _estimator: BandwidthEstimator;
  private _inStarvationMode: boolean;
  private _currentRequests: Partial<Record<string, IRequestInfo>>;
  private _initialBitrate: number;
  private readonly _reEstimate$ : Subject<void>;

  constructor(initialBitrate: number) {
    this._initialBitrate = initialBitrate;
    this._estimator = new BandwidthEstimator();
    this._inStarvationMode = false;
    this._currentRequests = {};
    this._reEstimate$ = new Subject<void>();
  }

  public getBandwidthEstimate(
    representations: Representation[],
    clockTick: IRepresentationChooserClockTick,
    maxAutoBitrate: number,
    lastEstimatedBitrate: number|undefined
  ) {
    let newBitrateCeil; // bitrate ceil for the chosen Representation
    let bandwidthEstimate;
    const { bufferGap, currentTime, duration } = clockTick;

    // check if should get in/out of starvation mode
    if (bufferGap + currentTime < duration - ABR_STARVATION_DURATION_DELTA) {
      if (!this._inStarvationMode && bufferGap <= ABR_STARVATION_GAP) {
        log.info("ABR: enter starvation mode.");
        this._inStarvationMode = true;
      } else if (this._inStarvationMode && bufferGap >= OUT_OF_STARVATION_GAP) {
        log.info("ABR: exit starvation mode.");
        this._inStarvationMode = false;
      }
    } else if (this._inStarvationMode) {
      log.info("ABR: exit starvation mode.");
      this._inStarvationMode = false;
    }

    // If in starvation mode, check if a quick new estimate can be done
    // from the last requests.
    // If so, cancel previous estimations and replace it by the new one
    if (this._inStarvationMode) {
      bandwidthEstimate = estimateStarvationModeBitrate(
        this._currentRequests, clockTick, lastEstimatedBitrate);

      if (bandwidthEstimate != null) {
        log.info("ABR: starvation mode emergency estimate:", bandwidthEstimate);
        this._estimator.reset();
        const currentBitrate = clockTick.downloadBitrate;
        newBitrateCeil = currentBitrate == null ?
          Math.min(bandwidthEstimate, maxAutoBitrate) :
          Math.min(bandwidthEstimate, maxAutoBitrate, currentBitrate);
      }
    }

    // if newBitrateCeil is not yet defined, do the normal estimation
    if (newBitrateCeil == null) {
      bandwidthEstimate = this._estimator.getEstimate();

      let nextEstimate;
      if (bandwidthEstimate != null) {
        nextEstimate = this._inStarvationMode ?
          bandwidthEstimate * ABR_STARVATION_FACTOR :
          bandwidthEstimate * ABR_REGULAR_FACTOR;
      } else if (lastEstimatedBitrate != null) {
        nextEstimate = this._inStarvationMode ?
          lastEstimatedBitrate * ABR_STARVATION_FACTOR :
          lastEstimatedBitrate * ABR_REGULAR_FACTOR;
      } else {
        nextEstimate = this._initialBitrate;
      }
      newBitrateCeil = Math.min(nextEstimate, maxAutoBitrate);
    }

    if (clockTick.speed > 1) {
      newBitrateCeil /= clockTick.speed;
    }

    const chosenRepresentation =
      fromBitrateCeil(representations, newBitrateCeil) || representations[0];

    return {
      bandwidthEstimate,
      representation: chosenRepresentation,
    };
  }

  /**
   * Add a bandwidth estimate by giving:
   *   - the duration of the request, in s
   *   - the size of the request in bytes
   * @param {number} duration
   * @param {number} size
   */
  public addEstimate(duration : number, size : number) : void {
    if (duration != null && size != null) {
      this._estimator.addSample(duration, size);
      this._reEstimate$.next();
    }
  }

  /**
   * Returns true if, based on the current requests, it seems that the ABR should
   * switch immediately if a lower bitrate is more adapted.
   * Returns false if it estimates that you have time before switching to a lower
   * bitrate.
   * @param {Object} pendingRequests
   * @param {Object} clock
   */
  public shouldDirectlySwitchToLowBitrate(
   clock : IRepresentationChooserClockTick
  ) : boolean {
   const nextNeededPosition = clock.currentTime + clock.bufferGap;
   const requests = objectValues(this._currentRequests)
     .filter((a) : a is IRequestInfo => !!a)
     .sort((a, b) => a.time - b.time);

   const nextNeededRequest = arrayFind(requests, (r) =>
     (r.time + r.duration) > nextNeededPosition
   );
   if (!nextNeededRequest) {
     return true;
   }

   const now = performance.now();
   const lastProgressEvent = nextNeededRequest.progress ?
     nextNeededRequest.progress[nextNeededRequest.progress.length - 1] :
     null;

   // first, try to do a quick estimate from progress events
   const bandwidthEstimate = estimateRequestBandwidth(nextNeededRequest);
   if (lastProgressEvent == null || bandwidthEstimate == null) {
     return true;
   }

   const remainingTime = estimateRemainingTime(lastProgressEvent, bandwidthEstimate);
   if (
     (now - lastProgressEvent.timestamp) / 1000 <= (remainingTime * 1.2) &&
     remainingTime < ((clock.bufferGap / clock.speed) + ABR_STARVATION_GAP)
   ) {
     return false;
   }
   return true;
  }

  /**
   * For a given wanted bitrate, tells if should switch urgently.
   * @param {number} bitrate
   * @param {Object} clockTick
   * @returns {boolean}
   */
  public isUrgent(
    bitrate: number,
    clockTick: IRepresentationChooserClockTick
   ) {
    if (clockTick.downloadBitrate == null) {
      return true;
    } else if (bitrate === clockTick.downloadBitrate) {
      return false;
    } else if (bitrate > clockTick.downloadBitrate) {
      return !this._inStarvationMode;
    }
    return this.shouldDirectlySwitchToLowBitrate(clockTick);
  }

  /**
   * Free up the resources used by the RepresentationChooser.
   */
  public dispose() : void {
    this._reEstimate$.next();
    this._reEstimate$.complete();
  }
}

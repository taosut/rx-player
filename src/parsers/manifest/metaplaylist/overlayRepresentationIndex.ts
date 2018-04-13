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

import {
  IRepresentationIndex,
  ISegment,
} from "../../../manifest";
import log from "../../../utils/log";

export interface IStaticRepresentationIndexInfos {
  media: string;
}

export interface IMetaPlOverlayData {
  start : number;
  end : number;
  version : number;
  element : {
    url : string;
    format : string;
    xAxis : string;
    yAxis : string;
    height : string;
    width : string;
  };
}

/**
 * @class OverlayRepresentationIndex
 */
export default class OverlayRepresentationIndex implements IRepresentationIndex {
  private readonly _overlays: IMetaPlOverlayData[];

  constructor(data: IMetaPlOverlayData[]) {
    this._overlays = data;
  }

  /**
   * Overlay contents do not have any initialization segments.
   * Just return null.
   * @returns {null}
   */
  getInitSegment() : null {
    return null;
  }

  /**
   * @param {Number} up
   * @param {Number} to
   * @returns {Array.<Object>}
   */
  getSegments(up : number, to : number) : ISegment[] {
    return this._overlays
      .filter(({ start, end }) => {
        return start < to && end > up;
      })
      .map(overlayData => {
        return {
          isInit: false,
          id: "ov_" + JSON.stringify(overlayData), // XXX TODO Too ugly
          time: overlayData.start,
          duration: overlayData.end - overlayData.start,
          timescale: 1000,
          media: "", // XXX TODO don't do that
          privateInfos: {
            overlayInfos: overlayData,
          },
        };
      });
  }

  /**
   * Returns first position in index.
   * @returns {Number|undefined}
   */
  getFirstPosition() : number|undefined {
    const firstOverlay = this._overlays[0];
    return firstOverlay == null ? undefined : firstOverlay.start;
  }

  /**
   * Returns last position in index.
   * @returns {number|undefined}
   */
  getLastPosition() : number|undefined {
    const lastOverlay = this._overlays[this._overlays.length - 1];
    return lastOverlay == null ? undefined : lastOverlay.end;
  }

  /**
   * @returns {Boolean}
   */
  shouldRefresh() : false {
    return false;
  }

  /**
   * @returns {Number}
   */
  checkDiscontinuity() : -1 {
    return -1;
  }

  _addSegments() : void {
    if (__DEV__) {
      log.warn("Tried add Segments to an Overlay RepresentationIndex");
    }
  }

  _update() : void {
    log.warn("Tried to update an Overlay RepresentationIndex");
  }
}

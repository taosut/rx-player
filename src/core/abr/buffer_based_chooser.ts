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
  Observable,
} from "rxjs";
import {
  filter,
  map,
} from "rxjs/operators";
import {
  ISegment,
  Representation,
} from "../../manifest";
import arrayFind from "../../utils/array_find";
import arrayFindIndex from "../../utils/array_find_index";
import EWMA from "./ewma";

export interface ILoadSegmentEvent {
  type: "loaded"|"appended";
  value: {
    representation: Representation;
    segment: ISegment;
    requestTime? : number;
    bufferGap? : number;
  };
}

interface IEstimate {
  representation: Representation;
  EWMA: EWMA;
}

/**
 * Uses BOLA rule to choose the representation that should keep the buffer stable.
 *
 * This chooser is a hybrid solution that also relies on representations
 * "maintainability". Each time a chunk is downloaded, from the ratio between
 * the chunk duration and chunk's request time, we can assume that the representation
 * is "maintanable" or not. If so, we may switch to a better quality, or conversely to
 * a worse quality.
 *
 * The switch decision is taken thanks to BOLA Rule. From bufferGap and quality levels,
 * buffer steps are computed to know when we should switch quality.
 */
export default function BufferBasedChooser(
  loadSegmentEvents$: Observable<ILoadSegmentEvent>,
  representations: Representation[]
): Observable<{
  representation: Representation;
  score?: number;
}> {
  /**
   * Get minimum buffer we should keep ahead to pick this representation index.
   * @param {number} index
   * @returns {number}
   */
  function minBufferLevelForRepresentation(index: number): number {
    const qBitrate = bitrates[index];
    const qUtility = utilities[index];
    let min = 0;
    for (let i = index - 1; i >= 0; --i) {
        if (utilities[i] < utilities[index]) {
            const iBitrate = bitrates[i];
            const iUtility = utilities[i];
            const level = Vp *
              (gp + (qBitrate * iUtility - iBitrate * qUtility) /
                (qBitrate - iBitrate));
            min = Math.max(min, level);
        }
    }
    return min;
  }

  /**
   * From the buffer gap, choose a representation.
   * @param {number} bufferGap
   * @returns {undefined|Object}
   */
  function getEstimate(bufferGap: number) {
    if (scoreData) {
      const currentScore = scoreData.EWMA.getEstimate();
      const index = arrayFindIndex(representations, (r) => {
        return r.id === (scoreData as IEstimate).representation.id;
      });
      if (currentScore > 1) {
        const minBufferLevel = minBufferLevelForRepresentation(index + 1);
        if (bufferGap > minBufferLevel) {
          const upperRep = arrayFind(representations, (r) => {
            return r.bitrate > (scoreData as IEstimate).representation.bitrate;
          });
          const newRepresentation = upperRep || scoreData.representation;
          scoreData = undefined;
          return newRepresentation;
        }
      } else if (currentScore < 1.15) {
        const minBufferLevel = minBufferLevelForRepresentation(index);
        if (bufferGap < minBufferLevel * 0.8) {
          const downerRepIndex = arrayFindIndex(representations, (r, i) => {
            const lastRep = representations[i - 1];
            return lastRep &&
              lastRep.bitrate < (scoreData as IEstimate).representation.bitrate &&
              r.id === (scoreData as IEstimate).representation.id;
          }) - 1;
          const newRepresentation = representations[downerRepIndex] ||
            scoreData.representation;
          scoreData = undefined;
          return newRepresentation;
        }
      }
      return scoreData.representation;
    }
  }

  const standbyFetchedSegment: Array<{
    representation: Representation;
    segment: ISegment;
    requestTime? : number;
  }> = [];
  const bitrates = representations.map((r) => r.bitrate);
  const logs =
    representations.map((r) => Math.log(r.bitrate / representations[0].bitrate));
  const utilities = logs.map(log => log - logs[0] + 1); // normalize
  let scoreData: undefined|IEstimate;

  const gp =
    // 20 is the buffer gap when we want to reach maximum quality.
    (utilities[utilities.length - 1] - 1) /
    ((representations.length * 2) + 10);
  const Vp = 1 / gp;

  return loadSegmentEvents$.pipe(
    map(({ value, type }) => {
      if (!value.segment.isInit) {
        if (type === "loaded") {
          standbyFetchedSegment.push(value);
        } else {
          const standBySegmentIndex = arrayFindIndex(standbyFetchedSegment, (s) =>
            s.representation.id === value.representation.id &&
            s.segment.id === value.segment.id
          );
          if (standBySegmentIndex > -1) {
            const standBySegment = standbyFetchedSegment[standBySegmentIndex];
            standbyFetchedSegment.splice(standBySegmentIndex, 1);
            const { segment, representation } = value;
            const { requestTime } = standBySegment;
            if (segment.duration != null && requestTime != null) {
              const quality =
                (segment.duration / segment.timescale) / (requestTime / 1000);
              if (
                !scoreData ||
                representation.id !== scoreData.representation.id
              ) {
                const newEWMA = new EWMA(5);
                newEWMA.addSample(1, quality);
                scoreData = {
                  representation,
                  EWMA: newEWMA,
                };
              } else {
                const { EWMA: scoreEWMA } = scoreData;
                scoreEWMA.addSample(1, quality);
              }
            }
          }
          if (value.bufferGap) {
            const representation = getEstimate(value.bufferGap);
            return {
              representation,
              score: scoreData ? scoreData.EWMA.getEstimate() : undefined,
            };
          }
        }
      }
    }),
    filter((r): r is any => !!r)
  );
}

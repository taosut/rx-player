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
  tap,
  withLatestFrom,
} from "rxjs/operators";
import {
  ISegment,
  Representation,
} from "../../manifest";
import arrayFind from "../../utils/array_find";
import arrayFindIndex from "../../utils/array_find_index";
import EWMA from "./ewma";

export interface IAppendedSegment {
  representation: Representation;
  segment: ISegment;
  bufferGap? : number;
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
  appendedSegment$: Observable<IAppendedSegment>,
  scoreData$: Observable<IEstimate>,
  representations: Representation[]
): Observable<Representation> {
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
  function getEstimate(
    bufferGap: number,
    scoreData: IEstimate,
    lastChosenRepresentation?: Representation
  ): Representation {
      const currentScore = scoreData.EWMA.getEstimate();
      const index = arrayFindIndex(representations, (r) => {
        return r.id === (scoreData as IEstimate).representation.id;
      });
      if (lastChosenRepresentation) {
          if (
            lastChosenRepresentation.bitrate !== scoreData.representation.bitrate ||
            currentScore > 1
          ) {
            const minBufferLevel = minBufferLevelForRepresentation(index + 1);
            if (bufferGap > minBufferLevel) {
              const upperRep = arrayFind(representations, (r) => {
                return r.bitrate > lastChosenRepresentation.bitrate;
              });
              const newRepresentation = upperRep || scoreData.representation;
              return newRepresentation;
            }
          } else if (
            lastChosenRepresentation.bitrate !== scoreData.representation.bitrate ||
            currentScore < 1.15
          ) {
            const minBufferLevel = minBufferLevelForRepresentation(index);
            if (bufferGap < minBufferLevel * 0.8) {
              const downerRepIndex = arrayFindIndex(representations, (r, i) => {
                const lastRep = representations[i - 1];
                return lastRep &&
                  lastRep.bitrate < lastChosenRepresentation.bitrate &&
                  r.id === lastChosenRepresentation.id;
              }) - 1;
              const newRepresentation = representations[downerRepIndex] ||
                scoreData.representation;
              return newRepresentation;
            }
        }
      }
      return lastChosenRepresentation || scoreData.representation;
  }

  const bitrates = representations.map((r) => r.bitrate);
  const logs =
    representations.map((r) => Math.log(r.bitrate / representations[0].bitrate));
  const utilities = logs.map(log => log - logs[0] + 1); // normalize
  let currentRepresentation: undefined|Representation;

  const gp =
    // 20 is the buffer gap when we want to reach maximum quality.
    (utilities[utilities.length - 1] - 1) /
    ((representations.length * 2) + 10);
  const Vp = 1 / gp;

  return appendedSegment$.pipe(
    withLatestFrom(scoreData$),
    map(([{ bufferGap }, scoreData]) => {
      if (bufferGap) {
        const representation = getEstimate(
          bufferGap,
          scoreData,
          currentRepresentation
        );
        return representation;
      }
    }),
    tap((representation) => currentRepresentation = representation),
    filter((r): r is Representation => !!r)
  );
}

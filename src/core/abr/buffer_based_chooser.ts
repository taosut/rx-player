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

import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import log from "../../log";
import { Representation } from "../../manifest";
import arrayFind from "../../utils/array_find";
import arrayFindIndex from "../../utils/array_find_index";

/**
 * From the buffer gap, choose a representation.
 * @param {number} bufferGap
 * @param {Object} scoreData
 * @param {Object|undefined} lastChoosenRepresentation
 * @returns {Object}
 */
function getEstimateFromBufferLevels(
  representations : Representation[],
  currentRepresentation : Representation,
  bufferLevels : number[],
  bufferGap : number,
  score? : number
) : Representation {
  const currentScoreIndex = arrayFindIndex(representations, (r) => {
    return r.id === currentRepresentation.id;
  });
  if (currentScoreIndex < 0 || currentScoreIndex > bufferLevels.length) {
    log.error("ABR: Current Representation not found in the calculated levels");
    return representations[0];
  }

  if (score == null || score > 1) {
    const minBufferLevel = bufferLevels[currentScoreIndex + 1];
    if (bufferGap && bufferGap > minBufferLevel) {
      const upperRep = arrayFind(representations, (r) => {
        return r.bitrate > currentRepresentation.bitrate;
      });
      return upperRep || currentRepresentation;
    }
  }

  if (score == null || score < 1.15) {
    const minBufferLevel = bufferLevels[currentScoreIndex + 1];
    if (!bufferGap || bufferGap < minBufferLevel * 0.8) {
      const downerRepIndex = arrayFindIndex(representations, (r, i) => {
        const lastRep = representations[i - 1];
        return lastRep && lastRep.bitrate < currentRepresentation.bitrate &&
          r.id === currentRepresentation.id;
      }) - 1;
      return representations[downerRepIndex] || currentRepresentation;
    }
  }

  return currentRepresentation;
}

/**
 * Choose a Representation based on the currently available buffer.
 *
 * This algorithm is based on the deviation of the BOLA algorithm.
 * It is a hybrid solution that also relies on representations
 * "maintainability".
 * Each time a chunk is downloaded, from the ratio between the chunk duration
 * and chunk's request time, we can assume that the representation is
 * "maintanable" or not.
 * If so, we may switch to a better quality, or conversely to a worse quality.
 *
 * @param {Observable} appendedSegment
 * @param {Observable} scoreProcessor$
 * @param {Array.<Object>} representations
 * @returns {Observable}
 */
export default function BufferBasedChooser(
  update$ : Observable<{
    bufferGap : number;
    currentRepresentation? : Representation|null;
    currentScore? : number;
  }>,
  representations: Representation[]
) : Observable<Representation|null> {
  const bitrates = representations.map((r) => r.bitrate);
  const logs = representations
    .map((r) => Math.log(r.bitrate / representations[0].bitrate));
  const utilities = logs.map(l => l - logs[0] + 1); // normalize
  const gp =
    // 20 is the buffer gap when we want to reach maximum quality.
    (utilities[utilities.length - 1] - 1) /
    ((representations.length * 2) + 10);
  const Vp = 1 / gp;

  const levelsMap : number[] = representations
    .map((_, i) => minBufferLevelForRepresentation(i));

  /**
   * XXX TODO
   * Get minimum buffer we should keep ahead to pick this Representation.
   * @param {number} index
   * @returns {number}
   */
  function minBufferLevelForRepresentation(index: number): number {
    const repBitrate = bitrates[index];
    const repUtility = utilities[index];
    let min = 0;
    for (let i = index - 1; i >= 0; --i) {
      if (utilities[i] < utilities[index]) {
        const iBitrate = bitrates[i];
        const iUtility = utilities[i];
        const level = Vp *
          (gp + (repBitrate * iUtility - iBitrate * repUtility) /
            (repBitrate - iBitrate));
        min = Math.max(min, level);
      }
    }
    return min;
  }

  return update$
    .pipe(map(({ bufferGap, currentRepresentation, currentScore }) => {
      console.log("??????", representations.map((_r : any, i : number) => {
        return minBufferLevelForRepresentation(i);
      }));
      if (currentRepresentation == null) {
        return null; // XXX TODO
      }
      return getEstimateFromBufferLevels(
        representations,
        currentRepresentation,
        levelsMap,
        bufferGap,
        currentScore);
    }));
}

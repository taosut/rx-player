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
 * @returns {Object|undefined}
 */
function getEstimateFromBufferLevels(
  bitrates : number[],
  currentRepresentation : Representation,
  bufferLevels : number[],
  bufferGap : number,
  score? : number
) : number|undefined {
  const currentScoreIndex = arrayFindIndex(bitrates, (bitrate) => {
    return bitrate === currentRepresentation.bitrate;
  });
  if (currentScoreIndex < 0 || currentScoreIndex > bufferLevels.length) {
    log.error("ABR: Current Representation not found in the calculated levels");
    return bitrates[0];
  }

  if (score == null || score > 1) {
    const minBufferLevel = bufferLevels[currentScoreIndex + 1];
    if (bufferGap && bufferGap > minBufferLevel) {
      const upperBitrate = arrayFind(bitrates, (bitrate) => {
        return bitrate > currentRepresentation.bitrate;
      });
      return upperBitrate != null ? upperBitrate : currentRepresentation.bitrate;
    }
  }

  if (score == null || score < 1.15) {
    const minBufferLevel = bufferLevels[currentScoreIndex + 1];
    if (!bufferGap || bufferGap < minBufferLevel * 0.8) {
      const downerBitrateIndex = arrayFindIndex(bitrates, (bitrate, i) => {
        return i >= 1 && bitrates[i - 1] < currentRepresentation.bitrate &&
          bitrate === currentRepresentation.bitrate;
      }) - 1;
      return bitrates[downerBitrateIndex] != null ?
        bitrates[downerBitrateIndex] : currentRepresentation.bitrate;
    }
  }
  return currentRepresentation.bitrate;
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
 * @param {Observable} update$
 * @param {Array.<number>} bitrates
 * @returns {Observable}
 */
export default function BufferBasedChooser(
  update$ : Observable<{
    bufferGap : number;
    currentRepresentation? : Representation|null;
    currentScore? : number;
  }>,
  bitrates: number[]
) : Observable<number|undefined> {
  const logs = bitrates
    .map((r) => Math.log(bitrates[r] / bitrates[0]));
  const utilities = logs.map(l => l - logs[0] + 1); // normalize
  const gp =
    // 20 is the buffer gap when we want to reach maximum quality.
    (utilities[utilities.length - 1] - 1) /
    ((bitrates.length * 2) + 10);
  const Vp = 1 / gp;

  const levelsMap : number[] = bitrates
    .map((_, i) => minBufferLevelForRepresentation(i));

  /**
   * Get minimum buffer we should keep ahead to pick this Representation.
   * @param {number} index
   * @returns {number}
   */
  function minBufferLevelForRepresentation(index: number): number {
    if (index < 1 && index >= bitrates.length) {
      log.warn("ABR: Trying to get min buffer level of out-of-bound representation.");
    }
    const boundedIndex = Math.min(Math.max(0, index), bitrates.length - 1);
    return Vp * (gp + (bitrates[boundedIndex] * utilities[boundedIndex - 1] -
      bitrates[boundedIndex - 1] * utilities[boundedIndex]) / (bitrates[boundedIndex] -
      bitrates[boundedIndex - 1]));
  }

  console.log("??????", bitrates.map((_r : any, i : number) => {
    return minBufferLevelForRepresentation(i);
  }));

  return update$
    .pipe(map(({ bufferGap, currentRepresentation, currentScore }) => {
      if (currentRepresentation == null) {
        return undefined;
      }
      return getEstimateFromBufferLevels(
        bitrates,
        currentRepresentation,
        levelsMap,
        bufferGap,
        currentScore);
    }));
}

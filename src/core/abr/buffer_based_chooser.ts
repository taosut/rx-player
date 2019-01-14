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
import arrayFind from "../../utils/array_find";
import arrayFindIndex from "../../utils/array_find_index";

export interface IBufferBasedChooserClockTick {
  bufferGap : number;
  currentBitrate? : number;
  currentScore? : number;
  playbackRate : number;
}

/**
 * From the buffer gap, choose a representation.
 * @param {Object} clockTick
 * @param {Array.<Number>} bitrates
 * @param {Array.<Number>} levels
 * @returns {Object|undefined}
 */
function getEstimateFromBufferLevels(
  clockTick : IBufferBasedChooserClockTick,
  bitrates : number[],
  bufferLevels : number[]
) : number|undefined {
  const { bufferGap, currentBitrate, currentScore, playbackRate } = clockTick;
  if (currentBitrate == null) {
    return undefined;
  }
  const currentScoreIndex = arrayFindIndex(bitrates, b => b === currentBitrate);
  if (currentScoreIndex < 0 || currentScoreIndex > bufferLevels.length) {
    log.error("ABR: Current Bitrate not found in the calculated levels");
    return bitrates[0];
  }

  let scaledScore : number|undefined;
  if (currentScore != null) {
    scaledScore = playbackRate === 0 ?
      currentScore : (currentScore / playbackRate);
  }

  if (scaledScore == null || scaledScore > 1) {
    const minBufferLevel = bufferLevels[currentScoreIndex + 1];
    if (bufferGap && bufferGap > minBufferLevel) {
      const upperBitrate = arrayFind(bitrates, (bitrate) => {
        return bitrate > currentBitrate;
      });
      return upperBitrate != null ? upperBitrate : currentBitrate;
    }
  }

  if (scaledScore == null || scaledScore < 1.15) {
    const minBufferLevel = bufferLevels[currentScoreIndex + 1];
    if (!bufferGap || bufferGap < minBufferLevel * 0.8) {
      const downerBitrateIndex = arrayFindIndex(bitrates, (bitrate, i) => {
        return i >= 1 && bitrates[i - 1] < currentBitrate &&
          bitrate === currentBitrate;
      }) - 1;
      return bitrates[downerBitrateIndex] != null ?
        bitrates[downerBitrateIndex] : currentBitrate;
    }
  }
  return currentBitrate;
}

/**
 * Choose a bitrate based on the currently available buffer.
 *
 * This algorithm is based on the deviation of the BOLA algorithm.
 * It is a hybrid solution that also relies on a given bitrate's
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
  update$ : Observable<IBufferBasedChooserClockTick>,
  bitrates: number[]
) : Observable<number|undefined> {
  const logs = bitrates
    .map((b) => Math.log(b / bitrates[0]));
  const utilities = logs.map(l => l - logs[0] + 1); // normalize
  const gp = (utilities[utilities.length - 1] - 1) / ((bitrates.length * 2) + 10);
  const Vp = 1 / gp;
  const levelsMap : number[] = bitrates.map((_, i) => minBufferLevelForBitrate(i));

  /**
   * Get minimum buffer we should keep ahead to pick this bitrate.
   * @param {number} index
   * @returns {number}
   */
  function minBufferLevelForBitrate(index: number): number {
    if (index < 0 && index >= bitrates.length) {
      log.warn("ABR: Trying to get min buffer level of out-of-bound representation.");
    }
    if (index === 0) {
      return 0;
    }
    const boundedIndex = Math.min(Math.max(1, index), bitrates.length - 1);
    return Vp * (gp + (bitrates[boundedIndex] * utilities[boundedIndex - 1] -
      bitrates[boundedIndex - 1] * utilities[boundedIndex]) / (bitrates[boundedIndex] -
      bitrates[boundedIndex - 1])) + 4;
  }

  console.log("??????", bitrates.map((_r : any, i : number) => {
    return minBufferLevelForBitrate(i);
  }));

  return update$.pipe(map((clockTick) => {
    return getEstimateFromBufferLevels(clockTick, bitrates, levelsMap);
  }));
}

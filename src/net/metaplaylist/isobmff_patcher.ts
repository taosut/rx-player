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
    be4toi,
    be8toi,
    bytesToStr,
    concat,
    itobe4,
    itobe8,
    strToBytes,
  } from "../../utils/bytes";

/**
 * Create a new _Atom_ (isobmff box).
 * @param {string} name - The box name (e.g. sidx, moov, pssh etc.)
 * @param {Uint8Array} buff - The box's content
 */
function Atom(name : string, buff : Uint8Array) : Uint8Array {
  const len = buff.length + 8;
  return concat(itobe4(len), strToBytes(name), buff);
}

export default function patchBox(
  _data: Uint8Array,
  _lmsg: boolean,
  __offset?: number,
  _segNr?: number
) {
  let sizeChange = 0;
  const data = _data;
  const topLevelBoxesToParse = ["moov", "styp", "sidx", "moof", "mdat"];
  const compositeBoxesToParse = ["trak", "moov", "moof", "traf"];
  const segNr = _segNr;
  const offset = __offset || 0;
  const lmsg = _lmsg || false;

  /**
   * Get size and boxtype from current box
   * @param {Uint8Array} data
   */
  function checkBox(boxData: Uint8Array) {
    const size = be4toi(boxData, 0);
    const boxtype = bytesToStr(boxData.subarray(4,8));
    return {
      size,
      boxtype,
    };
  }

  /**
   * Process specific box and its children
   * @param {string} boxtype
   * @param {Uint8Array} data
   * @param {number} filePos
   * @param {string} _path
   */
  function filterBox(
    boxtype: string,
    boxesData: Uint8Array,
    filePos: number,
    _path?: string
  ): Uint8Array{
    let output = new Uint8Array(0);
    const path = _path ? (_path + "." + boxtype) : boxtype;
    if (compositeBoxesToParse.indexOf(boxtype) >= 0) {
      output = boxesData.subarray(0,8);
      let pos = 8;
      while(pos < boxesData.length) {
        const {
          size: childSize,
          boxtype: childBoxType,
        } = checkBox(boxesData.subarray(pos, pos + 8));
        const outputChildBox =
          filterBox(
            childBoxType,
            boxesData.subarray(pos, pos + childSize),
            filePos+pos,
            path
          );
        output = concat(output, outputChildBox);
        pos += childSize;
      }
      if (output.length !== boxesData.length) {
        output = concat(itobe4(output.length), output.subarray(4, output.length));
      }
    } else {
      switch(boxtype) {
        case "styp":
          output = styp(boxesData);
          break;
        case "mfhd":
          output = mfhd(boxesData);
          break;
        case "sidx":
          output = sidx(boxesData, false);
          break;
        case "tfdt":
          output = tfdt(boxesData);
          break;
        case "mdat":
          output = boxesData;
          break;
        case "mvhd":
          output = mvhd(boxesData);
          break;
        case "tkhd":
          output = tkhd(boxesData);
          break;
        default:
          output = boxesData;
          break;
      }
      // if (output.toString() !== data.toString()) {
      //   console.log(boxtype);
      //   console.log("");
      // }
    }
    return output;
  }

  function tkhd(input: Uint8Array): Uint8Array {
    const version = input[8];
    let output = new Uint8Array(0);
    if (version === 1) {
      output = concat(
        input.subarray(0,36),
        itobe8(0),
        input.subarray(44, input.length)
      );
    } else {
      output = concat(
        input.subarray(0,28),
        itobe4(0),
        input.subarray(32, input.length)
      );
    }
    return output;
  }

  function mvhd(input: Uint8Array): Uint8Array {
    const version = input[8];
    let output = new Uint8Array(0);
    if (version === 1) {
      output = concat(
        input.subarray(0,32),
        itobe8(0),
        input.subarray(40, input.length)
      );
    } else {
      output = concat(
        input.subarray(0,24),
        itobe4(0),
        input.subarray(28, input.length)
      );
    }
    return output;
  }

  /**
   * Process styp and make sure lmsg presence follows the lmsg flag parameter.
   * Add scte35 box if appropriate
   * @param {Uint8Array} input
   * @return {Uint8Array} patched box
   */
  function styp(input: Uint8Array): Uint8Array {
    const size = be4toi(input, 0);
    let pos = 8;
    const brands = [];
    while (pos < size) {
        const brand = input.subarray(pos, pos + 4);
        if (bytesToStr(brand) !== "lmsg") {
            brands.push(brand);
        }
        pos += 4;
    }
    if (lmsg) {
      brands.push(strToBytes("lmsg"));
    }
    const dataSize = brands.length * 4;
    const stypData = new Uint8Array(dataSize);
    for (let i = 0; i < brands.length; i++) {
      stypData.set(brands[i], i*4);
    }
    return Atom("styp", stypData);
  }

  /**
   * Process mfhd box and set segmentNumber if requested.
   * @param {Uint8Array} input
   * @return {Uint8Array} patched box
   */
  function mfhd(input: Uint8Array): Uint8Array {
    if (!segNr) {
      return input;
    }
    const prefix = input.subarray(0, 12);
    const segNrByte = itobe4(segNr);
    return concat(prefix, segNrByte);
  }

  /**
   * Process sidx data and add to output.
   * @param {Uint8Array} input
   * @param {boolean} keepSidx
   */
  function sidx(input: Uint8Array, patchSidx: boolean): Uint8Array {
    let output = new Uint8Array(0);
    if (!patchSidx) {
      return input;
    }
    let earliestPresentationTime;
    let firstOffset;
    const version = input[8];
    const timescale = be4toi(input, 16);
    if (version === 0) {
      // Changing sidx version to 1
      const size = be4toi(input, 0);
      const sidxSizeExpansion = 8;
      output = concat(
        itobe4(size + sidxSizeExpansion),
        input.subarray(4,8),
        new Uint8Array([1]),
        input.subarray(9, 20));
      earliestPresentationTime = be4toi(input, 20);
      firstOffset = be4toi(input, 24);
    }
    else {
      output = input.subarray(0, 20);
      earliestPresentationTime = be8toi(input, 20);
      firstOffset = be8toi(input, 28);
    }
    const newPresentationTime = earliestPresentationTime + timescale * offset;
    output = concat(output, itobe8(newPresentationTime), itobe8(firstOffset));
    const suffixOffset = version === 0 ? 28 : 36;
    output = concat(output, input.subarray(suffixOffset, input.length));
    return output;
  }

  /**
   * Generate new timestamps for tfdt and change size of boxes above if needed.
   * Try to keep in 32 bits if possible.
   * @param input
   */
  function tfdt(input: Uint8Array): Uint8Array{
    const version = input[8];
    const tfdtOffset = offset;
    let newBaseMediaDecodeTime;
    let output = new Uint8Array(0);
    // 32-bit baseMediaDecodeTime
    if (version === 0) {
      const baseMediaDecodeTime = be4toi(input, 12);
      newBaseMediaDecodeTime = baseMediaDecodeTime + tfdtOffset;
      if (newBaseMediaDecodeTime < 4294967296) {
        output = concat(input.subarray(0,12), itobe4(newBaseMediaDecodeTime));
      } else {
        // Forced to change to 64-bit tfdt.
        sizeChange = 4;
        output = concat(
          itobe4(be4toi(input, 0) + sizeChange),
          input.subarray(4,8),
          new Uint8Array([1]),
          input.subarray(9, 12),
          itobe8(newBaseMediaDecodeTime)
        );
      }
    } else { // 64-bit
      const baseMediaDecodeTime = be8toi(input, 12);
      newBaseMediaDecodeTime = baseMediaDecodeTime + tfdtOffset;
      output = concat(input.subarray(0,12), itobe8(newBaseMediaDecodeTime));
    }
    return output;
  }

  let segment_output = new Uint8Array(0);
  let _pos = 0;
  while(_pos < data.length) {
    const { size, boxtype } = checkBox(data.subarray(_pos, _pos + 8));
    const boxdata = data.subarray(_pos, _pos + size);
    const concatData = (topLevelBoxesToParse
      .indexOf(boxtype) >= 0) ?
        filterBox(boxtype, boxdata, segment_output.length) :
        boxdata;
    segment_output = concat(segment_output, concatData);
    _pos += size;
  }
  return segment_output;
}
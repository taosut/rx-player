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

import getCueBlocks from "../get_cue_blocks";
import getStyleBlocks from "../get_style_blocks";
import parseCueBlock from "../parse_cue_block";
import { getFirstLineAfterHeader } from "../utils";
import convertPayloadToHTML from "./convert_payload_to_html";
import parseStyleBlock, {
  IStyleElement,
} from "./parse_style_block";

export interface IVTTHTMLCue {
  start : number;
  end: number;
  element : HTMLElement;
}

/**
 * Parse WebVTT from text. Returns an array with:
 * - start : start of current cue, in seconds
 * - end : end of current cue, in seconds
 * - content : HTML formatted cue.
 *
 * Global style is parsed and applied to div element.
 * Specific style is parsed and applied to class element.
 *
 * @param {string} text
 * @param {Number} timeOffset
 * @return {Array.<Object>}
 * @throws Error - Throws if the given WebVTT string is invalid.
 */
export default function parseWebVTT(
  text : string,
  timeOffset : number
) : IVTTHTMLCue[] {
  const newLineChar = /\r\n|\n|\r/g;
  const linified = text.split(newLineChar);
  if (!linified.length) {
    return [];
  }

  const cuesArray : IVTTHTMLCue[] = [];
  const styleElements : IStyleElement[] = [];
  if (!linified[0].match(/^WEBVTT( |\t|\n|\r|$)/)) {
    throw new Error("Can't parse WebVTT: Invalid File.");
  }

  const firstLineAfterHeader = getFirstLineAfterHeader(linified);
  const styleBlocks = getStyleBlocks(linified, firstLineAfterHeader);
  const cueBlocks = getCueBlocks(linified, firstLineAfterHeader);

  for (let i = 0; i < styleBlocks.length; i++) {
    const parsedStyles = parseStyleBlock(styleBlocks[i]);
    styleElements.push(...parsedStyles);
  }

  for (let i = 0; i < cueBlocks.length; i++) {
    const cueObject = parseCueBlock(cueBlocks[i], timeOffset);

    if (cueObject != null) {
      const htmlCue = toHTML(cueObject, styleElements);
      if (htmlCue) {
        cuesArray.push(htmlCue);
      }
    }
  }
  return cuesArray;
}

/**
 * Parse cue block into an object with the following properties:
 *   - start {number}: start time at which the cue should be displayed
 *   - end {number}: end time at which the cue should be displayed
 *   - element {HTMLElement}: the cue text, translated into an HTMLElement
 *
 * Returns undefined if the cue block could not be parsed.
 * @param {Array.<string>} cueBlock
 * @param {Number} timeOffset
 * @param {Array.<Object>} styleElements
 * @returns {Object|undefined}
 */
function toHTML(
  cueObj : {
    start : number;
    end : number;
    header? : string;
    payload : string[];
  },
  styleElements : IStyleElement[]
) : IVTTHTMLCue|undefined {
  const { start, end, header, payload } = cueObj;

  const region = document.createElement("div");
  const regionAttr = document.createAttribute("style");
  regionAttr.value =
    "width:100%;" +
    "height:100%;" +
    "display:flex;" +
    "flex-direction:column;" +
    "justify-content:flex-end;" +
    "align-items:center;";
  region.setAttributeNode(regionAttr);

  // Get content, format and apply style.
  const pElement = document.createElement("p");
  const pAttr = document.createAttribute("style");
  pAttr.value = "text-align:center";
  pElement.setAttributeNode(pAttr);

  const spanElement = document.createElement("span");
  const attr = document.createAttribute("style");

  // set color and background-color default values, as indicated in:
  // https://www.w3.org/TR/webvtt1/#applying-css-properties
  attr.value =
    "background-color:rgba(0,0,0,0.8);" +
    "color:white;";
  spanElement.setAttributeNode(attr);

  const styles = styleElements
    .filter(styleElement =>
      (styleElement.className === header && !styleElement.isGlobalStyle) ||
      styleElement.isGlobalStyle
    ).map(styleElement => styleElement.styleContent);

  attr.value += styles.join();
  spanElement.setAttributeNode(attr);

  convertPayloadToHTML(payload.join("\n"), styleElements)
    .forEach(element => {
      spanElement.appendChild(element);
    });

  region.appendChild(pElement) ;
  pElement.appendChild(spanElement);

  return {
    start,
    end,
    element: region,
  };
}

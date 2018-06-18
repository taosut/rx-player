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

/**
 * /!\ This file is feature-switchable.
 * It always should be imported through the `features` object.
 */

import { of as observableOf } from "rxjs";
import rxpManifestParser from "../../parsers/manifest/rxp-manifest";
import {
  parser as imageParser,
} from "../dash/images";
import segmentParser from "../dash/segment_parser";
import {
  parser as textTrackParser,
} from "../dash/texttracks";
import {
  ILoaderObservable,
  IManifestParserArguments,
  IManifestParserObservable,
  ISegmentLoaderArguments,
  ITransportPipelines,
} from "../types";
import loadSegment from "./load_segment";

/**
 * Generic segment loader for rxp-manifest.
 * @param {Object} arg
 * @returns {Observable}
 */
function segmentLoader(
  { segment } : ISegmentLoaderArguments
) : ILoaderObservable<ArrayBuffer|Uint8Array|null> {
  const privateInfos = segment.privateInfos;
  if (!privateInfos || privateInfos.rxpSegment == null) {
    throw new Error("Segment is not an rxp-manifest segment");
  }
  return loadSegment(privateInfos.rxpSegment.load);
}

/**
 * Returns pipelines used for rxp-manifest streaming.
 * @param {Object} options
 * @returns {Object}
 */
export default function getRXPManifestPipelines(
) : ITransportPipelines {

  const manifestPipeline = {
    loader() : never {
      throw new Error("An RXP-manifest is not loadable.");
    },

    parser(
      { response } : IManifestParserArguments<any>
    ) : IManifestParserObservable {
      const manifestData = response.responseData;
      if (typeof manifestData !== "object") {
        throw new Error("Wrong format for the manifest data");
      }
      return observableOf({
        manifest: rxpManifestParser(response.responseData),
        url: null,
      });
    },
  };

  const segmentPipeline = {
    loader: segmentLoader,
    parser: segmentParser,
  };

  const textTrackPipeline = {
    loader: segmentLoader,
    parser: textTrackParser,
  };

  const imageTrackPipeline = {
    loader: segmentLoader,
    parser: imageParser,
  };

  return {
    manifest: manifestPipeline,
    audio: segmentPipeline,
    video: segmentPipeline,
    text: textTrackPipeline,
    image: imageTrackPipeline,
  };
}

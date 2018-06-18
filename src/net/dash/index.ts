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
import dashManifestParser from "../../parsers/manifest/dash";
import {
  CustomManifestLoader,
  CustomSegmentLoader,
  ILoaderObservable,
  IManifestLoaderArguments,
  IManifestParserArguments,
  IManifestParserObservable,
  ITransportPipelines,
} from "../types";
import generateManifestLoader from "../utils/manifest_loader";
import {
  loader as imageLoader,
  parser as imageParser,
} from "./images";
import generateSegmentLoader from "./segment_loader";
import segmentParser from "./segment_parser";
import {
  loader as textTrackLoader,
  parser as textTrackParser,
} from "./texttracks";

interface IDASHOptions {
  manifestLoader? : CustomManifestLoader;
  segmentLoader? : CustomSegmentLoader;
  // contentProtectionParser? : IContentProtectionParser;
}

/**
 * Returns pipelines used for DASH streaming.
 * @param {Object} options
 * implementation. Used for each generated http request.
 * @returns {Object}
 */
export default function(
  options : IDASHOptions = {}
) : ITransportPipelines {
  const manifestLoader = generateManifestLoader({
    customManifestLoader: options.manifestLoader,
  });
  const segmentLoader = generateSegmentLoader(options.segmentLoader);
  // const { contentProtectionParser } = options;

  const manifestPipeline = {
    loader(
      { url } : IManifestLoaderArguments
    ) : ILoaderObservable<Document|string> {
      return manifestLoader(url);
    },

    parser(
      { response, infos } : IManifestParserArguments<Document|string>
    ) : IManifestParserObservable {
      const reqURL = infos.url;
      const url = response.url == null ? reqURL : response.url;
      const data = typeof response.responseData === "string" ?
        new DOMParser().parseFromString(response.responseData, "text/xml") :
        response.responseData;
      return observableOf({ manifest: dashManifestParser(data, url), url });
    },
  };

  const segmentPipeline = {
    loader: segmentLoader,
    parser: segmentParser,
  };

  const textTrackPipeline = {
    loader: textTrackLoader,
    parser: textTrackParser,
  };

  const imageTrackPipeline = {
    loader: imageLoader,
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

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
import { catchError } from "rxjs/operators";
import {
  isKnownError,
  OtherError,
} from "../../errors";
import {
  ImageParserObservable,
  IManifestParserArguments,
  IManifestParserObservable,
  ISegmentParserArguments,
  ITransportAudioSegmentPipeline,
  ITransportImageSegmentPipeline,
  ITransportManifestPipeline,
  ITransportPipeline,
  ITransportTextSegmentPipeline,
  ITransportVideoSegmentPipeline,
  SegmentParserObservable,
  TextTrackParserObservable,
} from "../../net/types";
import { tryCatchWithArg } from "../../utils/rx-tryCatch";

/**
 * Generate parser function.
 *
 * Type parameters:
 *   - T : Argument taken by the parser
 *   - U : Data emitted by the parser
 * @param {Object} transportPipeline
 * @returns {Function}
 */
function generateParser(
  transportPipeline : ITransportManifestPipeline
) : (data : IManifestParserArguments<any>) => IManifestParserObservable;
function generateParser(
  transportPipeline : ITransportAudioSegmentPipeline |
                      ITransportVideoSegmentPipeline
) : (data : ISegmentParserArguments<Uint8Array|ArrayBuffer|null>) =>
  SegmentParserObservable;
function generateParser(
  transportPipeline : ITransportTextSegmentPipeline
) : (data : ISegmentParserArguments<Uint8Array|ArrayBuffer|string|null>) =>
  TextTrackParserObservable;
function generateParser(
  transportPipeline : ITransportImageSegmentPipeline
) : (data : ISegmentParserArguments<Uint8Array|ArrayBuffer|null>) =>
  ImageParserObservable;
function generateParser<T, U>(
  transportPipeline : ITransportPipeline
) : (data : T) => Observable<U> {
  const { parser } = transportPipeline;
  return (data : T) => {
    return tryCatchWithArg(parser as any /* ugly TS Hack :/ */, data)
      .pipe(catchError((error) : Observable<never> => {
        throw isKnownError(error) ?
          error :
          new OtherError("PIPELINE_PARSING_ERROR", error, true);
      }));
  };
}

export default generateParser;

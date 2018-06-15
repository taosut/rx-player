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
  Subject,
} from "rxjs";
import {
  map,
  share,
} from "rxjs/operators";
import { ICustomError } from "../../../errors";
import Manifest, {
  ISupplementaryImageTrack,
  ISupplementaryTextTrack,
} from "../../../manifest";
import createManifest from "../../../manifest/factory";
import { ITransportPipelines } from "../../../net";
import generateParser from "../generate_parser";

export default function parseManifestData(
  transport : ITransportPipelines,
  manifestData : any,
  warning$ : Subject<Error|ICustomError>,
  supplementaryTextTracks : ISupplementaryTextTrack[] = [],
  supplementaryImageTracks : ISupplementaryImageTrack[] = []
) : Observable<Manifest> {
  return generateParser(transport.manifest)({
    response: { responseData: manifestData },
    url: null,
  }).pipe(
    map((value) => {
      return createManifest(
        value.manifest,
        supplementaryTextTracks,
        supplementaryImageTracks,
        warning$
      );
    }),
    share()
  );
}

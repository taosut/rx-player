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

export type IRXPManifestSegmentLoader = (
  callbacks : {
    resolve : (args: {
      data : ArrayBuffer|Uint8Array;
      size : number;
      duration : number;
    }) => void;

    reject : (err? : Error) => void;
  }
) =>
  // returns either the aborting callback or nothing
  (() => void)|void;

export interface IRXPIndexInitSegment {
  load : IRXPManifestSegmentLoader;
}

export interface IRXPIndexSegment {
  time : number;
  timescale : number;
  duration : number;
  load : IRXPManifestSegmentLoader;
}

export interface IRXPIndex {
  init? : IRXPIndexInitSegment|null;
  segments : IRXPIndexSegment[];
}

export interface IRXPRepresentation {
  id : string; // unique ID string
  bitrate : number; // (worst?) bitrate of the content in bps
  mimeType : string; // same than in the DASH MPD
  codecs : string; // same than in the DASH MPD
  width? : number;
  height? : number;
  index : IRXPIndex;
}

export interface IRXPAdaptation {
  id : string; // unique ID string
  type : "audio"|"video"|"text"|"thumbnail";
  audioDescription? : boolean; // self-explanatory
  closedCaption? : boolean;
  language? : string; // ISO 639-3 code
  representations: IRXPRepresentation[];
}

export interface IRXPPeriod {
  id: string; // unique ID string
  start: number; // the time at which the content begins in this period in ms
  duration: number; // total duration of this period in ms
  adaptations: IRXPAdaptation[];
}

export interface IRXPManifest {
  version: string; // MAJOR.MINOR
                   // MAJOR = previous parser should not parse it
                   // MINOR = retro-compatible
  duration: number; // total duration of the content in ms
  periods: IRXPPeriod[];
}

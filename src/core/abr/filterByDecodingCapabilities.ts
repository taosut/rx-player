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
  combineLatest as observableCombineLatest,
  Observable,
  of as observableOf
} from "rxjs";
import {
  map,
  tap,
} from "rxjs/operators";
import log from "../../log";
import { Representation } from "../../manifest";
import castToObservable from "../../utils/castToObservable";

export interface IVideoConfiguration {
  contentType: string;
  width: number;
  height: number;
  bitrate: number;
  framerate: string;
}

export interface IAudioConfiguration {
  contentType: string;
  channels: number;
  bitrate: number;
  sampleRate: number;
}

type IMediaConfiguration = {
  type: "media-source"|"file";
  video: IVideoConfiguration;
} | {
  type: "media-source"|"file";
  audio: IAudioConfiguration;
} | {
  type: "media-source"|"file";
  video: IVideoConfiguration;
  audio: IAudioConfiguration;
};

interface IDecodingInfos {
  supported: boolean;
  smooth: boolean;
  powerEfficient: boolean;
}

interface IMediaCapabilites {
  decodingInfo: (mediaConfiguration: IMediaConfiguration) => Promise<IDecodingInfos>;
}

/**
 * Get decoding infos from Chrome mediaCapabilites API.
 * If can't use API, return default values.
 * @param {Object} mediaConfiguration
 * @returns {Object}
 */
function getDecodingInfos(
  mediaConfiguration: IMediaConfiguration
): Observable<IDecodingInfos> {
  const mediaCapabilities: (IMediaCapabilites|undefined) =
    (navigator as any).mediaCapabilities;

  if (mediaCapabilities) {
    return castToObservable(
      mediaCapabilities.decodingInfo(mediaConfiguration)
    );
  }

  return observableOf({
    supported: true,
    smooth: true,
    powerEfficient: true,
  });
}

/**
 * Collect media attributes from representation, in order
 * to build a configuration compatible with mediaCapabilities
 * decoding API.
 * @param {Object} representation
 * @param {string} type
 * @returns {Object|null}
 */
function getMediaConfigurationFromRepresentation(
  representation: Representation,
  type: string
): IMediaConfiguration|null {
  let mediaConfiguration: IMediaConfiguration|null = null;
  const contentType = representation.getMimeTypeString();
  if (type === "video") {
    const {
      width,
      height,
      bitrate,
      frameRate,
    } = representation;
    if (
      width != null &&
      height != null &&
      frameRate != null
    ) {
      mediaConfiguration = {
        type: "media-source",
        video: {
          contentType,
          width,
          height,
          bitrate,
          framerate: frameRate,
        },
      };
    }
  } else if (type === "audio") {
    const {
      sampleRate,
      channels,
      bitrate,
    } = representation;
    if (
      sampleRate != null &&
      channels != null
    ) {
      mediaConfiguration = {
        type: "media-source",
        audio: {
          contentType,
          sampleRate,
          bitrate,
          channels,
        },
      };
    }
  }
  return mediaConfiguration;
}

/**
 *
 * Filter representations that are:
 * - not smooth
 * - not power efficient (if wanted)
 * In case were representation does not carry all needed media attributes, do not filter
 * concerned representation.
 *
 * @param {Array.<Object>} representations
 * @param {string} adaptationType
 * @param {boolean} mustBePowerEfficient
 * @returns {Observable}
 */
export default function getDecodableRepresentations(
    representations: Representation[],
    adaptationType: string,
    options?: {
      shouldBeSmooth: boolean;
      shouldBePowerEfficient: boolean;
    }
  ): Observable<Representation[]> {
    if (!options) {
      return observableOf(representations);
    }

    const {
      shouldBeSmooth,
      shouldBePowerEfficient,
    } = options;

    if (!shouldBeSmooth && !shouldBePowerEfficient) {
      return observableOf(representations);
    }
    const decodingsInfos$ = representations.map((representation) => {
      const mediaConfiguration = getMediaConfigurationFromRepresentation(
        representation,
        adaptationType
      );

      return (mediaConfiguration !== null) ?
        getDecodingInfos(mediaConfiguration)
          .pipe(
            tap(() => log.debug(
              "got decoding infos for representation", representation.id)),
            map(({ smooth, powerEfficient }) => {
              return {
                representation,
                smooth,
                powerEfficient,
              };
            })
          ) :
          observableOf({
            representation,
            smooth: true,
            powerEfficient: true,
          });
      }
    );

      return observableCombineLatest(decodingsInfos$)
        .pipe(
          map((list) => {
            return list
              .filter(({ smooth, powerEfficient }) => {
                return (
                  (shouldBeSmooth ? smooth : true) &&
                  (shouldBePowerEfficient ? powerEfficient : true)
                );
              })
              .map(({ representation }) => representation);
          })
        );
  }

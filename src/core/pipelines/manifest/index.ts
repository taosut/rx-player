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
  of as observableOf,
  Subject,
} from "rxjs";
import {
  filter,
  map,
  mergeMap,
  share,
  tap,
} from "rxjs/operators";
import config from "../../../config";
import { ICustomError } from "../../../errors";
import Manifest, {
  ISupplementaryImageTrack,
  ISupplementaryTextTrack,
} from "../../../manifest";
import createManifest from "../../../manifest/factory";
import { ITransportPipelines } from "../../../net";
import {
  IManifestLoaderArguments,
  IManifestResult,
  IPeriodLoaderArguments,
  IPeriodResult,
} from "../../../net/types";
import { IParsedPeriod } from "../../../parsers/manifest/types";
import Pipeline, {
  IPipelineCache,
  IPipelineData,
  IPipelineOptions,
} from "../core_pipeline";

type IPipelineManifestResult =
  IPipelineData<IManifestResult> |
  IPipelineCache<IManifestResult>;

type IPipelinePeriodResult =
  IPipelineData<IPeriodResult> |
  IPipelineCache<IPeriodResult>;

/**
 * Returns pipeline options based on the global config and the user config.
 * @param {Object} networkConfig
 * @returns {Object}
 */
function getPipelineOptions(
  networkConfig: {
    manifestRetry? : number;
    offlineRetry? : number;
  }
) {
  return {
    maxRetry: networkConfig.manifestRetry != null ?
      networkConfig.manifestRetry : config.DEFAULT_MAX_MANIFEST_REQUEST_RETRY,
    maxRetryOffline: networkConfig.offlineRetry != null ?
      networkConfig.offlineRetry : config.DEFAULT_MAX_PIPELINES_RETRY_ON_ERROR,
  };
}

/**
 * Load periods from links in manifest.
 * @param {String} transport
 * @param {Object} pipelineOptions
 * @param {Object} periods
 * @returns {Observable}
 */
function loadPeriodFromLink(
  transport : ITransportPipelines,
  pipelineOptions : IPipelineOptions<IPeriodLoaderArguments, string>,
  periods : IParsedPeriod[]
): Observable<IParsedPeriod[]> {
  const { period: periodPipeline } = transport;
  if (periodPipeline) {
    const periods$ =
      periods.reduce((
        acc: Array<Observable<IParsedPeriod|IParsedPeriod[]>>, period, i
      ) => {
        const prevPeriod = periods[i - 1];
        const nextPeriod = periods[i + 1];
        if (period.linkURL != null) {
          if (period.resolveAtLoad) {
            const period$ = Pipeline<
              IPeriodLoaderArguments, string, IPeriodResult
            >(
              periodPipeline(prevPeriod, nextPeriod), pipelineOptions
            )({ url: period.linkURL });
            acc.push(
              period$.pipe(
                filter((arg): arg is IPipelinePeriodResult =>
                  arg.type === "data" || arg.type === "cache"
                ),
                map((data) => data.value.parsed.periods)
              )
            );
          } else {
            throw new Error(
              "Can\"t lazy load periods.");
          }
        } else {
          acc.push(observableOf(period));
        }
        return acc;
      }, []);

    return observableCombineLatest(
      ... periods$
    ).pipe(
      map((elements) => {
        return elements.reduce((acc: IParsedPeriod[], value) => {
          if ((value as IParsedPeriod[]).length != null) {
            (value as IParsedPeriod[]).forEach((element) => {
              acc.push(element);
            });
          } else {
            acc.push(value as IParsedPeriod);
          }
          return acc;
        }, []);
      })
    );
  } else {
    return observableOf([]);
  }
}

/**
 * Create function allowing to easily fetch and parse the manifest from its URL.
 *
 * @example
 * ```js
 * const manifestPipeline = createManifestPipeline(transport, warning$);
 * manifestPipeline(manifestURL)
 *  .subscribe(manifest => console.log("Manifest:", manifest));
 * ```
 *
 * @param {Object} transport
 * @param {Subject} warning$
 * @param {Array.<Object>|undefined} supplementaryTextTracks
 * @param {Array.<Object>|undefined} supplementaryImageTrack
 * @returns {Function}
 */
export default function createManifestPipeline(
  transport : ITransportPipelines,
  networkConfig: {
    manifestRetry? : number;
    offlineRetry? : number;
    segmentRetry? : number;
  },
  warning$ : Subject<Error|ICustomError>,
  supplementaryTextTracks : ISupplementaryTextTrack[] = [],
  supplementaryImageTracks : ISupplementaryImageTrack[] = []
) : (url : string) => Observable<Manifest> {
  const pipelineOptions = getPipelineOptions(networkConfig);

  return function fetchManifest(url : string) {
    const manifest$ = Pipeline<
      IManifestLoaderArguments, Document|string, IManifestResult
    >(transport.manifest, pipelineOptions)({ url });

    return manifest$.pipe(

      tap((arg) => {
        if (arg.type === "error") {
          warning$.next(arg.value);
        }
      }),

      filter((arg) : arg is IPipelineManifestResult =>
        arg.type === "data" || arg.type === "cache"
      ),

      mergeMap(({ value }) : Observable<Manifest> => {
        const { periods } = value.parsed.manifest;

        return loadPeriodFromLink(transport, pipelineOptions, periods).pipe(
          map((loadedPeriods) => {
            value.parsed.manifest.periods = loadedPeriods;
            return createManifest(
              value.parsed.manifest,
              supplementaryTextTracks,
              supplementaryImageTracks,
              warning$
            );
          })
        );
      }),
      share()
    );
  };
}

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
  of as observableOf,
  Subject
} from "rxjs";
import {
  catchError,
  map,
  startWith,
  tap,
} from "rxjs/operators";
import config from "../../config";
import {
  ICustomError,
  isKnownError,
  NetworkError,
  OtherError,
  RequestError,
} from "../../errors";
import {
  ILoaderEvent,
  ILoaderResponseValue,
  ITransportManifestPipeline,
  ITransportPipeline,
} from "../../net/types";
import castToObservable from "../../utils/castToObservable";
import { tryCatchWithArg } from "../../utils/rx-tryCatch";
import downloadingBackoff from "./backoff";

const {
  MAX_BACKOFF_DELAY_BASE,
  INITIAL_BACKOFF_DELAY_BASE,
} = config;

export interface ILoaderOptions<T, U> {
  cache? : {
    add : (obj : T, arg : ILoaderResponseValue<U>) => void;
    get : (obj : T) => ILoaderResponseValue<U>|null;
  };

  maxRetry : number;
  maxRetryOffline : number;
}

export interface IPipelineLoaderRequestEvent<T> {
  type : "request";
  value : T;
}

interface IPipelineLoaderCachedEvent<T> {
  type : "cache";
  value : ILoaderResponseValue<T>;
}

export type IPipelineLoaderResponse<T, U> =
  Observable<ILoaderEvent<T> |
  IPipelineLoaderCachedEvent<T> |
  IPipelineLoaderRequestEvent<U>
>;

/**
 * Generate a new error from the infos given.
 * Also attach the pipeline type (audio/manifest...) to the _pipelineType_
 * property of the returned error.
 * @param {string} code
 * @param {Error} error
 * @param {Boolean} [fatal=true] - Whether the error is fatal to the content's
 * playback.
 * @returns {Error}
 */
function errorSelector(
  code : string,
  error : Error,
  fatal : boolean = true
) : ICustomError {
  if (!isKnownError(error)) {
    if (error instanceof RequestError) {
      return new NetworkError(code, error, fatal);
    }
    return new OtherError(code, error, fatal);
  }
  return error;
}

/**
 * Generate resolver function.
 *
 * Type parameters:
 *   - T : Argument taken by the resolver
 * @param {Object} transportPipeline
 * @returns {Function}
 */
export function generateResolver<T>(
  transportPipeline : ITransportPipeline
) : (data : T) => Observable<T> {
  // This is valid for me as resolver can be defined. TS playing dumb?
  const { resolver } = transportPipeline as ITransportManifestPipeline;
  return resolver == null ?
    observableOf :
    (data) => {
      return tryCatchWithArg(resolver as any, data)
        .pipe(catchError((error) : Observable<never> => {
          throw errorSelector("PIPELINE_RESOLVE_ERROR", error);
        }));
    };
}

/**
 * Generate loader function to load Manifest/segments.
 *
 * Type parameters:
 *   - T : Argument taken by the loader
 *   - U : Type of data emitted by the loader (e.g. Uint8Array or string)
 * @param {Object} transportPipeline
 * @param {Object} options
 * @param {Subject} errorStream
 * @returns {Function}
 */
function generateLoader<T, U>(
  transportPipeline : ITransportPipeline,
  options : ILoaderOptions<T, U>,
  errorStream : Subject<Error|ICustomError>
) : (data : T) => IPipelineLoaderResponse<U, T> {
  const { loader } = transportPipeline;
  const {
    cache,
    maxRetry,
    maxRetryOffline,
  } = options;

  /**
   * Backoff options given to the backoff retry done with the loader function.
   * @see retryWithBackoff
   */
  const backoffOptions = {
    baseDelay: INITIAL_BACKOFF_DELAY_BASE,
    maxDelay: MAX_BACKOFF_DELAY_BASE,
    maxRetryRegular: maxRetry,
    maxRetryOffline,
    onRetry: (error : Error|ICustomError) => {
      errorStream
        .next(errorSelector("PIPELINE_LOAD_ERROR", error, false));
    },
  };

  /**
   * Load wanted data:
   *   - get it from cache if present
   *   - call the transport loader - with an exponential backoff - if not
   * @param {Object} loaderArgument - Input given to the loader
   * @returns {Observable}
   */
  return (loaderArgument : T) : IPipelineLoaderResponse<U, T> => {
    /**
     * Call the Pipeline's loader with an exponential Backoff.
     * @returns {Observable}
     */
    function startLoaderWithBackoff(
    ) : IPipelineLoaderResponse<U, T> {
      const request$ = downloadingBackoff<ILoaderEvent<U>>(
        tryCatchWithArg<T, ILoaderEvent<U>>(loader as any, loaderArgument),
        backoffOptions
      ).pipe(

        catchError((error : Error|ICustomError) : Observable<never> => {
          throw errorSelector("PIPELINE_LOAD_ERROR", error);
        }),

        tap((arg) => {
          if (arg.type === "response" && cache) {
            cache.add(loaderArgument, arg.value);
          }
        })
      );

      return request$.pipe(
        startWith({
          type: "request" as "request",
          value: loaderArgument,
        })
      );
    }

    const dataFromCache = cache ? cache.get(loaderArgument) : null;

    if (dataFromCache != null) {
      return castToObservable(dataFromCache).pipe(
        map((response) : IPipelineLoaderCachedEvent<U> => {
          return {
            type: "cache" as "cache",
            value: response,
          };
        }),
        catchError(startLoaderWithBackoff)
      );
    }

    return startLoaderWithBackoff();
  };
}

export default generateLoader;

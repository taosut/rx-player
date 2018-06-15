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

import objectAssign from "object-assign";
import {
  concat as observableConcat,
  EMPTY,
  merge as observableMerge,
  Observable,
  of as observableOf,
  Subject,
} from "rxjs";
import {
  finalize,
  map,
  mergeMap,
} from "rxjs/operators";
import { ICustomError } from "../../errors";
import {
  ILoaderProgress,
  ITransportPipeline,
} from "../../net/types";
import generateLoader, {
  generateResolver,
  ILoaderOptions,
} from "./generate_loader";
import generateParser from "./generate_parser";

export interface IPipelineError {
  type : "error";
  value : Error|ICustomError;
}

export interface IPipelineMetrics {
  type : "metrics";
  value : {
    size? : number;
    duration? : number;
  };
}

export interface IPipelineData<T> {
  type : "data";
  value : {
    parsed : T;
  };
}

export interface IPipelineCache<T> {
  type : "cache";
  value : {
    parsed : T;
  };
}

export interface IPipelineRequest<T> {
  type : "request";
  value : T;
}

/**
 * Type parameters:
 *   T: Argument given to the loader
 *   U: Response given by the parser
 */
export type ICorePipelineEvent<T, U> =
  IPipelineRequest<T> |
  ILoaderProgress |
  IPipelineError |
  IPipelineData<U> |
  IPipelineMetrics;

/**
 * TODO All that any casting is ugly
 *
 * Returns function allowing to download the wanted transport object through
 * the resolver -> loader -> parser pipeline.
 *
 * (A transport object can be for example: the manifest, audio and video
 * segments, text, images...)
 *
 * The function returned takes the initial data in arguments and returns an
 * Observable which will emit:
 *
 *   - each time a request begins (type "request").
 *     This is not emitted if the value is retrieved from a local js cache.
 *     This one emit the payload as a value.
 *
 *   - as the request progresses (type "progress").
 *
 *   - each time a request ends (type "metrics").
 *     This one contains informations about the metrics of the request.
 *
 *   - each time a minor request error is encountered (type "error").
 *     With the error as a value.
 *
 *   - Lastly, with the obtained data (type "data" or "cache).
 *
 *
 * Each of these but "error" can be emitted at most one time.
 *
 * This observable will throw if, following the options given, the request and
 * possible retry all failed.
 *
 * This observable will complete after emitting the data.
 *
 * @param {Object} transportObject
 * @param {Object} options
 * @returns {Function}
 *
 * Type parameters:
 *   T: Argument given to the Net's resolver or loader
 *   U: ResponseType of the request
 *   V: Response given by the Net's parser
 */
export default function createPipeline<T, U, V>(
  transportPipeline : ITransportPipeline,
  options : ILoaderOptions<T, U>
) : (x : T) => Observable<ICorePipelineEvent<T, V>> {
  // Subject that will emit non-fatal errors.
  const retryErrorSubject : Subject<Error|ICustomError> = new Subject();

  const resolve$ = generateResolver(transportPipeline);
  const load$ = generateLoader(transportPipeline, options, retryErrorSubject);
  const parse$ = generateParser(transportPipeline as any);

  return function startPipeline(
    resolverInput : T
  ) : Observable<ICorePipelineEvent<T, V>> {
    const pipeline$ : Observable<ICorePipelineEvent<T, V>> =
      resolve$(resolverInput).pipe(
        mergeMap((loaderInput : T) => {
          return load$(loaderInput).pipe(
            mergeMap((arg) => {
              // "cache": data taken from cache by the pipeline
              // "data": the data is available but no request has been done
              // "response": data received through a request
              switch (arg.type) {
                case "cache":
                case "data":
                case "response":
                  const loaderResponse = arg.value;
                  const parserInput =
                    objectAssign({ response: loaderResponse }, loaderInput);

                  // add metrics if a request was made
                  const metrics : Observable<IPipelineMetrics> =
                    arg.type === "response" ?
                    observableOf({
                      type: "metrics" as "metrics",
                      value: {
                        size: arg.value.size,
                        duration: arg.value.duration,
                      },
                    }) : EMPTY;

                  return observableConcat(
                    // TODO Emit metrics after corresponding data?
                    metrics,
                    (parse$ as any)(parserInput).pipe(
                      map(parserResponse => {
                        return {
                          type: "data" as "data",
                          value: objectAssign({
                            parsed: parserResponse,
                          }, parserInput),
                        };
                      })
                    )
                  );
                default:
                  return observableOf(arg);
              }
            }));
        }),
        finalize(() => { retryErrorSubject.complete(); })
      );

    const retryError$ : Observable<IPipelineError> = retryErrorSubject
      .pipe(map(error => ({ type: "error" as "error", value: error })));

    return observableMerge(pipeline$, retryError$);
  };
}

export {
  ILoaderOptions as IPipelineOptions,
};

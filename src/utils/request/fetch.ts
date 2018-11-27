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
  Observer,
  throwError as observableThrow,
} from "rxjs";
import config from "../../config";
import {
  RequestError,
  RequestErrorTypes,
} from "../../errors";

const { DEFAULT_REQUEST_TIMEOUT } = config;

// Interface for "progress" events
export interface IRequestProgress {
  type : "progress";
  value : {
    currentTime : number;
    duration : number;
    size : number;
    sendingTime : number;
    url : string;
    totalSize? : number;
  };
}

// Interface for "response" events
export interface IRequestResponse<T, U> {
  type : "response";
  value : {
    duration : number;
    receivedTime : number;
    responseData : T;
    responseType : U;
    sendingTime : number;
    size : number;
    status : number;
    url : string;
  };
}

// Arguments for the "fetchRequest" utils
export interface IRequestOptions<T, U> {
  url : string;
  headers? : { [ header: string ] : string }|null;
  responseType? : T;
  timeout? : number;
  ignoreProgressEvents? : U;
}

// overloading to the max
function fetchRequest(options :
  IRequestOptions<undefined|null|""|"text", false|undefined>
) : Observable<IRequestResponse<string, "text">|IRequestProgress>;
function fetchRequest(options : IRequestOptions<undefined|null|""|"text", true>) :
  Observable<IRequestResponse<string, "text">>;
function fetchRequest(options : IRequestOptions<"arraybuffer", false|undefined>) :
  Observable<IRequestResponse<ArrayBuffer, "arraybuffer">|IRequestProgress>;
function fetchRequest(options : IRequestOptions<"arraybuffer", true>) :
  Observable<IRequestResponse<ArrayBuffer, "arraybuffer">>;
function fetchRequest(options : IRequestOptions<"document", false|undefined>) :
  Observable<IRequestResponse<Document, "document">|IRequestProgress>;
function fetchRequest(options : IRequestOptions<"document", true>) :
  Observable<IRequestResponse<Document, "document">>;
function fetchRequest(options : IRequestOptions<"json", false|undefined>) :
  Observable<IRequestResponse<object, "json">|IRequestProgress>;
function fetchRequest(options : IRequestOptions<"json", true>) :
  Observable<IRequestResponse<object, "json">>;
function fetchRequest(options : IRequestOptions<"blob", false|undefined>) :
  Observable<IRequestResponse<Blob, "blob">|IRequestProgress>;
function fetchRequest(options : IRequestOptions<"blob", true>) :
  Observable<IRequestResponse<Blob, "blob">>;
function fetchRequest<T>(
  options : IRequestOptions<
    XMLHttpRequestResponseType|null|undefined, false|undefined
  >
) : Observable<
  IRequestResponse<T, XMLHttpRequestResponseType>|IRequestProgress
>;
function fetchRequest<T>(
  options : IRequestOptions<XMLHttpRequestResponseType|null|undefined, true>
) : Observable<IRequestResponse<T, XMLHttpRequestResponseType>>;

function fetchRequest<T>(
  options : IRequestOptions<
    XMLHttpRequestResponseType|null|undefined, boolean|undefined
  >
) : Observable<
  IRequestResponse<T, XMLHttpRequestResponseType>|IRequestProgress
> {
  if (!fetchIsSupported() || window.fetch == null) {
    return observableThrow("Fetch: Fetch is not implemented in your browser.");
  }

  const headers = new Headers();
  const abortController = new AbortController();
  return Observable.create((
    obs : Observer<IRequestResponse<T, string>|IRequestProgress>
  ) => {
    let isCanceled = false;
    let isTimeouted = false;

    if (options.headers != null) {
      const headerNames = Object.keys(options.headers);
      for (let i = 0; i < headerNames.length; i++) {
        const headerName = headerNames[i];
        headers.append(headerName, options.headers[headerName]);
      }
    }

    const wantedTimeout = options.timeout == null ?
      DEFAULT_REQUEST_TIMEOUT : options.timeout;
    const timeout = wantedTimeout == null ? null : window.setTimeout(() => {
      isTimeouted = true;
      abortController.abort();
    }, wantedTimeout);

    const sendingTime = performance.now();
    fetch(options.url, {
      headers,
      method: "GET",
      signal: abortController.signal,
    }).then((response) => {
      if (timeout != null) {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        if (response.status < 200 || response.status >= 300) {
          const errorCode = RequestErrorTypes.ERROR_HTTP_CODE;
          obs.error(new RequestError(null, response.url, response.status, errorCode));
        } else {
          const errorCode = RequestErrorTypes.ERROR_EVENT;
          obs.error(new RequestError(null, response.url, response.status, errorCode));
        }
        return;
      }

      const responseType = !options.responseType || options.responseType === "document" ?
        "text" : options.responseType;

      // // XXX TODO Manage progress events
      // if (hasProgressReader && response.body != null) {
      //   const reader = response.body.getReader();
      //   new ReadableStream
      // }

      return (() => {
        switch (responseType) {
          case "arraybuffer":
            return response.arrayBuffer();
          case "json":
            return response.json();
          case "blob":
            return response.blob();
          case "text":
            return response.text();
        }
      })().then(responseData => {
        const receivedTime = performance.now();

        let size : number;
        if (responseData instanceof ArrayBuffer) {
          size = responseData.byteLength;
        } else {
          const length = response.headers.get("Content-length");
          size = length != null && !isNaN(+length) ? +length : 0;
        }

        obs.next({
          type: "response",
          value: {
            responseType,
            status: response.status,
            url: response.url,
            sendingTime,
            receivedTime,
            duration: receivedTime - sendingTime,
            size,
            responseData,
          },
        });
        obs.complete();
      }).catch(() => {
        const errorCode = RequestErrorTypes.PARSE_ERROR;
        obs.error(new RequestError(null, response.url, response.status, errorCode));
      });
    }).catch(() => {
      if (isCanceled) {
        return;
      }
      const errorCode = isTimeouted ?
        RequestErrorTypes.TIMEOUT : RequestErrorTypes.ERROR_EVENT;
      obs.error(new RequestError(null, options.url, 0, errorCode));
    });

    return () => {
      isCanceled = true;
      abortController.abort();
    };
  });
}

/**
 * Return true if progress events can be sent with the fetch API.
 * @returns {boolean}
 */
export function hasProgressReader() : boolean {
  if (typeof (window as any).ReadableStream === "function") {
    return false;
  }
  try {
    // On Edge, ReadableStream exists, but attempting to construct it results in
    // an error:
    // https://developer.microsoft.com/en-us/microsoft-edge/platform/issues/17375439/
    /* tslint:disable no-unused-expression */
    new (window as any).ReadableStream({});
    /* tslint:enabled no-unused-expression */
  } catch (e) {
    return false;
  }

  return true;
}

/**
 * Returns true if fetch should be supported in the current browser.
 * @return {boolean}
 */
export function fetchIsSupported() : boolean {
  return !!(
    window.fetch &&
    (window as any).AbortController &&
    (window as any).Headers
  );
}

export default fetchRequest;

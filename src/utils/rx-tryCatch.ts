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
  throwError as observableThrow,
} from "rxjs";

/**
 * Try to execute the given function, which returns an Observable.
 * If the function throws, throw the error through an Observable error.
 *
 * Type parameters:
 *   - R: type of the items emitted by the Observable
 * @param {Function} func - A function you want to execute
 * @returns {*} - If it fails, returns a throwing Observable, else the
 * function's result (which should be, in most cases, an Observable).
 */
export default function tryCatch<R>(
  func : () => Observable<R>
) : Observable<R>|Observable<never> {
  try {
    return func();
  } catch (e) {
    return observableThrow(e);
  }
}

/**
 * Like tryCatch but with the possibility to add an argument to the concerned
 * function.
 *
 * Type parameters:
 *   - T: type of the argument given to the function
 *   - R: type of the items emitted by the Observable
 * @param {Function} func - A function you want to execute
 * @param {*} args - The function's argument
 * @returns {*} - If it fails, returns a throwing Observable, else the
 * function's result (which should be, in most cases, an Observable).
 */
export function tryCatchWithArg<T, R>(
  func : (arg : T) => Observable<R>,
  arg : T
) : Observable<R>|Observable<never> {
  try {
    // ugly TS Hack
    return func(arg);
  } catch (e) {
    return observableThrow(e);
  }
}

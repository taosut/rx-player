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
  concat,
  Observable,
  of as observableOf,
  // Subject,
  throwError as observableThrow,
} from "rxjs";
import tryCatch from "../rx-try_catch";

describe("utils - tryCatch (RxJS)", () => {
  it("should return a throwing observable if the function throws", (done) => {
    function func() : Observable<never> {
      throw 4;
    }

    let itemsReceived = 0;
    tryCatch(func, undefined).subscribe(
      () => { itemsReceived++; },
      (err) => {
        expect(itemsReceived).toBe(0);
        expect(err).toBe(4);
        done();
      });
  });

  it("should allow giving optional arguments", (done) => {
    function func(a : number) : Observable<never> {
      expect(a).toBe(4);
      throw new Error();
    }
    tryCatch(func, 4).subscribe(undefined, () => { done(); });
  });

  /* tslint:disable max-line-length */
  it("should emit when the returned Observable emits and complete when it completes", (done) => {
  /* tslint:enable max-line-length */
    function func() {
      return observableOf(1, 2, 3);
    }

    let itemsReceived = 0;
    tryCatch(func, undefined).subscribe(
      (i) => {
        switch (itemsReceived++) {
          case 0:
            expect(i).toBe(1);
            break;
          case 1:
            expect(i).toBe(2);
            break;
          case 2:
            expect(i).toBe(3);
            break;
          default:
            throw new Error("Too much items emitted");
        }
      },
      undefined,
      () => {
        expect(itemsReceived).toBe(3);
        done();
      }
    );
  });

  it("should throw when the returned Observable throws", (done) => {
    function func() {
      return concat(observableOf(1), observableThrow("a"));
    }

    let itemsReceived = 0;
    tryCatch(func, undefined).subscribe(
      (i) => {
        itemsReceived++;
        expect(i).toBe(1);
      },
      (err) => {
        expect(itemsReceived).toBe(1);
        expect(err).toBe("a");
        done();
      }
    );
  });
});

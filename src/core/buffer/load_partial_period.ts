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
  defer as observableDefer,
  Observable,
  of as observableOf,
} from "rxjs";
import {
  mergeMap,
  startWith,
} from "rxjs/operators";
import { MediaError } from "../../errors";
import Manifest, {
  IFetchedPeriod,
  Period,
} from "../../manifest";

/**
 * @param {Object} manifest
 * @param {Object} period
 * @param {Function} periodLoader
 * @param {number} wantedTime
 * @returns {Observable}
 */
export function loadPartialPeriod(
  manifest : Manifest,
  period : Period,
  periodLoader: (period : Period) => Observable<unknown>,
  wantedTime : number
) : Observable<IFetchedPeriod> {
    return observableDefer(() => {
      if (period.isFetched()) {
        return observableOf(period);
      }

      return periodLoader(period)
        .pipe(mergeMap(() => {
          const fetchedPeriod = manifest.getPeriodForTime(wantedTime);
          if (fetchedPeriod == null || !fetchedPeriod.isFetched()) {
            throw new MediaError("MEDIA_TIME_NOT_FOUND", null, true);
          }
          return observableOf(fetchedPeriod);
        }));
    }).pipe(startWith()); // XXX TODO
}

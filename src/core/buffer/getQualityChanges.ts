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
  merge as observableMerge,
  Observable,
  of as observableOf,
} from "rxjs";
import {
  delay,
  finalize,
  share,
  take,
  tap,
} from "rxjs/operators";

interface ITimelineElement {
  representation: any;
  adaptation: any;
  startTime: number;
  endTime: number;
}

interface ITimerElement {
  representation: any;
  adaptation: any;
}

type ITimeline = ITimelineElement[];

type ITimers = Array<Observable<ITimerElement>>;

function createTimer(
  element: ITimelineElement,
  now: number,
  timers: ITimers
) {
  const timeOut = element.startTime - now;

  timers.push(
    observableOf({
      representation: element.representation,
      adaptation: element.adaptation,
    })
      .pipe(
        delay(timeOut * 1000),
        take(1)
      )
  );
}

export default function getQualityChanges(
  timeline: ITimeline, videoElement: HTMLMediaElement) {
  let timers: ITimers = [];
  const now = videoElement.currentTime;
  timeline.forEach((element) => {
    if (element.startTime > now) {
      createTimer(element, now, timers);
    }
  });
  return observableMerge(
    ...timers
  ).pipe(
    // tap((timer) => {
    //   debugger;
    // }),
    finalize(() => {
      timers = [];
    })
  );
}

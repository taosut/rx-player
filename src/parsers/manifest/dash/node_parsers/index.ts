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

import config from "../../../../config";
import generateNewId from "../../../../utils/id";
import {
  normalizeBaseURL,
  resolveURL,
} from "../../../../utils/url";
import { IParsedManifest } from "../../types";
import checkManifestIDs from "../../utils/check_manifest_ids";
import { createMPDIntermediateRepresentation } from "./MPD";

import { getPeriodsFromIntermediate } from "./Period";

export default function parseManifest(
  root: Element,
  uri : string
  // contentProtectionParser?: IContentProtectionParser
) : IParsedManifest {
  // Transform whole MPD into a parsed JS object representation
  const {
    children: rootChildren,
    attributes: rootAttributes,
  } = createMPDIntermediateRepresentation(root);

  const mpdRootURL = resolveURL(normalizeBaseURL(uri), rootChildren.baseURL);

  const parsedPeriods = getPeriodsFromIntermediate(
    rootChildren.periods,
    mpdRootURL,
    rootAttributes
  );

  const parsedMPD : IParsedManifest = {
    availabilityStartTime: (
        rootAttributes.type === "static" ||
        rootAttributes.availabilityStartTime == null
      ) ?  0 : rootAttributes.availabilityStartTime,
    duration: rootAttributes.duration == null ? Infinity : rootAttributes.duration,
    id: rootAttributes.id != null ?
      rootAttributes.id : "gen-dash-manifest-" + generateNewId(),
    periods: parsedPeriods,
    transportType: "dash",
    isLive: rootAttributes.type === "dynamic",
    uris: [uri, ...rootChildren.locations],
    suggestedPresentationDelay: rootAttributes.suggestedPresentationDelay != null ?
      rootAttributes.suggestedPresentationDelay :
      config.DEFAULT_SUGGESTED_PRESENTATION_DELAY.DASH,
  };

  // -- add optional fields --

  if (rootAttributes.profiles != null) {
    parsedMPD.profiles = rootAttributes.profiles;
  }
  if (rootAttributes.type !== "static" && rootAttributes.availabilityEndTime != null) {
    parsedMPD.availabilityEndTime = rootAttributes.availabilityEndTime;
  }
  if (rootAttributes.publishTime != null) {
    parsedMPD.publishTime = rootAttributes.publishTime;
  }
  if (rootAttributes.duration != null) {
    parsedMPD.duration = rootAttributes.duration;
  }
  if (rootAttributes.minimumUpdatePeriod != null) {
    parsedMPD.minimumUpdatePeriod = rootAttributes.minimumUpdatePeriod;
  }
  if (rootAttributes.minBufferTime != null) {
    parsedMPD.minBufferTime = rootAttributes.minBufferTime;
  }
  if (rootAttributes.timeShiftBufferDepth != null) {
    parsedMPD.timeShiftBufferDepth = rootAttributes.timeShiftBufferDepth;
  }
  if (rootAttributes.maxSegmentDuration != null) {
    parsedMPD.maxSegmentDuration = rootAttributes.maxSegmentDuration;
  }
  if (rootAttributes.maxSubsegmentDuration != null) {
    parsedMPD.maxSubsegmentDuration = rootAttributes.maxSubsegmentDuration;
  }

  checkManifestIDs(parsedMPD);
  return parsedMPD;
}

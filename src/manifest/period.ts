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
  ICustomError,
  MediaError,
} from "../errors";
import log from "../log";
import arrayFind from "../utils/array_find";
import arrayIncludes from "../utils/array_includes";
import objectValues from "../utils/object_values";
import Adaptation, {
  IAdaptationArguments,
  IAdaptationType,
  IRepresentationFilter,
  SUPPORTED_ADAPTATIONS_TYPE,
} from "./adaptation";

// Structure listing every `Adaptation` in a Period.
export type IManifestAdaptations = Partial<Record<IAdaptationType, Adaptation[]>>;

export type IAdaptationsArguments =
  Partial<Record<IAdaptationType, IAdaptationArguments[]>>;

// Arguments constitutive of a new Period.
export interface IPeriodArguments {
  // required
  id : string; // unique ID for that Period.
  start : number; // start time of the Period, in seconds.

  // optional
  duration? : number; // duration of the Period, in seconds.
                      // Can be undefined for a still-running one.
  adaptations? : IAdaptationsArguments; // "Tracks" in that Period.
                                        // undefined for "partial" Periods.
}

// Interface which a Period implements.
export interface IPartialPeriod {
  groupId : string;
  id : string;
  isUpToDate : boolean;
  parsingErrors : Array<Error|ICustomError>;
  start : number;
  duration? : number;
  end? : number;
  url? : string;
  getAdaptation(wantedId : number|string) : Adaptation|undefined;
  getAdaptations() : Adaptation[];
  getAdaptationsForType(adaptationType : IAdaptationType) : Adaptation[];
  isFetched() : boolean;
}

// Interface of a `fetched` (or `non-partial`) Period, which is a subset of an
// IPartialPeriod.
export interface IFetchedPeriod extends IPartialPeriod {
  adaptations : IManifestAdaptations;
  isFetched() : true;
}

/**
 * Class representing a single `Period` of the Manifest.
 * A Period contains every informations about the content available for a
 * specific period in time.
 *
 * A Period can be `fetched` or `partial`:
 *   - `partial` periods need to be fetched before all informations on them
 *     are known. We encourage to do this lazily (only when needed) to save
 *     ressources.
 *   - `fetched` periods have all informations you need.
 *
 * Note that a `fetched` period can still be not up-to-date with the Manifest
 * (e.g. when the latter has been refreshed and not the former).
 * This is reflected by the `isUpToDate` property.
 * When that's the case, you're encouraged to re-fetch and update (through the
 * corresponding Manifest's method) that Period when needed.
 * @class Period
 */
export default class Period implements IPartialPeriod {
  /**
   * ID uniquely identifying the Period in the Manifest.
   * @type {string}
   */
  public readonly id : string;

  /**
   * ID identifying the Group this Period is in:
   *   - For Periods which were originally a `partial` Period, this corresponds
   *     to the `partial` Period's Id
   *   - For Periods which never were `partial`, this should be the same as its
   *     regular ID.
   * @type {string}
   */
  public readonly groupId : string;

  /**
   * Every 'Adaptation' in that Period, per type of Adaptation.
   * Can be undefined for Period which are not fetched yet.
   * @type {Object|undefined}
   */
  public adaptations? : IManifestAdaptations;

  /**
   * Duration of this Period, in seconds.
   * `undefined` for still-running Periods.
   * @type {number|undefined}
   */
  public duration? : number;

  /**
   * Absolute start time of the Period, in seconds.
   * @type {number}
   */
  public start : number;

  /**
   * Absolute end time of the Period, in seconds.
   * `undefined` for still-running Periods.
   * @type {number|undefined}
   */
  public end? : number;

  /**
   * Whether this Period is up-to-date with the parent Manifest:
   *   - if true, every informations here is up-to-date
   *   - if false, this Period still contains informations indicated in a
   *     previous version of the Manifest and needs to be refreshed.
   * @type {Boolean}
   */
  public isUpToDate : boolean;

  /**
   * Array containing every errors that happened when the Period has been
   * created, in the order they have happened.
   * @type {Array.<Error>}
   */
  public readonly parsingErrors : Array<Error|ICustomError>;

  /**
   * @constructor
   * @param {Object} args
   * @param {function|undefined} [representationFilter]
   */
  constructor(
    args : IPeriodArguments,
    representationFilter? : IRepresentationFilter
  ) {
    this.parsingErrors = [];
    this.id = this.groupId = args.id;

    const { adaptations } = args;
    if (adaptations != null) {
      this.adaptations = (Object.keys(adaptations) as IAdaptationType[])
        .reduce<IManifestAdaptations>((acc, type) => {
          const adaptationsForType = adaptations[type];
          if (!adaptationsForType) {
            return acc;
          }
          const filteredAdaptations = adaptationsForType
            .filter((adaptation) => {
              if (!arrayIncludes(SUPPORTED_ADAPTATIONS_TYPE, adaptation.type)) {
                log.info("not supported adaptation type", adaptation.type);
                const error =
                  new MediaError("MANIFEST_UNSUPPORTED_ADAPTATION_TYPE", null, false);
                this.parsingErrors.push(error);
                return false;
              } else {
                return true;
              }
            })
            .map((adaptation) => {
              const newAdaptation = new Adaptation(adaptation, representationFilter);
              this.parsingErrors.push(...newAdaptation.parsingErrors);
              return newAdaptation;
            })
            .filter((adaptation) => adaptation.representations.length);
          if (
            filteredAdaptations.length === 0 &&
            adaptationsForType.length > 0 &&
            (type === "video" || type === "audio")
          ) {
            const error = new Error("No supported " + type + " adaptations");
            throw new MediaError("MANIFEST_PARSE_ERROR", error, true);
          }

          if (filteredAdaptations.length) {
            acc[type] = filteredAdaptations;
          }
          return acc;
        }, {});

      if (!this.adaptations.video && !this.adaptations.audio) {
        const error = new Error("No supported audio and video tracks.");
        throw new MediaError("MANIFEST_PARSE_ERROR", error, true);
      }
    }

    this.duration = args.duration;
    this.start = args.start;

    if (this.duration != null && this.start != null) {
      this.end = this.start + this.duration;
    }

    this.isUpToDate = true;
  }

  /**
   * If true, this Period should contain every Adaptations and timings
   * informations.
   * If false, this is still a `partial` Period, and thus we need to fetch the
   * corresponding URL to obtain all its informations.
   * /!\ a single non-fetched Period can correspond to multiple fetched ones.
   * The inverse is not true.
   * @returns {Boolean}
   */
  isFetched() : this is IFetchedPeriod {
    return this.adaptations != null;
  }

  /**
   * Returns every `Adaptations` (or `tracks`) linked to that Period, in an
   * Array.
   * Note that this array is empty for `partial` Periods (Period which are not
   * yet fetched).
   * @returns {Array.<Object>}
   */
  getAdaptations() : Adaptation[] {
    if (!this.isFetched()) {
      return [];
    }
    const adaptationsByType = this.adaptations;
    return objectValues(adaptationsByType)
      .reduce<Adaptation[]>((acc, adaptations) =>
        // Note: the second case cannot happen. TS is just being dumb here
        adaptations != null ? acc.concat(adaptations) : acc,
        []
    );
  }

  /**
   * Returns every `Adaptations` (or `tracks`) linked to that Period for a
   * given type.
   * Note that this array is empty for `partial` Periods (Period which are not
   * yet fetched).
   * @param {string} adaptationType
   * @returns {Array.<Object>}
   */
  getAdaptationsForType(adaptationType : IAdaptationType) : Adaptation[] {
    if (!this.isFetched()) {
      return [];
    }
    return this.adaptations[adaptationType] || [];
  }

  /**
   * Returns the Adaptation linked to the given ID.
   * @param {number|string} wantedId
   * @returns {Object|undefined}
   */
  getAdaptation(wantedId : string) : Adaptation|undefined {
    return arrayFind(this.getAdaptations(), ({ id }) => wantedId === id);
  }
}

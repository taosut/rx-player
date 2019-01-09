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

import parseS from "../S";

describe("DASH Node Parsers - S", () => {
  it("should correctly parse an S element without attributes", () => {
    const element = new DOMParser().parseFromString("<S />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element)).toEqual({});
  });

  it("should correctly parse an S element with a correct `d` attribute", () => {
    const element1 = new DOMParser().parseFromString("<S t=\"012\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element1)).toEqual({ start: 12 });

    const element2 = new DOMParser().parseFromString("<S t=\"0\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element2)).toEqual({ start: 0 });

    const element3 = new DOMParser().parseFromString("<S t=\"-50\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element3)).toEqual({ start: -50 });
  });

  it("should correctly parse an S element with a incorrect `t` attribute", () => {
    const element1 = new DOMParser().parseFromString("<S t=\"toto\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element1)).toEqual({ start: NaN });

    const element2 = new DOMParser().parseFromString("<S t=\"PT5M\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element2)).toEqual({ start: NaN });

    const element3 = new DOMParser().parseFromString("<S t=\"\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element3)).toEqual({ start: NaN });
  });

  it("should correctly parse an S element with a correct `d` attribute", () => {
    const element1 = new DOMParser().parseFromString("<S d=\"012\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element1)).toEqual({ duration: 12 });

    const element2 = new DOMParser().parseFromString("<S d=\"0\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element2)).toEqual({ duration: 0 });

    const element3 = new DOMParser().parseFromString("<S d=\"-50\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element3)).toEqual({ duration: -50 });
  });

  it("should correctly parse an S element with a incorrect `d` attribute", () => {
    const element1 = new DOMParser().parseFromString("<S d=\"toto\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element1)).toEqual({ duration: NaN });

    const element2 = new DOMParser().parseFromString("<S d=\"PT5M\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element2)).toEqual({ duration: NaN });

    const element3 = new DOMParser().parseFromString("<S d=\"\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element3)).toEqual({ duration: NaN });
  });

  it("should correctly parse an S element with a correct `r` attribute", () => {
    const element1 = new DOMParser().parseFromString("<S r=\"012\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element1)).toEqual({ repeatCount: 12 });

    const element2 = new DOMParser().parseFromString("<S r=\"0\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element2)).toEqual({ repeatCount: 0 });

    const element3 = new DOMParser().parseFromString("<S r=\"-50\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element3)).toEqual({ repeatCount: -50 });
  });

  it("should correctly parse an S element with a incorrect `r` attribute", () => {
    const element1 = new DOMParser().parseFromString("<S r=\"toto\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element1)).toEqual({ repeatCount: NaN });

    const element2 = new DOMParser().parseFromString("<S r=\"PT5M\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element2)).toEqual({ repeatCount: NaN });

    const element3 = new DOMParser().parseFromString("<S r=\"\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element3)).toEqual({ repeatCount: NaN });
  });

  it("should correctly parse an S element with every attributes", () => {
    const element1 = new DOMParser()
      .parseFromString("<S t=\"0\" d=\"4\" r=\"12\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element1)).toEqual({ start: 0, repeatCount: 12, duration: 4 });

    const element2 = new DOMParser()
      .parseFromString("<S t=\"99\" d=\"4\" r=\"0\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element2)).toEqual({ start: 99, repeatCount: 0, duration: 4 });
  });

  it("should correctly parse an S element with unknown attributes", () => {
    const element1 = new DOMParser()
      .parseFromString("<S t=\"0\" d=\"4\" r=\"12\" f=\"9\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element1)).toEqual({ start: 0, repeatCount: 12, duration: 4 });

    const element2 = new DOMParser()
      .parseFromString("<S b=\"7000\" />", "text/xml")
      .childNodes[0] as Element;
    expect(parseS(element2)).toEqual({});
  });
});

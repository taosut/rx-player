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

import { expect } from "chai";
import generateKeyRequest from "../generate_key_request";

const CENC_PSSH = [
  0x00, 0x00, 0x00, 0x1D, 0x70, 0x73, 0x73, 0x68, 0x01, 0x00, 0x00, 0x00, 0x10,
  0x77, 0xEF, 0xEC, 0xC0, 0xB2, 0x4D, 0x02, 0xAC, 0xE3, 0x3C, 0x1E, 0x52, 0xE2,
  0xFB, 0x4B, 0x00,
];

const PSSH1 = [
  0x00, 0x00, 0x00, 0x1F, 0x70, 0x73, 0x73, 0x68, 0x00, 0x00, 0x00, 0x00, 0x9A,
  0x04, 0xF0, 0x79, 0x98, 0x40, 0x42, 0x86, 0xAB, 0x92, 0xE6, 0x5B, 0xE0, 0x88,
  0x5F, 0x95, 0x34, 0xA5, 0x87,
];

const PSSH2 = [
  0x00, 0x00, 0x00, 0x21, 0x70, 0x73, 0x73, 0x68, 0x00, 0x00, 0x00, 0x00, 0xED,
  0xEF, 0x8B, 0xA9, 0x79, 0xD6, 0x4A, 0xCE, 0xA3, 0xC8, 0x27, 0xDC, 0xD5, 0x1D,
  0x21, 0xED, 0x98, 0xF5, 0x12, 0x00, 0x01,
];

const PSSH3 = [
  0x00, 0x00, 0x00, 0x1D, 0x70, 0x73, 0x73, 0x68, 0x00, 0x00, 0x00, 0x00, 0xAD,
  0xB4, 0x1C, 0x24, 0x2D, 0xBF, 0x4A, 0x6D, 0x95, 0x8B, 0x44, 0x57, 0xC0, 0xD2,
  0x7B, 0x95, 0x00,
];

const initData = new Uint8Array([...CENC_PSSH, ...PSSH1, ...PSSH2, ...PSSH3 ]);

describe("Compat: generateKeyRequest", () => {
  /* tslint:disable max-line-length */
  it("should call session.generateRequest with the given arguments on subscription", (done) => {
    /* tslint:enable max-line-length */
    let generateRequestHasBeenCalled = 0;
    const falseSession = {
      generateRequest(initDataType : string, data : ArrayBuffer|Uint8Array) {
        expect(initDataType).to.equal("toto");
        expect(data).to.eql(initData);
        generateRequestHasBeenCalled++;

        /* tslint:disable ban */
        return Promise.resolve(12);
        /* tslint:enable ban */
      },
    };

    const obs = generateKeyRequest(falseSession as any, initData, "toto");
    let receivedRequestResponse = false;

    expect(generateRequestHasBeenCalled).to.equal(0);

    obs.subscribe(
      (i) => {
        expect(generateRequestHasBeenCalled).to.equal(1);
        expect(receivedRequestResponse).to.equal(false);
        expect(i).to.equal(12);
        receivedRequestResponse = true;
      },
      undefined,
      () => {
        expect(receivedRequestResponse).to.equal(true);
        done();
      }
    );
  });

  // TODO We should be able to inject a dependency to test the isIE11 cases.
  // I tried, with linking "rewire" to webpack or adding it as a babel plugin
  // but it did not work. After multiple hours trying to do just that, I gave
  // up.
});

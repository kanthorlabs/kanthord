import { test } from "node:test";
import assert from "node:assert/strict";

import { checkBasicAuth, BASIC_CHALLENGE } from "./basic-auth.ts";

const KEY = "0123456789abcdef0123456789abcdef";

const enc = (u: string, p: string) =>
  "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

test('BASIC_CHALLENGE is exactly Basic realm="kanthord"', () => {
  assert.equal(BASIC_CHALLENGE, 'Basic realm="kanthord"');
});

const trueCases: Array<[string, string | undefined]> = [
  ["correct key, standard username", enc("kanthord", KEY)],
  ["correct key, scheme 'basic'", "basic " + enc("kanthord", KEY).slice(6)],
  ["correct key, scheme 'BASIC'", "BASIC " + enc("kanthord", KEY).slice(6)],
  ["correct key, empty username", enc("", KEY)],
];

for (const [name, header] of trueCases) {
  test(`checkBasicAuth accepts: ${name}`, () => {
    assert.equal(checkBasicAuth(header, KEY), true);
  });
}

const falseCases: Array<[string, string | undefined]> = [
  ["undefined header", undefined],
  ["empty header", ""],
  ["scheme only, no space", "Basic"],
  ["scheme with trailing space, no payload", "Basic "],
  ["wrong scheme Bearer", "Bearer " + KEY],
  [
    "same-length wrong key",
    "Basic " +
      Buffer.from("kanthord:" + KEY.slice(0, -1) + "0").toString("base64"),
  ],
  [
    "different-length wrong key",
    "Basic " + Buffer.from("kanthord:short").toString("base64"),
  ],
  ["non-base64 payload", "Basic !!!not-base64!!!"],
  [
    "base64 payload with no colon",
    "Basic " + Buffer.from("no-colon-here").toString("base64"),
  ],
  ["empty password", "Basic " + Buffer.from("kanthord:").toString("base64")],
];

for (const [name, header] of falseCases) {
  test(`checkBasicAuth rejects: ${name}`, () => {
    assert.equal(checkBasicAuth(header, KEY), false);
  });
}

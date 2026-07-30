// src/apps/http/etag.test.ts — etagOf: the strong validator hashing a presented DTO (EPIC 021 S1).
import test from "node:test";
import assert from "node:assert/strict";
import { etagOf } from "./etag.ts";

test("etagOf returns a quoted 64-hex-char sha256 digest", () => {
  assert.match(etagOf({ a: 1 }), /^"[0-9a-f]{64}"$/);
});

test("etagOf hashes two structurally identical DTOs equal", () => {
  assert.equal(etagOf({ id: "x", name: "n" }), etagOf({ id: "x", name: "n" }));
});

test("etagOf hashes a DTO with one changed field different", () => {
  assert.notEqual(
    etagOf({ id: "x", name: "n" }),
    etagOf({ id: "x", name: "m" }),
  );
});

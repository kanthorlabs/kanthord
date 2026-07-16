import { test } from "node:test";
import assert from "node:assert/strict";
import { newId } from "./entity.ts";

const CROCKFORD_ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

test("newId() returns a 26-character Crockford-base32 ULID", () => {
  const id = newId();
  assert.match(id, CROCKFORD_ULID);
});

test("1000 consecutive newId() results are strictly increasing", () => {
  const ids: string[] = [];
  for (let i = 0; i < 1000; i++) {
    ids.push(newId());
  }
  for (let i = 1; i < ids.length; i++) {
    const prev = ids[i - 1]!;
    const curr = ids[i]!;
    assert.ok(
      prev < curr,
      `id[${i - 1}] (${prev}) >= id[${i}] (${curr}) — not strictly increasing`,
    );
  }
});

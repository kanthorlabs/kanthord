import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_PORT, InvalidPortError, parsePort } from "./serve.ts";

describe("src/apps/cli/serve.ts", () => {
  test("DEFAULT_PORT is 4100", () => {
    assert.equal(DEFAULT_PORT, 4100);
  });

  test("parsePort(undefined) returns the default port", () => {
    assert.equal(parsePort(undefined), 4100);
  });

  test("parsePort('0') returns 0 (ephemeral)", () => {
    assert.equal(parsePort("0"), 0);
  });

  test("parsePort('4100') returns 4100", () => {
    assert.equal(parsePort("4100"), 4100);
  });

  test("parsePort('65535') returns 65535", () => {
    assert.equal(parsePort("65535"), 65535);
  });

  for (const bad of ["abc", "-1", "1.5", "65536", ""]) {
    test(`parsePort(${JSON.stringify(bad)}) throws InvalidPortError`, () => {
      assert.throws(() => parsePort(bad), InvalidPortError);
    });
  }

  test("InvalidPortError carries the fixed message", () => {
    try {
      parsePort("abc");
      assert.fail("expected parsePort to throw");
    } catch (err) {
      assert.ok(err instanceof InvalidPortError);
      assert.equal(
        (err as Error).message,
        "--port must be an integer between 0 and 65535",
      );
    }
  });
});

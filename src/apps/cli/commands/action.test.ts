import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { emitResult } from "./action.ts";

describe("src/apps/cli/commands/action.ts", () => {
  test("writes each stdout line with a newline and preserves a successful exit code", () => {
    const out: string[] = [];
    const err: string[] = [];
    const exitCodes: number[] = [];

    emitResult(
      { exitCode: 0, stdout: ["a", "b"], stderr: [] },
      {
        out: (text) => out.push(text),
        err: (text) => err.push(text),
        setExitCode: (code) => exitCodes.push(code),
      },
    );

    assert.deepEqual(out, ["a\n", "b\n"]);
    assert.deepEqual(err, []);
    assert.deepEqual(exitCodes, [0]);
  });

  test("writes stderr lines with a newline and preserves a failing exit code", () => {
    const out: string[] = [];
    const err: string[] = [];
    const exitCodes: number[] = [];

    emitResult(
      { exitCode: 1, stdout: [], stderr: ["first", "second"] },
      {
        out: (text) => out.push(text),
        err: (text) => err.push(text),
        setExitCode: (code) => exitCodes.push(code),
      },
    );

    assert.deepEqual(out, []);
    assert.deepEqual(err, ["first\n", "second\n"]);
    assert.deepEqual(exitCodes, [1]);
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { runCli } from "./run-cli.ts";

describe("src/apps/cli/commands/run-cli.ts", () => {
  test("returns bare successful output without exiting the process", async () => {
    const deps = {
      migrateDb: {
        execute: async () => ({
          version: 1,
          applied: [{ version: 1, name: "initial" }],
        }),
      },
    } as unknown as Parameters<typeof runCli>[1];

    const result = await runCli(["db", "migrate"], deps);

    assert.deepEqual(result, {
      exitCode: 0,
      stdout: ["applied: 1 initial"],
      stderr: [],
    });
  });

  test("maps an unknown command to a non-zero captured error", async () => {
    const result = await runCli(
      ["bogus"],
      {} as unknown as Parameters<typeof runCli>[1],
    );

    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout.length, 0);
    assert.ok(result.stderr.some((line) => /unknown command/i.test(line)));
  });
});

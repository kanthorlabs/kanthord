import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import { buildCheckCommand } from "./check.ts";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  let code = 0;

  return {
    io: {
      out: (text: string) => out.push(text),
      err: (text: string) => err.push(text),
      setExitCode: (exitCode: number) => {
        code = exitCode;
      },
    },
    out,
    err,
    code: () => code,
  };
}

describe("src/apps/cli/commands/check.ts", () => {
  test("checks the graph at the supplied required path and emits its result", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kanthord-check-"));
    const path = join(directory, "graph.yaml");
    await writeFile(path, "tasks:\n  - id: task-1\n");
    const cap = capture();
    const command = buildCheckCommand(
      {} as Parameters<typeof buildCheckCommand>[0],
      cap.io as Parameters<typeof buildCheckCommand>[1],
    );

    try {
      await command.parseAsync(["graph", "--path", path], { from: "user" });

      assert.deepEqual(cap.out, ["task-1: ready\n"]);
      assert.deepEqual(cap.err, []);
      assert.equal(cap.code(), 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects graph without its required path option", async () => {
    const cap = capture();
    const command = buildCheckCommand(
      {} as Parameters<typeof buildCheckCommand>[0],
      cap.io as Parameters<typeof buildCheckCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(
      command.parseAsync(["graph"], { from: "user" }),
      (error: { code?: string }) =>
        error.code === "commander.missingMandatoryOptionValue",
    );
  });

  test("documents the graph command with its canonical usage and example", async () => {
    const cap = capture();
    const command = buildCheckCommand(
      {} as Parameters<typeof buildCheckCommand>[0],
      cap.io as Parameters<typeof buildCheckCommand>[1],
    ).exitOverride();
    command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

    await assert.rejects(
      command.parseAsync(["graph", "--help"], { from: "user" }),
    );

    assert.match(cap.out.join(""), /Usage: kanthord check graph/);
    assert.match(cap.out.join(""), /Example/);
  });
});

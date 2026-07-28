/**
 * Story 6 (EPIC 013) — CLI command-tree test for `abandon task --id --reason`.
 *
 * Drives the **built** commander command tree (buildAbandonTaskCommand), not
 * just the handler runAbandonTask. A handler-only test would pass while the
 * CLI command stayed broken — this test catches the gap at the parse level.
 *
 * Mirrors the convention of `src/apps/cli/commands/retry/task.test.ts` (the
 * Story 2 S2 / Story B / Story D tests) and the `capture()` helper from
 * `src/apps/cli/commands/mutation.test.ts:16-33`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Command, CommanderError } from "commander";

import { buildAbandonTaskCommand } from "./task.ts";
import type { CliDeps } from "../../deps.ts";
import type { CliIo } from "../action.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CapturedInput = { taskId: string; reason: string };
type CapturedOutcome = {
  outcome: "abandoning" | "already_abandoning";
  taskId: string;
};

function makeMockAbandonTask(
  outcome: CapturedOutcome = { outcome: "abandoning", taskId: "task-1" },
) {
  let captured: CapturedInput | undefined;
  return {
    execute: async (input: CapturedInput) => {
      captured = input;
      return outcome;
    },
    getCaptured: () => captured,
  } as unknown as CliDeps["abandonTask"] & {
    getCaptured(): CapturedInput | undefined;
  };
}

function makeIo(): {
  io: CliIo;
  stdout: string[];
  stderr: string[];
  code: () => number;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode = 0;
  return {
    io: {
      out: (text: string) => stdout.push(text),
      err: (text: string) => stderr.push(text),
      setExitCode: (code: number) => {
        exitCode = code;
      },
    },
    stdout,
    stderr,
    // A getter, not a snapshot: the handler sets the exit code after
    // `makeIo()` returns, so a by-value `exitCode` could never fail.
    code: () => exitCode,
  };
}

/** Parse args through buildAbandonTaskCommand and return captured result. */
async function parseAbandonTask(args: string[]): Promise<{
  exitCode: number;
  stdout: string[];
  stderr: string[];
  captured?: CapturedInput;
  thrown?: CommanderError;
}> {
  const mock = makeMockAbandonTask();
  const { io, stdout, code } = makeIo();
  const deps = { abandonTask: mock } as unknown as CliDeps;

  const command = buildAbandonTaskCommand(deps, io);
  command.exitOverride();
  const writtenOut: string[] = [];
  const writtenErr: string[] = [];
  command.configureOutput({
    writeOut: (text: string) => writtenOut.push(text),
    writeErr: (text: string) => writtenErr.push(text),
  });

  let thrown: CommanderError | undefined;
  try {
    await command.parseAsync(args, { from: "user" });
  } catch (err) {
    thrown = err as CommanderError;
    return {
      exitCode: thrown.exitCode ?? 1,
      // emitResult routes handler.stdout through io.out(...) — captured in
      // the `makeIo()` `stdout` array, NOT in command's `writeOut` (which
      // is reserved for Commander's own output: help text, parse errors,
      // version). For a thrown CommanderError nothing was emitted through
      // io, so `stdout` is empty.
      stdout,
      stderr: writtenErr,
      captured: mock.getCaptured(),
      thrown,
    };
  }

  return {
    exitCode: code(),
    // Same as the thrown branch: handler stdout flows through the CliIo mock,
    // not through command.configureOutput. See emitResult (action.ts:22-26).
    stdout,
    stderr: writtenErr,
    captured: mock.getCaptured(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("(013 S6) abandon task --id <id> --reason <reason>: parses via buildAbandonTaskCommand, calls AbandonTask.execute, exits 0", async () => {
  const result = await parseAbandonTask([
    "--id",
    "task-1",
    "--reason",
    "stuck",
  ]);

  assert.equal(
    result.exitCode,
    0,
    `abandon task with --id and --reason must exit 0; got ${result.exitCode}, stderr: ${result.stderr.join(", ")}`,
  );
  assert.ok(
    result.captured !== undefined,
    "AbandonTask.execute must have been called",
  );
  assert.deepEqual(
    result.captured,
    { taskId: "task-1", reason: "stuck" },
    "abandonTask.execute must receive exactly { taskId: 'task-1', reason: 'stuck' }",
  );
  // The handler writes the task id to stdout (so the operator can pipe it
  // into jq / the next command). See runAbandonTask.
  assert.ok(
    result.stdout.some((l) => l === "task-1\n"),
    `stdout must contain 'task-1\\n'; got: ${JSON.stringify(result.stdout)}`,
  );
});

test("(013 S6) abandon task without --id: non-zero exit (commander requiredOption), no use-case call", async () => {
  const cap = capture();
  const command = buildAbandonTaskCommand(
    {} as Parameters<typeof buildAbandonTaskCommand>[0],
    cap.io as Parameters<typeof buildAbandonTaskCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await assert.rejects(
    command.parseAsync(["--reason", "stuck"], { from: "user" }),
    (error: { code?: string }) =>
      error.code === "commander.missingMandatoryOptionValue",
    "abandon task without --id must reject with commander.missingMandatoryOptionValue",
  );
});

test("(013 S6) abandon task without --reason: non-zero exit (commander requiredOption), no use-case call", async () => {
  const cap = capture();
  const command = buildAbandonTaskCommand(
    {} as Parameters<typeof buildAbandonTaskCommand>[0],
    cap.io as Parameters<typeof buildAbandonTaskCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await assert.rejects(
    command.parseAsync(["--id", "task-1"], { from: "user" }),
    (error: { code?: string }) =>
      error.code === "commander.missingMandatoryOptionValue",
    "abandon task without --reason must reject with commander.missingMandatoryOptionValue",
  );
});

test("(013 S6) abandon task help text includes Usage: line and Example", async () => {
  const cap = capture();
  const command = buildAbandonTaskCommand(
    {} as Parameters<typeof buildAbandonTaskCommand>[0],
    cap.io as Parameters<typeof buildAbandonTaskCommand>[1],
  ).exitOverride();
  command.configureOutput({ writeOut: cap.io.out, writeErr: cap.io.err });

  await assert.rejects(command.parseAsync(["--help"], { from: "user" }));

  const help = cap.out.join("");
  assert.match(
    help,
    /Usage: kanthord abandon task/,
    `help must contain 'Usage: kanthord abandon task'; got: ${help}`,
  );
  assert.match(help, /--id <id>/, `help must declare --id; got: ${help}`);
  assert.match(
    help,
    /--reason <reason>/,
    `help must declare --reason; got: ${help}`,
  );
  assert.match(help, /Example/i, `help must include an Example; got: ${help}`);
});

// ---------------------------------------------------------------------------
// local capture() helper — mirrors mutation.test.ts:16-33
// ---------------------------------------------------------------------------

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

/**
 * Story 2 (007.8 A4) — CLI command-tree test for `retry task --note`.
 *
 * Drives the **built** commander command tree (buildRetryTaskCommand), not just
 * the handler runRetryTask. A handler-only test would pass while the CLI command
 * stayed broken — this test catches the gap at the parse level.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Command, CommanderError } from "commander";

import { buildRetryTaskCommand } from "./task.ts";
import type { CliDeps } from "../../deps.ts";
import type { CliIo } from "../action.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CapturedInput = { taskId: string; note?: string; rebuild?: boolean };

function makeMockRetryTask() {
  let captured: CapturedInput | undefined;
  return {
    execute: async (input: CapturedInput) => {
      captured = input;
    },
    getCaptured: () => captured,
  } as unknown as CliDeps["retryTask"] & {
    getCaptured(): CapturedInput | undefined;
  };
}

function makeIo(): {
  io: CliIo;
  stdout: string[];
  stderr: string[];
  exitCode: number;
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
    exitCode,
  };
}

/** Parse args through buildRetryTaskCommand and return captured result. */
async function parseRetryTask(args: string[]): Promise<{
  exitCode: number;
  stdout: string[];
  stderr: string[];
  captured?: CapturedInput;
}> {
  const mock = makeMockRetryTask();
  const { io, stdout, stderr, exitCode: capturedExitCode } = makeIo();
  const deps = { retryTask: mock } as unknown as CliDeps;

  const command = buildRetryTaskCommand(deps, io);
  command.exitOverride();
  const writtenOut: string[] = [];
  const writtenErr: string[] = [];
  command.configureOutput({
    writeOut: (text) => writtenOut.push(text),
    writeErr: (text) => writtenErr.push(text),
  });

  let thrown: Error | undefined;
  try {
    await command.parseAsync(args, { from: "user" });
  } catch (err) {
    thrown = err as Error;
    // CommanderError carries exitCode in its .exitCode property
    const ce = err as CommanderError;
    return {
      exitCode: ce.exitCode ?? 1,
      stdout: writtenOut,
      stderr: [ce.message],
      captured: mock.getCaptured(),
    };
  }

  return {
    exitCode: capturedExitCode,
    stdout: writtenOut,
    stderr: writtenErr,
    captured: mock.getCaptured(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('(S2-cli-retry-note) retry task --id t1 --note "hi" parses via buildRetryTaskCommand and passes note to RetryTask.execute', async () => {
  const result = await parseRetryTask(["--id", "t1", "--note", "hi"]);

  // Currently RED: the command tree has no --note option, so parseAsync throws
  // CommanderError("unknown option '--note'") and exitCode is non-zero.
  // After GREEN: the option exists, exitCode is 0, and captured includes note.
  assert.equal(
    result.exitCode,
    0,
    `retry task with --note must exit 0; got ${result.exitCode}, stderr: ${result.stderr.join(", ")}`,
  );
  assert.ok(
    result.captured !== undefined,
    "RetryTask.execute must have been called",
  );
  assert.equal(result.captured!.taskId, "t1", "taskId must be forwarded");
  assert.equal(
    result.captured!.note,
    "hi",
    "note must be forwarded to RetryTask.execute from the --note CLI arg",
  );
});

test("(S2-cli-retry-no-note) retry task --id t1 (no --note) passes note: undefined to RetryTask.execute", async () => {
  // Parse without --note; the first test already confirms the --id option works.
  const mock = makeMockRetryTask();
  const { io } = makeIo();
  const deps = { retryTask: mock } as unknown as CliDeps;

  const command = buildRetryTaskCommand(deps, io);
  command.exitOverride();
  command.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });

  let thrown: Error | undefined;
  try {
    await command.parseAsync(["--id", "t1"], { from: "user" });
  } catch (err) {
    thrown = err as Error;
  }

  assert.equal(
    thrown,
    undefined,
    `parsing retry task --id t1 must not throw; threw: ${thrown?.message ?? "none"}`,
  );
  const captured = mock.getCaptured();
  assert.ok(captured !== undefined, "RetryTask.execute must have been called");
  assert.equal(captured!.taskId, "t1", "taskId must be forwarded");
  assert.equal(
    captured!.note,
    undefined,
    "note must be undefined when --note is not provided",
  );
});

// Story B (007.10 F2) — --rebuild flag parses via buildRetryTaskCommand
test("(StoryB-cli-command-rebuild) retry task --id t1 --rebuild parses via buildRetryTaskCommand and passes rebuild:true to RetryTask.execute", async () => {
  const result = await parseRetryTask(["--id", "t1", "--rebuild"]);

  assert.equal(
    result.exitCode,
    0,
    `retry task with --rebuild must exit 0; got ${result.exitCode}, stderr: ${result.stderr.join(", ")}`,
  );
  assert.ok(
    result.captured !== undefined,
    "RetryTask.execute must have been called",
  );
  assert.equal(result.captured!.taskId, "t1", "taskId must be forwarded");
  assert.equal(
    result.captured!.rebuild,
    true,
    "rebuild:true must be forwarded to RetryTask.execute from the --rebuild CLI flag",
  );
});

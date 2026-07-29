import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runQueueList } from "./queue.ts";
import type { GetDecisionQueue } from "../../app/project/get-decision-queue.ts";
import type { DecisionItem } from "../../domain/decision-queue.ts";
import { UnknownReferenceError } from "../../domain/errors.ts";

function fakeQueue(
  output: {
    items: DecisionItem[];
    counts: { total: number; byKind: Record<string, number> };
    truncated: boolean;
    /** Review blocker R3-S3 — non-fatal degradation warnings from the use case. */
    warnings?: string[];
  },
  onExecute?: (input: { limit?: number }) => void,
): GetDecisionQueue {
  return {
    execute: async (input: { limit?: number }) => {
      onExecute?.(input);
      return { warnings: [], ...output };
    },
  } as unknown as GetDecisionQueue;
}

const sampleItem: DecisionItem = {
  verdicts: [
    { kind: "retry", target: { type: "task", id: "t1" }, requiresInput: [] },
  ],
  kindLabel: "operational-failure",
  projectId: "p1",
  projectName: "Alpha",
  initiativeId: "i1",
  taskId: "t1",
  downstream: 3,
  actionableSince: 42,
  evidence: {
    basis: "verification-and-summary",
    diffAvailable: false,
    inspect: null,
  },
};

test("(017-S6-cli-queue-json) --json stdout is one JSON element", async () => {
  const output = {
    items: [sampleItem],
    counts: { total: 1, byKind: { "operational-failure": 1 } },
    truncated: false,
  };
  const result = await runQueueList({ json: true }, fakeQueue(output));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, 1);
  // review R4 — `warnings` travels on stderr in both modes, so it is NOT
  // duplicated into the JSON payload; stdout stays purely the data contract.
  assert.deepEqual(JSON.parse(result.stdout[0]!), output);
  assert.ok(
    !Object.hasOwn(JSON.parse(result.stdout[0]!) as object, "warnings"),
    "--json stdout must not carry warnings; they go to stderr",
  );
});

test("(017-S6-cli-queue-limit-invalid) --limit abc exits 1 with the exact message", async () => {
  const result = await runQueueList(
    { limit: "abc" },
    fakeQueue({
      items: [],
      counts: { total: 0, byKind: {} },
      truncated: false,
    }),
  );
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stderr, [
    "error: --limit must be a positive integer, got: abc",
  ]);
});

test("(017-S6-cli-queue-limit-zero) --limit 0 exits 1", async () => {
  const result = await runQueueList(
    { limit: "0" },
    fakeQueue({
      items: [],
      counts: { total: 0, byKind: {} },
      truncated: false,
    }),
  );
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stderr, [
    "error: --limit must be a positive integer, got: 0",
  ]);
});

test("(017-S6-cli-queue-limit-forwarded) a valid --limit is forwarded to GetDecisionQueue.execute as a number", async () => {
  let seen: { limit?: number } | undefined;
  const result = await runQueueList(
    { limit: "5" },
    fakeQueue(
      { items: [], counts: { total: 0, byKind: {} }, truncated: false },
      (input) => (seen = input),
    ),
  );
  assert.equal(result.exitCode, 0);
  assert.deepEqual(seen, { limit: 5 });
});

// ---------------------------------------------------------------------------
// Review blocker S4 — `runQueueList` calls `getDecisionQueue.execute(...)`
// unguarded, unlike `runGetTask`/`runGetObjective`'s try/`toResult` pattern;
// a repository throw must surface as exit 1 with one stderr line, not an
// unhandled rejection out of the handler.
// ---------------------------------------------------------------------------

test("(017-S4-cli-queue-execute-throws) a GetDecisionQueue.execute throw surfaces as exit 1 with one stderr line, not a rejected/thrown promise out of runQueueList", async () => {
  const throwingQueue = {
    execute: async () => {
      throw new UnknownReferenceError("project", "p1");
    },
  } as unknown as GetDecisionQueue;

  const result = await runQueueList({}, throwingQueue);

  assert.equal(
    result.exitCode,
    1,
    "a repository/use-case throw must be reported as exit 1, not propagate out of runQueueList",
  );
  assert.equal(
    result.stderr.length,
    1,
    `must emit exactly one stderr line; got: ${JSON.stringify(result.stderr)}`,
  );
});

test("(017-S6-cli-queue-text) text form contains one line per item plus a total: line", async () => {
  const output = {
    items: [sampleItem],
    counts: { total: 1, byKind: { "operational-failure": 1 } },
    truncated: false,
  };
  const result = await runQueueList({}, fakeQueue(output));
  assert.equal(result.exitCode, 0);
  assert.equal(
    result.stdout.some(
      (l) =>
        l.includes("operational-failure") &&
        l.includes("Alpha") &&
        l.includes("t1") &&
        l.includes("downstream=3") &&
        l.includes("verdicts=retry"),
    ),
    true,
    `expected an item line, got: ${JSON.stringify(result.stdout)}`,
  );
  assert.equal(
    result.stdout.some((l) => l.includes("total: 1")),
    true,
  );
  assert.equal(
    result.stdout.some((l) => l.includes("truncated: false")),
    true,
  );
});

// ---------------------------------------------------------------------------
// Review blocker S6 — `src/apps/cli/queue.ts:11` returns an inline
// `{exitCode, stdout, stderr}` literal instead of the shared `HandlerResult`
// type the other CLI handlers use (exported from
// `src/apps/cli/project-readiness.ts`, the only currently-exported
// `HandlerResult` in `apps/cli/`). This is a source-shape regression, not a
// runtime-observable one, so it is pinned by reading the source text: the
// file must `import type { HandlerResult }` from a sibling handler module and
// use it as `runQueueList`'s return type, not redeclare the same three-field
// literal inline.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Review blocker R3-S3 (HUMAN DECISION) — `GetDecisionQueue.execute` may now
// return non-fatal `warnings: string[]` (one per home whose commit probe
// failed and was degraded rather than thrown). The use case stays read-only
// and must not print; `runQueueList` is the seam that writes each warning
// verbatim to stderr, while stdout/exit code stay driven by the (still
// rendered) items.
// ---------------------------------------------------------------------------

test("(017-R3-S3-cli-queue-warnings) use-case warnings surface as stderr lines verbatim; stdout and exit code are unaffected", async () => {
  const warnings = [
    "warning: commit probe failed for /homes/repo-fail (boom); inspect omitted for 2 affected element(s)",
  ];
  const output = {
    items: [sampleItem],
    counts: { total: 1, byKind: { "operational-failure": 1 } },
    truncated: false,
    warnings,
  };
  const result = await runQueueList({}, fakeQueue(output));
  assert.equal(
    result.exitCode,
    0,
    "a degraded home must not fail the whole queue command",
  );
  assert.deepEqual(
    result.stderr,
    warnings,
    "the use case's warnings must reach stderr verbatim, one line each",
  );
  assert.equal(
    result.stdout.some((l) => l.includes("total: 1")),
    true,
    "the rest of the queue must still render on stdout",
  );
});

test("(017-R3-S3-cli-queue-no-warnings) no warnings -> stderr stays empty", async () => {
  const output = {
    items: [sampleItem],
    counts: { total: 1, byKind: { "operational-failure": 1 } },
    truncated: false,
  };
  const result = await runQueueList({}, fakeQueue(output));
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stderr, []);
});

test("(017-S6-shared-handler-result) queue.ts imports the shared HandlerResult type instead of redeclaring an inline literal", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./queue.ts", import.meta.url)),
    "utf8",
  );

  assert.match(
    src,
    /import\s+(type\s+)?\{[^}]*\bHandlerResult\b[^}]*\}\s+from\s+["'][^"']+["']/,
    "queue.ts must import the shared HandlerResult type used by other CLI handlers",
  );
  assert.equal(
    /\{\s*exitCode:\s*number;\s*stdout:\s*string\[\];\s*stderr:\s*string\[\];?\s*\}/.test(
      src,
    ),
    false,
    "queue.ts must not declare its own inline HandlerResult-shaped literal return type",
  );
});

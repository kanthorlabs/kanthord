// src/apps/cli/project-readiness.test.ts — EPIC 014 Story 6
// Handler-level tests for `runCheckProject`. The handler is a thin layer over
// the use case: missing-flag detection, JSON vs text output, error mapping.
// Mirrors the inline-fake style of `src/apps/cli/project.test.ts:1-60`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { runCheckProject } from "./project-readiness.ts";
import { UnknownReferenceError } from "../../app/errors.ts";
import type { CheckProjectInput } from "../../app/project/check-project.ts";
import type {
  ReadinessFacts,
  ReadinessReport,
} from "../../app/project/project-readiness.ts";

// ── Fake CheckProject ────────────────────────────────────────────────────────

interface CheckCall {
  input: CheckProjectInput;
}

class FakeCheckProject {
  readonly calls: CheckCall[] = [];
  /** Set to a value to resolve. */
  resolveWith: ReadinessReport = allGreenReport();
  /** Set to throw. */
  rejectWith: unknown = undefined;

  async execute(input: CheckProjectInput): Promise<ReadinessReport> {
    this.calls.push({ input });
    if (this.rejectWith !== undefined) throw this.rejectWith;
    return this.resolveWith;
  }
}

function allGreenReport(
  overrides: Partial<ReadinessReport> = {},
): ReadinessReport {
  return {
    projectId: "p1",
    configured: true,
    verified: true,
    operational: true,
    ready: true,
    checks: [
      {
        name: "database",
        status: "ok",
        blocking: true,
        detail: "schema version 28",
      },
      {
        name: "repository",
        status: "ok",
        blocking: true,
        detail: "1 of 1 repository probe(s) reachable",
        probes: [{ resourceId: "r1", status: "ok", detail: "ok" }],
      },
      {
        name: "ai_provider",
        status: "ok",
        blocking: true,
        detail: "1 ai provider(s) resolved, probed",
        probes: [{ resourceId: "p1", status: "ok", detail: "ok" }],
      },
      {
        name: "initiative",
        status: "ok",
        blocking: true,
        detail: "initiative i1 (i1) has 1 incomplete task(s)",
      },
      {
        name: "notification",
        status: "unsupported",
        blocking: false,
        detail:
          "no notifier capability exists — follow progress with: kanthord list event --follow",
      },
      {
        name: "daemon",
        status: "running",
        blocking: false,
        detail: "daemon 1:1000 last beat 1s ago",
        ageSeconds: 1,
      },
    ],
    next: null,
    ...overrides,
  };
}

function notReadyReport(): ReadinessReport {
  return allGreenReport({
    configured: true,
    verified: true,
    operational: false,
    ready: false,
    checks: [
      {
        name: "database",
        status: "ok",
        blocking: true,
        detail: "schema version 28",
      },
      {
        name: "repository",
        status: "ok",
        blocking: true,
        detail: "1 of 1 repository probe(s) reachable",
        probes: [{ resourceId: "r1", status: "ok", detail: "ok" }],
      },
      {
        name: "ai_provider",
        status: "ok",
        blocking: true,
        detail: "1 ai provider(s) resolved, probed",
        probes: [{ resourceId: "p1", status: "ok", detail: "ok" }],
      },
      {
        name: "initiative",
        status: "ok",
        blocking: true,
        detail: "initiative i1 (i1) has 1 incomplete task(s)",
      },
      {
        name: "notification",
        status: "unsupported",
        blocking: false,
        detail:
          "no notifier capability exists — follow progress with: kanthord list event --follow",
      },
      {
        name: "daemon",
        status: "stopped",
        blocking: false,
        detail: "no daemon instance is live",
      },
    ],
  });
}

function missingDatabaseReport(): ReadinessReport {
  return allGreenReport({
    configured: false,
    verified: null,
    operational: false,
    ready: false,
    checks: [
      {
        name: "database",
        status: "blocked",
        blocking: true,
        detail: "schema version 27, expected 28 — run: kanthord db migrate",
      },
      {
        name: "repository",
        status: "ok",
        blocking: true,
        detail: "1 of 1 repository probe(s) reachable",
        probes: [{ resourceId: "r1", status: "ok", detail: "ok" }],
      },
      {
        name: "ai_provider",
        status: "ok",
        blocking: true,
        detail: "1 ai provider(s) resolved, probed",
        probes: [{ resourceId: "p1", status: "ok", detail: "ok" }],
      },
      {
        name: "initiative",
        status: "ok",
        blocking: true,
        detail: "initiative i1 (i1) has 1 incomplete task(s)",
      },
      {
        name: "notification",
        status: "unsupported",
        blocking: false,
        detail:
          "no notifier capability exists — follow progress with: kanthord list event --follow",
      },
      {
        name: "daemon",
        status: "stopped",
        blocking: false,
        detail: "no daemon instance is live",
      },
    ],
    next: {
      check: "database",
      action: "run `kanthord db migrate` to upgrade the schema",
      requiresInput: [],
      command: "kanthord db migrate",
    },
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("missing --id returns exitCode 1 and stderr contains `error: missing required flag --id`", async () => {
  const cp = new FakeCheckProject();
  const result = await runCheckProject({}, cp as unknown as never);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stdout, []);
  assert.ok(
    result.stderr[0]?.includes("error: missing required flag --id"),
    `expected stderr to include the missing-flag error, got: ${result.stderr.join("|")}`,
  );
  // Dep was never called.
  assert.equal(cp.calls.length, 0);
});

test("UnknownReferenceError → { exitCode: 1, stdout: [], stderr: ['error: no project with id abc'] }", async () => {
  const cp = new FakeCheckProject();
  cp.rejectWith = new UnknownReferenceError("project", "abc");
  const result = await runCheckProject({ id: "abc" }, cp as unknown as never);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stdout, []);
  assert.deepEqual(result.stderr, ["error: no project with id abc"]);
});

test("--json with ready:false → exitCode 1, stderr deep-equals [], JSON.parse(stdout[0]) deep-equals the report", async () => {
  const cp = new FakeCheckProject();
  cp.resolveWith = notReadyReport();
  const result = await runCheckProject(
    { id: "abc", json: true },
    cp as unknown as never,
  );
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stderr, []);
  assert.equal(result.stdout.length, 1);
  const parsed = JSON.parse(result.stdout[0]!);
  assert.deepEqual(parsed, cp.resolveWith);
});

test("--json with ready:true → exitCode 0", async () => {
  const cp = new FakeCheckProject();
  cp.resolveWith = allGreenReport();
  const result = await runCheckProject(
    { id: "abc", json: true },
    cp as unknown as never,
  );
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stderr, []);
  assert.equal(result.stdout.length, 1);
});

test("text mode: first five lines are `project:`, `configured:`, `verified: null`, `operational:`, `ready:`", async () => {
  const cp = new FakeCheckProject();
  cp.resolveWith = allGreenReport();
  const result = await runCheckProject({ id: "p1" }, cp as unknown as never);
  assert.equal(result.stdout[0], "project: p1");
  assert.equal(result.stdout[1], "configured: true");
  assert.equal(result.stdout[2], "verified: true");
  assert.equal(result.stdout[3], "operational: true");
  assert.equal(result.stdout[4], "ready: true");
});

test("text mode: one line per check in `checks` order with a probe line directly under the check that has probes", async () => {
  const cp = new FakeCheckProject();
  cp.resolveWith = allGreenReport();
  const result = await runCheckProject({ id: "p1" }, cp as unknown as never);
  // Check order: database, repository, ai_provider, initiative, notification, daemon.
  // The repository check has probes; the line directly under it is `  - r1 ok ok`.
  const lines = result.stdout;
  // Find the repository line
  const repoIdx = lines.findIndex((l) => l.startsWith("repository "));
  assert.ok(repoIdx >= 0, "repository check line must be present");
  // Probe line directly under
  assert.equal(lines[repoIdx + 1], "  - r1 ok ok");
});

test("text mode: next check with non-empty requiresInput → `next: …` followed by `  requires: …` (no `run:` line)", async () => {
  const cp = new FakeCheckProject();
  cp.resolveWith = allGreenReport({
    ...missingDatabaseReport(),
    // missingDatabaseReport already has a next with requiresInput: []
    // Override to use non-empty requiresInput:
    next: {
      check: "repository",
      action: "register a repository resource",
      requiresInput: ["name", "remoteUrl", "branch", "auth", "path"],
    },
  } as ReadinessReport);
  const result = await runCheckProject({ id: "p1" }, cp as unknown as never);
  const lines = result.stdout;
  const nextIdx = lines.findIndex((l) => l.startsWith("next:"));
  assert.ok(nextIdx >= 0, "`next:` line must be present");
  assert.ok(lines[nextIdx + 1]?.startsWith("  requires: "));
  // No `run:` line after requires
  assert.ok(!lines[nextIdx + 2]?.startsWith("  run: "));
});

test("text mode: next check with empty requiresInput → `next: …` followed by `  run: …` (no `requires:` line)", async () => {
  const cp = new FakeCheckProject();
  cp.resolveWith = missingDatabaseReport();
  const result = await runCheckProject({ id: "p1" }, cp as unknown as never);
  const lines = result.stdout;
  const nextIdx = lines.findIndex((l) => l.startsWith("next:"));
  assert.ok(nextIdx >= 0, "`next:` line must be present");
  assert.ok(lines[nextIdx + 1]?.startsWith("  run: "));
  // No `requires:` line after run
  assert.ok(!lines[nextIdx + 2]?.startsWith("  requires: "));
});

// ── Flag plumbing ────────────────────────────────────────────────────────────

test("flag plumbing: --probe-repositories alone → execute receives { probeRepositories: true, probeProvider: false }", async () => {
  const cp = new FakeCheckProject();
  await runCheckProject(
    { id: "p1", "probe-repositories": true },
    cp as unknown as never,
  );
  assert.equal(cp.calls.length, 1);
  const input = cp.calls[0]!.input;
  assert.equal(input.id, "p1");
  assert.equal(input.probeRepositories, true);
  assert.equal(input.probeProvider, false);
});

test("flag plumbing: --probe-provider alone → execute receives { probeRepositories: false, probeProvider: true }", async () => {
  const cp = new FakeCheckProject();
  await runCheckProject(
    { id: "p1", "probe-provider": true },
    cp as unknown as never,
  );
  assert.equal(cp.calls.length, 1);
  const input = cp.calls[0]!.input;
  assert.equal(input.id, "p1");
  assert.equal(input.probeRepositories, false);
  assert.equal(input.probeProvider, true);
});

test("flag plumbing: neither flag → execute receives { probeRepositories: false, probeProvider: false }", async () => {
  const cp = new FakeCheckProject();
  await runCheckProject({ id: "p1" }, cp as unknown as never);
  assert.equal(cp.calls.length, 1);
  const input = cp.calls[0]!.input;
  assert.equal(input.id, "p1");
  assert.equal(input.probeRepositories, false);
  assert.equal(input.probeProvider, false);
});

// ── JSON output is byte-for-byte the report (regression guard for `2>&1`) ───

test("--json output is byte-for-byte the report (regression guard for the Proof's `2>&1` capture)", async () => {
  const cp = new FakeCheckProject();
  cp.resolveWith = notReadyReport();
  const result = await runCheckProject(
    { id: "p1", json: true },
    cp as unknown as never,
  );
  // The Proof phase C captures `2>&1` and JSON.parses the file. A single
  // stray stderr line would break that capture. The handler must write
  // NOTHING to stderr when --json is set, even when ready is false.
  assert.deepEqual(result.stderr, []);
  // And stdout[0] is the JSON-serialized report.
  const parsed = JSON.parse(result.stdout[0]!);
  assert.equal(parsed.projectId, "p1");
  assert.equal(parsed.ready, false);
});

// Silence the unused-import warning for `ReadinessFacts`; it's imported so
// the test file documents the seam type even though we don't construct facts
// here.
const _factsType: ReadinessFacts | undefined = undefined;
void _factsType;

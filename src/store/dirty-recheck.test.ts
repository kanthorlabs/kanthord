/**
 * src/store/dirty-recheck.test.ts
 *
 * Story 012-003 Task T1 — Recheck detects content edit and rename; exclusions hold
 * Story 012-003 Task T2 — Dirty from out-of-band edit halts new dispatch
 *
 * Tests that:
 *   (a) a direct file edit to a covered task file ⇒ recheck reports dirty
 *   (b) a direct rename of a task file ⇒ dirty
 *   (c) a direct delete of a covered file ⇒ dirty
 *   (d) direct addition of a grammar-matching file in a story dir ⇒ dirty
 *   (e) editing RUNBOOK.md, *.state.md, or *.journal.jsonl ⇒ NOT dirty
 *   (f) no change to the covered set ⇒ NOT dirty (clean baseline)
 *   (g) out-of-band edit + exact revert ⇒ NOT dirty (current-state semantics)
 *   (T2-h) after out-of-band edit, pollOnce with dirty hash dispatches nothing
 *   (T2-i) task already running under generation G is untouched when plan goes dirty
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  rename,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { compile, computeCompileHash } from "../compiler/compile.ts";
import { FakeClock } from "../foundations/clock.ts";
import { loadTasks } from "../scheduler/dispatch.ts";
import { initSchema } from "./schema.ts";
import { LeaseManager } from "../scheduler/leases.ts";
import { pollOnce } from "../scheduler/poll.ts";
import { recheckDirty, pollWithRecheck } from "./dirty-recheck.ts";

// ---------------------------------------------------------------------------
// Minimal feature dir fixtures
// ---------------------------------------------------------------------------

const EPIC_MD = `---
id: feat-recheck
repo: backend
ticket_system: jira
ticket: JIRA-200
deploy_chain:
  - stage: staging
    handlers:
      - run: ./deploy.sh staging
    success_criteria: smoke tests pass
    soak_duration: 1h
---

## Acceptance

Feature is complete when all tasks pass.
`;

const TASK_MD = `---
id: task-recheck-alpha
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-201
---

## Prerequisites

echo "setup"

## Inputs

Nothing required.

## Outputs

alpha-output

## Tests

echo "test"
`;

const TASK_BETA_MD = `---
id: task-recheck-beta
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-210
---

## Prerequisites

echo "setup beta"

## Inputs

Nothing required.

## Outputs

beta-output

## Tests

echo "beta"
`;

const COMPILE_OPTS = { repoRegistry: ["backend"] };

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("src/store/dirty-recheck — Story 012-003 Task T1", () => {
  let featureDir: string;
  let store: Store;
  let storyDir: string;
  let taskPath: string;

  beforeEach(async () => {
    featureDir = await mkdtemp(join(tmpdir(), "kanthord-dirty-rc-"));
    storyDir = join(featureDir, "001-story-alpha");
    taskPath = join(storyDir, "001-task-recheck-alpha.md");

    await writeFile(join(featureDir, "epic.md"), EPIC_MD);
    await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n");
    await mkdir(storyDir);
    await writeFile(join(storyDir, "INDEX.md"), "# Story Alpha\n");
    await writeFile(taskPath, TASK_MD);

    const dbPath = join(featureDir, "test.db");
    store = openStore(dbPath, { busyTimeout: 1000 });
    await compile(featureDir, store, COMPILE_OPTS);
  });

  afterEach(async () => {
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  });

  test("(f) unchanged covered set — recheck reports clean", async () => {
    const dirty = await recheckDirty(featureDir, store, "feat-recheck");
    assert.equal(dirty, false);
  });

  test("(a) direct edit to a covered task file — recheck reports dirty", async () => {
    await writeFile(taskPath, TASK_MD + "\n<!-- out-of-band edit -->\n");
    const dirty = await recheckDirty(featureDir, store, "feat-recheck");
    assert.equal(dirty, true);
  });

  test("(b) direct rename of a task file — recheck reports dirty", async () => {
    await rename(taskPath, join(storyDir, "001-task-renamed.md"));
    const dirty = await recheckDirty(featureDir, store, "feat-recheck");
    assert.equal(dirty, true);
  });

  test("(c) direct delete of a covered file — recheck reports dirty", async () => {
    await unlink(taskPath);
    const dirty = await recheckDirty(featureDir, store, "feat-recheck");
    assert.equal(dirty, true);
  });

  test("(d) direct add of a grammar-matching file in a story dir — recheck reports dirty", async () => {
    await writeFile(
      join(storyDir, "002-task-new.md"),
      "---\nid: task-new\nworkflow: tdd@1\nrepo: backend\nticket_system: jira\nticket: JIRA-202\n---\n\n## Tests\n\necho ok\n",
    );
    const dirty = await recheckDirty(featureDir, store, "feat-recheck");
    assert.equal(dirty, true);
  });

  test("(e) editing RUNBOOK.md out-of-band — NOT dirty", async () => {
    await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n\n<!-- edited -->\n");
    const dirty = await recheckDirty(featureDir, store, "feat-recheck");
    assert.equal(dirty, false);
  });

  test("(e) editing a *.state.md file out-of-band — NOT dirty", async () => {
    await writeFile(join(storyDir, "task-recheck-alpha.state.md"), "state: running\n");
    const dirty = await recheckDirty(featureDir, store, "feat-recheck");
    assert.equal(dirty, false);
  });

  test("(e) editing a *.journal.jsonl file out-of-band — NOT dirty", async () => {
    await writeFile(
      join(storyDir, "task-recheck-alpha.journal.jsonl"),
      '{"event":"start","at":"2026-07-05T00:00:00Z"}\n',
    );
    const dirty = await recheckDirty(featureDir, store, "feat-recheck");
    assert.equal(dirty, false);
  });

  test("(g) out-of-band edit then exact revert — NOT dirty (current-state semantics)", async () => {
    const original = TASK_MD;
    await writeFile(taskPath, original + "\n<!-- temp -->\n");
    // revert to original
    await writeFile(taskPath, original);
    const dirty = await recheckDirty(featureDir, store, "feat-recheck");
    assert.equal(dirty, false);
  });
});

// ---------------------------------------------------------------------------
// Suite T2 — dirty plan halts new dispatch; running task is untouched
// ---------------------------------------------------------------------------

describe("src/store/dirty-recheck — Story 012-003 Task T2", () => {
  let featureDir: string;
  let store: Store;
  let storyDir: string;
  let taskPath: string;
  let taskBetaPath: string;
  let clock: FakeClock;
  let lm: LeaseManager;

  beforeEach(async () => {
    featureDir = await mkdtemp(join(tmpdir(), "kanthord-dirty-t2-"));
    storyDir = join(featureDir, "001-story-alpha");
    taskPath = join(storyDir, "001-task-recheck-alpha.md");
    taskBetaPath = join(storyDir, "002-task-recheck-beta.md");

    await writeFile(join(featureDir, "epic.md"), EPIC_MD);
    await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n");
    await mkdir(storyDir);
    await writeFile(join(storyDir, "INDEX.md"), "# Story Alpha\n");
    await writeFile(taskPath, TASK_MD);
    // A second independent task so something is pending after alpha is running.
    await writeFile(taskBetaPath, TASK_BETA_MD);

    const dbPath = join(featureDir, "test.db");
    store = openStore(dbPath, { busyTimeout: 1000 });
    await compile(featureDir, store, COMPILE_OPTS);
    initSchema(store);
    loadTasks(store, "feat-recheck");

    clock = new FakeClock(0);
    lm = new LeaseManager(store, clock);
  });

  afterEach(async () => {
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  });

  test("(T2-h) after out-of-band edit, pollOnce with dirty hash dispatches nothing", async () => {
    // Make an out-of-band edit so the live hash diverges from the stamped hash.
    await writeFile(taskPath, TASK_MD + "\n<!-- out-of-band -->\n");
    const dirtyHash = await computeCompileHash(featureDir);

    // recheckDirty confirms the plan is dirty.
    const isDirty = await recheckDirty(featureDir, store, "feat-recheck");
    assert.equal(isDirty, true, "plan must be dirty after out-of-band edit");

    // pollOnce must dispatch nothing when the live hash is dirty.
    const dispatched = pollOnce(store, "feat-recheck", dirtyHash, lm, new Map());
    assert.equal(dispatched.length, 0, "no tasks dispatched when plan is dirty after out-of-band edit");
  });

  test("(T2-i) task already running under generation G is untouched when plan goes dirty", async () => {
    // First, get the clean hash and dispatch task-alpha (it becomes running).
    const genRow = store.get<{ compile_hash: string }>(
      "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-recheck' ORDER BY generation DESC LIMIT 1",
    );
    const cleanHash = genRow?.compile_hash ?? "";
    assert.ok(cleanHash.length > 0, "cleanHash must be set");

    const r1 = pollOnce(store, "feat-recheck", cleanHash, lm, new Map());
    assert.ok(r1.length > 0, "at least one task must dispatch in the clean pass");

    // Now make an out-of-band edit — plan goes dirty.
    await writeFile(taskPath, TASK_MD + "\n<!-- oob -->\n");
    const dirtyHash = await computeCompileHash(featureDir);

    // The running task's status in scheduler_task must still be 'running'.
    const runningBefore = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = 'task-recheck-alpha'",
    );
    assert.equal(runningBefore?.status, "running", "task-recheck-alpha must be running before dirty poll");

    // pollOnce with dirty hash dispatches nothing new.
    const r2 = pollOnce(store, "feat-recheck", dirtyHash, lm, new Map());
    assert.equal(r2.length, 0, "no new dispatch when plan is dirty");

    // The already-running task must remain running (not disturbed).
    const runningAfter = store.get<{ status: string }>(
      "SELECT status FROM scheduler_task WHERE node_id = 'task-recheck-alpha'",
    );
    assert.equal(runningAfter?.status, "running", "already-running task must remain running after dirty poll");
  });
});

// ---------------------------------------------------------------------------
// Suite B6 — pollWithRecheck is the wired poll-boundary recheck call site
// ---------------------------------------------------------------------------

describe("src/store/dirty-recheck — B6 pollWithRecheck call site", () => {
  let featureDir: string;
  let store: Store;
  let storyDir: string;
  let taskPath: string;
  let clock: FakeClock;
  let lm: LeaseManager;

  beforeEach(async () => {
    featureDir = await mkdtemp(join(tmpdir(), "kanthord-dirty-b6-"));
    storyDir = join(featureDir, "001-story-alpha");
    taskPath = join(storyDir, "001-task-recheck-alpha.md");

    await writeFile(join(featureDir, "epic.md"), EPIC_MD);
    await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n");
    await mkdir(storyDir);
    await writeFile(join(storyDir, "INDEX.md"), "# Story Alpha\n");
    await writeFile(taskPath, TASK_MD);

    const dbPath = join(featureDir, "test.db");
    store = openStore(dbPath, { busyTimeout: 1000 });
    await compile(featureDir, store, COMPILE_OPTS);
    initSchema(store);
    loadTasks(store, "feat-recheck");

    clock = new FakeClock(0);
    lm = new LeaseManager(store, clock);
  });

  afterEach(async () => {
    store.close();
    await rm(featureDir, { recursive: true, force: true });
  });

  test("(B6-a) clean plan: pollWithRecheck dispatches tasks without manual hash computation", async () => {
    // No out-of-band edit — the stored hash and live hash match.
    // pollWithRecheck must dispatch at least one task without the caller
    // computing or passing a hash.
    const dispatched = await pollWithRecheck(featureDir, store, "feat-recheck", lm, new Map());
    assert.ok(dispatched.length > 0, "at least one task dispatched when plan is clean");
  });

  test("(B6-b) out-of-band edit: pollWithRecheck dispatches nothing without caller computing hash", async () => {
    // Make an out-of-band edit to diverge the live hash.
    await writeFile(taskPath, TASK_MD + "\n<!-- oob-b6 -->\n");

    // The caller does NOT compute or pass a hash — pollWithRecheck does it internally.
    const dispatched = await pollWithRecheck(featureDir, store, "feat-recheck", lm, new Map());
    assert.equal(dispatched.length, 0, "no tasks dispatched when plan is dirty (poll-boundary recheck)");
  });

  test("(B6-c) pollWithRecheck returns DispatchedTask[] shape", async () => {
    // After dispatch, the returned items have at least a taskId string field.
    const dispatched = await pollWithRecheck(featureDir, store, "feat-recheck", lm, new Map());
    for (const item of dispatched) {
      assert.equal(typeof item.taskId, "string", "each dispatched item must have a taskId string");
    }
  });
});

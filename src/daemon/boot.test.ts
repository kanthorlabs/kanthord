/**
 * Tests for src/daemon/boot
 * Story 001 — Daemon Wiring & Crash/Restart Entrypoint
 * Task T1 — Boot wires components + rebuilds from markdown/ledger
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import { FakeClock } from "../foundations/clock.ts";
import { bootDaemon } from "./boot.ts";
import type { Logger } from "./boot.ts";
import { FeatureStore } from "../store/feature-store.ts";
import { writeLedgerEntry } from "../broker/ledger.ts";
import { LeaseManager } from "../scheduler/leases.ts";
import { initSchema } from "../store/schema.ts";

// ---------------------------------------------------------------------------
// Mock logger — captures structured records for assertion
// ---------------------------------------------------------------------------

class MockLogger implements Logger {
  readonly records: Record<string, unknown>[] = [];
  info(record: Record<string, unknown>): void {
    this.records.push({ ...record });
  }
}

// ---------------------------------------------------------------------------
// Golden feature fixture — single-story / single-task; no deploy stages.
// Must satisfy:
//   - shape-lint: epic ## Acceptance; task ## Prerequisites/Inputs/Outputs/Tests; workflow: tdd@1
//   - coreLint: non-empty ticket + repo in repoRegistry (["backend"])
// ---------------------------------------------------------------------------

const EPIC_MD = `---
id: feat-boot-001
repo: backend
---

## Acceptance

Feature for daemon boot test.
`;

const TASK_ALPHA_MD = `---
id: task-boot-alpha
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-BOOT-001
---

## Prerequisites

echo "setup"

## Inputs

Nothing.

## Outputs

- output-a

## Tests

Tests here.
`;

describe("src/daemon/boot", () => {
  let featureDir: string;

  before(async () => {
    featureDir = await mkdtemp(join(tmpdir(), "kboot-t1-"));
    await writeFile(join(featureDir, "epic.md"), EPIC_MD, "utf8");
    const storyDir = join(featureDir, "001-story-a");
    await mkdir(storyDir, { recursive: true });
    await writeFile(join(storyDir, "INDEX.md"), "# Story A\n", "utf8");
    await writeFile(join(storyDir, "task-boot-alpha.md"), TASK_ALPHA_MD, "utf8");
  });

  after(async () => {
    await rm(featureDir, { recursive: true, force: true });
  });

  describe("T1 — Boot wires components + rebuilds from markdown/ledger", () => {
    test("bootDaemon returns lifecycle with start, stop, restart", () => {
      const store = openStore(":memory:", { busyTimeout: 1000 });
      initSchema(store);
      const clock = new FakeClock(1_000_000);
      const logger = new MockLogger();
      const lifecycle = bootDaemon({
        featureDir,
        clock,
        store,
        logger,
        compileOpts: { repoRegistry: ["backend"] },
      });
      assert.equal(typeof lifecycle.start, "function", "lifecycle.start must be a function");
      assert.equal(typeof lifecycle.stop, "function", "lifecycle.stop must be a function");
      assert.equal(typeof lifecycle.restart, "function", "lifecycle.restart must be a function");
      store.close();
    });

    test("start() with empty SQLite logs boot record and recovery-summary with pendingTaskCount >= 1 (markdown rebuild proven)", async () => {
      const store = openStore(":memory:", { busyTimeout: 1000 });
      initSchema(store);
      const clock = new FakeClock(1_000_000);
      const logger = new MockLogger();
      const lifecycle = bootDaemon({
        featureDir,
        clock,
        store,
        logger,
        compileOpts: { repoRegistry: ["backend"] },
      });
      await lifecycle.start();

      const bootRecord = logger.records.find((r) => r["event"] === "boot");
      assert.ok(bootRecord !== undefined, "logger must receive a structured boot record");

      const summaryRecord = logger.records.find((r) => r["event"] === "recovery-summary");
      assert.ok(
        summaryRecord !== undefined,
        "logger must receive a structured recovery-summary record",
      );

      const count = summaryRecord["pendingTaskCount"];
      assert.ok(
        typeof count === "number" && count >= 1,
        "pendingTaskCount must be >= 1 (SQLite started empty; tasks found only via markdown rebuild)",
      );
      store.close();
    });
  });

  describe("T2 — Kill + restart reproduces state field-by-field", () => {
    let t2Dir: string;

    before(async () => {
      t2Dir = await mkdtemp(join(tmpdir(), "kboot-t2-"));
      await writeFile(join(t2Dir, "epic.md"), EPIC_MD, "utf8");
      const storyDir = join(t2Dir, "001-story-a");
      await mkdir(storyDir, { recursive: true });
      await writeFile(join(storyDir, "INDEX.md"), "# Story A\n", "utf8");
      await writeFile(join(storyDir, "task-boot-alpha.md"), TASK_ALPHA_MD, "utf8");
    });

    after(async () => {
      await rm(t2Dir, { recursive: true, force: true });
    });

    test("restart() reproduces pending-task count and reconciledOps from durable markdown/ledger", async () => {
      const featureStore = new FeatureStore(t2Dir);
      await writeLedgerEntry(featureStore, "001-story-a", "task-boot-alpha", {
        op_id: "op-t2-1",
        verb: "call-llm",
        idempotency_key: "ikey-t2-1",
        correlation: "corr-t2-1",
        desired_effect_hash: "hash-t2-1",
        status: "in_flight",
      });
      const store = openStore(":memory:", { busyTimeout: 1000 });
      initSchema(store);
      const clock = new FakeClock(1_000_000);
      const logger = new MockLogger();
      const lifecycle = bootDaemon({
        featureDir: t2Dir,
        clock,
        store,
        logger,
        compileOpts: { repoRegistry: ["backend"] },
      });

      await lifecycle.start();

      const preSummary = logger.records.find((r) => r["event"] === "recovery-summary");
      assert.ok(preSummary !== undefined, "start() must emit a recovery-summary");
      const prePendingCount = preSummary["pendingTaskCount"];
      const preReconciledOps = preSummary["reconciledOps"];

      // Simulated kill: discard in-memory logger state (markdown + ledger kept on disk)
      logger.records.length = 0;
      await lifecycle.restart();

      const postSummary = logger.records.find((r) => r["event"] === "recovery-summary");
      assert.ok(postSummary !== undefined, "restart() must emit a recovery-summary");
      assert.equal(
        postSummary["pendingTaskCount"],
        prePendingCount,
        "pending-task count must equal pre-kill value after restart",
      );
      assert.equal(
        postSummary["reconciledOps"],
        preReconciledOps,
        "reconciledOps must equal pre-kill value after restart",
      );
      assert.ok(
        typeof postSummary["reconciledOps"] === "number" && postSummary["reconciledOps"] >= 1,
        "reconciledOps must be >= 1 (in-flight ledger op was durably recovered)",
      );
      store.close();
    });

    test("restart() - stale crashed-holder lease is reclaimable per Epic 004 TTL semantics", async () => {
      const store = openStore(":memory:", { busyTimeout: 1000 });
      initSchema(store);
      const clock = new FakeClock(1_000_000);
      const logger = new MockLogger();
      const lifecycle = bootDaemon({
        featureDir: t2Dir,
        clock,
        store,
        logger,
        compileOpts: { repoRegistry: ["backend"] },
      });

      // Pre-crash: task acquires a capability lease
      const lm = new LeaseManager(store, clock);
      const caps: Array<{ kind: "resource"; key: string }> = [
        { kind: "resource", key: "shared-resource" },
      ];
      const acquired = lm.acquire("task-boot-alpha", caps);
      assert.ok(acquired, "pre-crash: capability lease must be acquirable");

      // Simulated kill: advance clock past TTL (30 000 ms) so the lease expires
      clock.advance(30_001);
      await lifecycle.restart();

      // Post-restart: stale expired lease is reclaimable by any task (Epic 004 §7.3 reclaim)
      const reacquired = lm.acquire("task-boot-alpha-restarted", caps);
      assert.ok(
        reacquired,
        "post-restart: stale crashed-holder lease must be reclaimable per Epic 004 TTL semantics",
      );
      store.close();
    });

    test("restart() logs currentPhase from STATE for resuming tasks (Epic 006 respawn path)", async () => {
      const featureStore = new FeatureStore(t2Dir);
      await writeLedgerEntry(featureStore, "001-story-a", "task-boot-alpha", {
        op_id: "op-phase-1",
        verb: "call-llm-phase",
        idempotency_key: "ikey-phase-1",
        correlation: "corr-phase-1",
        desired_effect_hash: "hash-phase-1",
        status: "in_flight",
      });
      await featureStore.writeState(
        "001-story-a",
        "task-boot-alpha",
        "# STATE\n\ncurrent_phase: testing\n",
      );

      const store = openStore(":memory:", { busyTimeout: 1000 });
      initSchema(store);
      const clock = new FakeClock(1_000_000);
      const logger = new MockLogger();
      const lifecycle = bootDaemon({
        featureDir: t2Dir,
        clock,
        store,
        logger,
        compileOpts: { repoRegistry: ["backend"] },
      });

      // Simulated kill + restart from durable markdown, ledger, and STATE
      await lifecycle.restart();

      const summaryRecord = logger.records.find((r) => r["event"] === "recovery-summary");
      assert.ok(summaryRecord !== undefined, "restart() must emit a recovery-summary record");

      // recovery-summary must include currentPhase for resuming tasks (reconciledOps > 0)
      const phase = summaryRecord["currentPhase"];
      assert.ok(
        typeof phase === "string" && phase.length > 0,
        "recovery-summary must include currentPhase for resuming tasks (from STATE via Epic 006 respawn path)",
      );
      assert.equal(
        phase,
        "testing",
        "currentPhase must match the value written in the task STATE file before the crash",
      );
      store.close();
    });
  });
});

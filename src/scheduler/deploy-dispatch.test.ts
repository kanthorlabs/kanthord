import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { FakeClock } from "../foundations/clock.ts";
import type { Clock } from "../foundations/clock.ts";
import { compile } from "../compiler/compile.ts";
import {
  loadTasks,
  markExitGatePassed,
  setTaskStatus,
  dispatchable,
} from "./dispatch.ts";
import type { TaskRow } from "./dispatch.ts";
import { initSchema } from "../store/schema.ts";
import { LeaseManager } from "./leases.ts";
import { pollOnce } from "./poll.ts";
import type { HandlerMap } from "../deploy/chain.ts";

// ---------------------------------------------------------------------------
// Fixture — one task + two deploy stages (no soak) for deploy-dispatch tests
// ---------------------------------------------------------------------------

const EPIC_MD_DEPLOY = `---
id: feat-001
repo: backend
deploy_chain:
  - stage: staging
    handlers:
      - observer: smoke-check
    success_criteria: "smoke-check:healthy"
    soak_duration: "0s"
  - stage: production
    handlers:
      - observer: prod-check
    success_criteria: "prod-check:healthy"
    soak_duration: "0s"
---

## Acceptance

Deploy chain completes when all stages pass.
`;

const TASK_ALPHA_MD = `---
id: task-alpha
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-101
---

## Prerequisites

Setup.

## Inputs

Nothing.

## Outputs

Nothing.

## Tests

Unit tests for alpha.
`;

const COMPILE_OPTS = { repoRegistry: ["backend"] };

// Fixture for T2b: staging has 2m soak (120_000ms / 60_000ms poll = 2 polls needed)
const EPIC_MD_DEPLOY_SOAK = `---
id: feat-001
repo: backend
deploy_chain:
  - stage: staging
    handlers:
      - observer: smoke-check
    success_criteria: "smoke-check:healthy"
    soak_duration: "2m"
  - stage: production
    handlers:
      - observer: prod-check
    success_criteria: "prod-check:healthy"
    soak_duration: "0s"
---

## Acceptance

Deploy chain completes when all stages pass.
`;

// ---------------------------------------------------------------------------
// Suite: src/scheduler/deploy-dispatch
// ---------------------------------------------------------------------------

describe("src/scheduler/deploy-dispatch", () => {
  // ---------------------------------------------------------------------------
  // 008.1 Story 002-T1 — pollOnce-driven per-stage execution
  // ---------------------------------------------------------------------------

  describe("008.1 Story 002-T1 — pollOnce-driven per-stage execution; pass marks gate + unblocks next + completes chain", () => {
    let featDir = "";
    let testDir = "";
    let store: Store;
    let clock: FakeClock;
    let lm: LeaseManager;
    let liveHash = "";

    before(async () => {
      featDir = await mkdtemp(join(tmpdir(), "kanthord-dd-t1-feat-"));
      await writeFile(join(featDir, "epic.md"), EPIC_MD_DEPLOY);
      await writeFile(join(featDir, "RUNBOOK.md"), "# Runbook\n");
      const sA = join(featDir, "001-story-a");
      await mkdir(sA);
      await writeFile(join(sA, "INDEX.md"), "# Story A\n");
      await writeFile(join(sA, "001-task-alpha.md"), TASK_ALPHA_MD);
    });

    after(async () => {
      if (featDir) await rm(featDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
      testDir = await mkdtemp(join(tmpdir(), "kanthord-dd-t1-db-"));
      const dbPath = join(testDir, "test.db");
      store = openStore(dbPath, { busyTimeout: 1000 });
      clock = new FakeClock(0);
      lm = new LeaseManager(store, clock);
      await compile(featDir, store, COMPILE_OPTS);
      initSchema(store);
      loadTasks(store, "feat-001");
      const genRow = store.get<{ compile_hash: string }>(
        "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001' ORDER BY generation DESC LIMIT 1",
      );
      liveHash = genRow?.compile_hash ?? "";
      assert.ok(liveHash.length > 0, "liveHash must be set from compiled plan_generation");
      // Pre-pass the task gate so deploy stages are at the frontier
      setTaskStatus(store, "task-alpha", "done");
      markExitGatePassed(store, "task-alpha");
    });

    afterEach(async () => {
      store.close();
      if (testDir) await rm(testDir, { recursive: true, force: true });
      testDir = "";
    });

    test("pollOnce invokes deploy executor via lifecycle; pass marks exit gate; notify_human emitted; no merge/deploy/rollback; next stage unblocks; chain completes after last stage", async () => {
      const callLog: string[] = [];
      type EventRecord = { event: string; stageId: string };
      const eventLog: EventRecord[] = [];

      const handlers: HandlerMap = new Map([
        [
          "smoke-check",
          async (
            _stageId: string,
            _clock: Clock,
          ): Promise<{ healthy: boolean; value: unknown }> => {
            callLog.push("smoke-check");
            return { healthy: true, value: "ok" };
          },
        ],
        [
          "prod-check",
          async (
            _stageId: string,
            _clock: Clock,
          ): Promise<{ healthy: boolean; value: unknown }> => {
            callLog.push("prod-check");
            return { healthy: true, value: "ok" };
          },
        ],
      ]);

      const onEvent = (event: string, ctx: Record<string, unknown>): void => {
        eventLog.push({ event, stageId: String(ctx["stageId"] ?? "") });
      };

      // Wave 1: pollOnce dispatches and executes deploy-staging via the real lifecycle
      await pollOnce(store, "feat-001", liveHash, lm, new Map(), {
        handlers,
        clock,
        onEvent,
      });

      // 1. Executor invoked via pollOnce lifecycle — not a bare runChain/runStage call
      assert.ok(
        callLog.includes("smoke-check"),
        "smoke-check handler must be called via pollOnce lifecycle for deploy-staging",
      );

      // 2. Exit gate marked on pass (scheduler persisted state is the observable)
      const gateRow = store.get<{ exit_gate_passed: number }>(
        "SELECT exit_gate_passed FROM scheduler_task WHERE node_id = ?",
        "feat-001-deploy-staging",
      );
      assert.equal(
        gateRow?.exit_gate_passed,
        1,
        "exit gate of deploy-staging must be marked passed after successful stage",
      );

      // 3. notify_human event emitted with stage context (PRD §7.4; asserted against recorded log)
      assert.ok(
        eventLog.some(
          (e) => e.event === "notify_human" && e.stageId === "feat-001-deploy-staging",
        ),
        "notify_human event must be emitted with staging stageId on pass",
      );

      // 4. No merge/deploy/rollback verbs in recorded log (PRD §7.4, §9 — human-only verbs)
      for (const verb of ["merge", "deploy", "rollback"] as const) {
        assert.ok(
          !eventLog.some((e) => e.event === verb),
          `must not emit '${verb}' verb — human-only, never called by scheduler`,
        );
      }

      // 5. Next stage unblocked: deploy-production is now dispatchable
      const dispAfter = dispatchable(store, "feat-001").map((r: TaskRow) => r.id);
      assert.ok(
        dispAfter.includes("feat-001-deploy-production"),
        "deploy-production must be dispatchable after deploy-staging gate passes",
      );

      // Wave 2: dispatches and executes deploy-production via pollOnce lifecycle
      await pollOnce(store, "feat-001", liveHash, lm, new Map(), {
        handlers,
        clock,
        onEvent,
      });

      assert.ok(
        callLog.includes("prod-check"),
        "prod-check handler must be called for deploy-production via pollOnce lifecycle",
      );

      // 6. Chain completes: after last stage no further deploy node dispatches
      const finalResult = await pollOnce(store, "feat-001", liveHash, lm, new Map(), {
        handlers,
        clock,
        onEvent,
      });
      assert.equal(
        finalResult.length,
        0,
        "no deploy nodes dispatched after last stage gate passes — chain complete",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 008.1 Story 002-T2 — failing stage halts; gate unpassed; downstream never runs
  // ---------------------------------------------------------------------------

  describe("008.1 Story 002-T2 — failing stage halts; gate unpassed; downstream never dispatched", () => {
    const flushMicrotasks = (): Promise<void> =>
      new Promise<void>((resolve) => setImmediate(resolve));

    // (a) handler fail — uses EPIC_MD_DEPLOY (0s soak)
    describe("(a) handler fail via pollOnce dispatch pass", () => {
      let featDir = "";
      let testDir = "";
      let store: Store;
      let clock: FakeClock;
      let lm: LeaseManager;
      let liveHash = "";

      before(async () => {
        featDir = await mkdtemp(join(tmpdir(), "kanthord-dd-t2a-feat-"));
        await writeFile(join(featDir, "epic.md"), EPIC_MD_DEPLOY);
        await writeFile(join(featDir, "RUNBOOK.md"), "# Runbook\n");
        const sA = join(featDir, "001-story-a");
        await mkdir(sA);
        await writeFile(join(sA, "INDEX.md"), "# Story A\n");
        await writeFile(join(sA, "001-task-alpha.md"), TASK_ALPHA_MD);
      });

      after(async () => {
        if (featDir) await rm(featDir, { recursive: true, force: true });
      });

      beforeEach(async () => {
        testDir = await mkdtemp(join(tmpdir(), "kanthord-dd-t2a-db-"));
        store = openStore(join(testDir, "test.db"), { busyTimeout: 1000 });
        clock = new FakeClock(0);
        lm = new LeaseManager(store, clock);
        await compile(featDir, store, COMPILE_OPTS);
        initSchema(store);
        loadTasks(store, "feat-001");
        const genRow = store.get<{ compile_hash: string }>(
          "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001' ORDER BY generation DESC LIMIT 1",
        );
        liveHash = genRow?.compile_hash ?? "";
        setTaskStatus(store, "task-alpha", "done");
        markExitGatePassed(store, "task-alpha");
      });

      afterEach(async () => {
        store.close();
        if (testDir) await rm(testDir, { recursive: true, force: true });
        testDir = "";
      });

      test("handler unhealthy: pollOnce halt_and_escalate with evidence; gate not passed; downstream not dispatchable", async () => {
        type EventRecord = { event: string; stageId: string; evidence?: unknown };
        const eventLog: EventRecord[] = [];

        const handlers: HandlerMap = new Map([
          [
            "smoke-check",
            async (_stageId: string, _clock: Clock): Promise<{ healthy: boolean; value: unknown }> =>
              ({ healthy: false, value: "handler-fail" }),
          ],
          [
            "prod-check",
            async (_stageId: string, _clock: Clock): Promise<{ healthy: boolean; value: unknown }> =>
              ({ healthy: true, value: "ok" }),
          ],
        ]);

        const onEvent = (event: string, ctx: Record<string, unknown>): void => {
          eventLog.push({ event, stageId: String(ctx["stageId"] ?? ""), evidence: ctx["evidence"] });
        };

        const dispatched = await pollOnce(store, "feat-001", liveHash, lm, new Map(), {
          handlers,
          clock,
          onEvent,
        });

        // Node dispatched via lifecycle then halted
        assert.equal(dispatched.length, 1, "staging node dispatched via pollOnce lifecycle before halt");
        assert.equal(dispatched[0]?.taskId, "feat-001-deploy-staging");

        // halt_and_escalate emitted with full evidence
        const haltEvent = eventLog.find((e) => e.event === "halt_and_escalate");
        assert.ok(haltEvent !== undefined, "halt_and_escalate must be emitted on handler fail");
        assert.equal(haltEvent?.stageId, "feat-001-deploy-staging");
        const ev = haltEvent?.evidence as {
          observer: string; value: unknown; clockInstant: number; stageId: string;
        } | undefined;
        assert.ok(ev !== undefined, "evidence must be present");
        assert.equal(ev?.observer, "smoke-check", "evidence names the failing observer");
        assert.equal(ev?.value, "handler-fail", "evidence carries the observed value");
        assert.equal(ev?.clockInstant, 0, "evidence carries the fake-clock instant");
        assert.equal(ev?.stageId, "feat-001-deploy-staging", "evidence carries the stage id");

        // Gate NOT marked
        const gateRow = store.get<{ exit_gate_passed: number }>(
          "SELECT exit_gate_passed FROM scheduler_task WHERE node_id = ?",
          "feat-001-deploy-staging",
        );
        assert.equal(gateRow?.exit_gate_passed, 0, "staging gate must NOT be passed after handler-fail");

        // Downstream NOT dispatchable
        const dispAfter = dispatchable(store, "feat-001").map((r: TaskRow) => r.id);
        assert.ok(
          !dispAfter.includes("feat-001-deploy-production"),
          "deploy-production must NOT be dispatchable after handler-fail (gate not passed)",
        );

        // No further dispatches
        const nextWave = await pollOnce(store, "feat-001", liveHash, lm, new Map(), {
          handlers, clock, onEvent,
        });
        assert.equal(nextWave.length, 0, "no further deploy nodes dispatched after handler-fail halt");
      });
    });

    // (b) soak flip — uses EPIC_MD_DEPLOY_SOAK (2m soak on staging)
    describe("(b) soak flip via pollOnce dispatch pass", () => {
      let featDir = "";
      let testDir = "";
      let store: Store;
      let clock: FakeClock;
      let lm: LeaseManager;
      let liveHash = "";

      before(async () => {
        featDir = await mkdtemp(join(tmpdir(), "kanthord-dd-t2b-feat-"));
        await writeFile(join(featDir, "epic.md"), EPIC_MD_DEPLOY_SOAK);
        await writeFile(join(featDir, "RUNBOOK.md"), "# Runbook\n");
        const sB = join(featDir, "001-story-a");
        await mkdir(sB);
        await writeFile(join(sB, "INDEX.md"), "# Story A\n");
        await writeFile(join(sB, "001-task-alpha.md"), TASK_ALPHA_MD);
      });

      after(async () => {
        if (featDir) await rm(featDir, { recursive: true, force: true });
      });

      beforeEach(async () => {
        testDir = await mkdtemp(join(tmpdir(), "kanthord-dd-t2b-db-"));
        store = openStore(join(testDir, "test.db"), { busyTimeout: 1000 });
        clock = new FakeClock(0);
        lm = new LeaseManager(store, clock);
        await compile(featDir, store, COMPILE_OPTS);
        initSchema(store);
        loadTasks(store, "feat-001");
        const genRow = store.get<{ compile_hash: string }>(
          "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001' ORDER BY generation DESC LIMIT 1",
        );
        liveHash = genRow?.compile_hash ?? "";
        setTaskStatus(store, "task-alpha", "done");
        markExitGatePassed(store, "task-alpha");
      });

      afterEach(async () => {
        store.close();
        if (testDir) await rm(testDir, { recursive: true, force: true });
        testDir = "";
      });

      test("soak-flip: healthy at gate + poll-1; flips at poll-2 → halt_and_escalate with soakWindowHistory; gate not passed; downstream not dispatchable", async () => {
        let callCount = 0;
        type EventRecord = { event: string; stageId: string; evidence?: unknown };
        const eventLog: EventRecord[] = [];

        const handlers: HandlerMap = new Map([
          [
            "smoke-check",
            async (_stageId: string, _clock: Clock): Promise<{ healthy: boolean; value: unknown }> => {
              callCount++;
              // Call 1: handler gate (healthy); call 2: soak poll 1 (healthy); call 3+: flip
              if (callCount <= 2) return { healthy: true, value: "ok" };
              return { healthy: false, value: "degraded-mid-soak" };
            },
          ],
          [
            "prod-check",
            async (_stageId: string, _clock: Clock): Promise<{ healthy: boolean; value: unknown }> =>
              ({ healthy: true, value: "ok" }),
          ],
        ]);

        const onEvent = (event: string, ctx: Record<string, unknown>): void => {
          eventLog.push({ event, stageId: String(ctx["stageId"] ?? ""), evidence: ctx["evidence"] });
        };

        // Don't await — soak requires clock advancement
        const pollPromise = pollOnce(store, "feat-001", liveHash, lm, new Map(), {
          handlers, clock, onEvent,
        });

        // Handler gate (call 1, healthy) → soakStage registers timer at t=60_000ms
        await flushMicrotasks();

        // Soak poll 1 (t=60_000ms): call 2 → healthy; schedules timer at t=120_000ms
        clock.advance(60_000);
        await flushMicrotasks();

        // Soak poll 2 (t=120_000ms): call 3 → unhealthy → halt_and_escalate resolves soakStage
        clock.advance(60_000);
        await flushMicrotasks();

        const dispatched = await pollPromise;
        assert.equal(dispatched.length, 1, "staging node dispatched via pollOnce lifecycle (lease + running)");

        // halt_and_escalate with soakWindowHistory
        const haltEvent = eventLog.find((e) => e.event === "halt_and_escalate");
        assert.ok(haltEvent !== undefined, "halt_and_escalate must be emitted for soak-flip");
        assert.equal(haltEvent?.stageId, "feat-001-deploy-staging");
        const ev = haltEvent?.evidence as {
          observer: string;
          value: unknown;
          stageId: string;
          soakWindowHistory?: Array<{ clockInstant: number; results: unknown[] }>;
        } | undefined;
        assert.ok(ev !== undefined, "evidence must be present for soak-flip");
        assert.equal(ev?.observer, "smoke-check", "evidence names the failing observer");
        assert.equal(ev?.value, "degraded-mid-soak", "evidence carries the degraded value");
        assert.equal(ev?.stageId, "feat-001-deploy-staging");
        assert.ok(
          Array.isArray(ev?.soakWindowHistory) && (ev?.soakWindowHistory?.length ?? 0) >= 1,
          "evidence must include soakWindowHistory with at least one prior healthy poll",
        );

        // Gate NOT marked
        const gateRow = store.get<{ exit_gate_passed: number }>(
          "SELECT exit_gate_passed FROM scheduler_task WHERE node_id = ?",
          "feat-001-deploy-staging",
        );
        assert.equal(gateRow?.exit_gate_passed, 0, "staging gate must NOT be passed after soak-flip halt");

        // Downstream NOT dispatchable
        const dispAfter = dispatchable(store, "feat-001").map((r: TaskRow) => r.id);
        assert.ok(
          !dispAfter.includes("feat-001-deploy-production"),
          "deploy-production must NOT be dispatchable after soak-flip halt (gate not passed)",
        );

        // No further dispatches
        const nextWave = await pollOnce(store, "feat-001", liveHash, lm, new Map(), {
          handlers, clock, onEvent,
        });
        assert.equal(nextWave.length, 0, "no further deploy nodes dispatched after soak-flip halt");
      });
    });
  });

  // ---------------------------------------------------------------------------
  // S1-poll-dispatched-outcome — async pollOnce result distinguishes pass vs halt
  // ---------------------------------------------------------------------------

  describe("S1-poll-dispatched-outcome — DispatchedTask.outcome distinguishes passed vs halted deploy stages", () => {
    let featDir = "";
    let testDir = "";
    let store: Store;
    let clock: FakeClock;
    let lm: LeaseManager;
    let liveHash = "";

    before(async () => {
      featDir = await mkdtemp(join(tmpdir(), "kanthord-dd-s1-feat-"));
      await writeFile(join(featDir, "epic.md"), EPIC_MD_DEPLOY);
      await writeFile(join(featDir, "RUNBOOK.md"), "# Runbook\n");
      const sA = join(featDir, "001-story-a");
      await mkdir(sA);
      await writeFile(join(sA, "INDEX.md"), "# Story A\n");
      await writeFile(join(sA, "001-task-alpha.md"), TASK_ALPHA_MD);
    });

    after(async () => {
      if (featDir) await rm(featDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
      testDir = await mkdtemp(join(tmpdir(), "kanthord-dd-s1-db-"));
      store = openStore(join(testDir, "test.db"), { busyTimeout: 1000 });
      clock = new FakeClock(0);
      lm = new LeaseManager(store, clock);
      await compile(featDir, store, COMPILE_OPTS);
      initSchema(store);
      loadTasks(store, "feat-001");
      const genRow = store.get<{ compile_hash: string }>(
        "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001' ORDER BY generation DESC LIMIT 1",
      );
      liveHash = genRow?.compile_hash ?? "";
      setTaskStatus(store, "task-alpha", "done");
      markExitGatePassed(store, "task-alpha");
    });

    afterEach(async () => {
      store.close();
      if (testDir) await rm(testDir, { recursive: true, force: true });
      testDir = "";
    });

    test("passed deploy stage carries outcome:'pass' in DispatchedTask", async () => {
      const handlers: HandlerMap = new Map([
        ["smoke-check", async (_s: string, _c: Clock): Promise<{ healthy: boolean; value: unknown }> => ({ healthy: true, value: "ok" })],
        ["prod-check", async (_s: string, _c: Clock): Promise<{ healthy: boolean; value: unknown }> => ({ healthy: true, value: "ok" })],
      ]);

      const dispatched = await pollOnce(store, "feat-001", liveHash, lm, new Map(), {
        handlers,
        clock,
        onEvent: () => {},
      });

      assert.equal(dispatched.length, 1, "staging node must be dispatched");
      assert.equal(dispatched[0]?.taskId, "feat-001-deploy-staging");
      assert.equal(
        (dispatched[0] as Record<string, unknown>)["outcome"],
        "pass",
        "passed deploy-stage DispatchedTask must carry outcome:'pass'",
      );
    });

    test("halted deploy stage carries outcome:'halt' and remains in dispatched list", async () => {
      const handlers: HandlerMap = new Map([
        ["smoke-check", async (_s: string, _c: Clock): Promise<{ healthy: boolean; value: unknown }> => ({ healthy: false, value: "fail" })],
        ["prod-check", async (_s: string, _c: Clock): Promise<{ healthy: boolean; value: unknown }> => ({ healthy: true, value: "ok" })],
      ]);

      const dispatched = await pollOnce(store, "feat-001", liveHash, lm, new Map(), {
        handlers,
        clock,
        onEvent: () => {},
      });

      assert.equal(dispatched.length, 1, "halted deploy stage must remain in dispatched list");
      assert.equal(dispatched[0]?.taskId, "feat-001-deploy-staging");
      assert.equal(
        (dispatched[0] as Record<string, unknown>)["outcome"],
        "halt",
        "halted deploy-stage DispatchedTask must carry outcome:'halt'",
      );
    });

    test("synchronous pollOnce (no deployOpts) returns items with no outcome field — backward-compatible", () => {
      // Sync path dispatches deploy-staging node (steps 1-4 only, no executor).
      const dispatched = pollOnce(store, "feat-001", liveHash, lm, new Map());
      assert.ok(dispatched.length >= 1, "sync pollOnce must dispatch at least one node");
      for (const d of dispatched) {
        assert.equal(
          (d as Record<string, unknown>)["outcome"],
          undefined,
          `sync/task DispatchedTask must not carry outcome field — got ${JSON.stringify(d)}`,
        );
      }
    });
  });
});

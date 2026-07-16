/**
 * src/rpc/read-surfaces.test.ts
 *
 * Story 001 – Read Surfaces · Task T1 – Feature + broker surfaces.
 *
 * Tests the four read-surface functions against a golden compiled fixture:
 *   (a) listFeatures – id, status, phase, and progress summary per feature.
 *   (b) getFeature   – drill-down: stories/tasks, DAG progress, in-flight ops,
 *                      STATE/JOURNAL content views.
 *   (c) listBrokerOperations – in-flight and expiring pending ops.
 *   (d) listBrokerVerbs – registry view with tiers; descriptor has no write method.
 *   (e) zero writes – all three store-reading functions perform zero store.run() calls.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import { initSchema } from "../store/schema.ts";
import { applyCompiledPlanMigration } from "../compiler/compile.ts";
import { DaemonService } from "../generated/kanthord/v1/daemon_pb.js";
import type { Store } from "../foundations/sqlite-store.ts";
import {
  listFeatures,
  getFeature,
  listBrokerOperations,
  listBrokerVerbs,
  listSlots,
  getBudget,
  getDaemonStatus,
  triggerVerify,
  getTaskTimeline,
  getPublicConfiguration,
  type ReadSurfacesDeps,
} from "./read-surfaces.ts";
import type { LeafLogger } from "../foundations/log.ts";
import { appendTimelineEvent } from "../metrics/task-timeline.ts";

// ---------------------------------------------------------------------------
// B1/B4 regression — fake injectable logger (captures warn/debug calls)
// ---------------------------------------------------------------------------

class FakeLeafLogger implements LeafLogger {
  warnCalls: Array<{ event: string; fields?: Record<string, unknown> }>;
  debugCalls: Array<{ event: string; fields?: Record<string, unknown> }>;

  constructor() {
    this.warnCalls = [];
    this.debugCalls = [];
  }

  debug(event: string, fields?: Record<string, unknown>): void {
    this.debugCalls.push({ event, fields });
  }

  info(_event: string, _fields?: Record<string, unknown>): void {}

  warn(event: string, fields?: Record<string, unknown>): void {
    this.warnCalls.push({ event, fields });
  }

  error(_event: string, _fields?: Record<string, unknown>): void {}

  child(_bindings: Record<string, unknown>): LeafLogger {
    return this;
  }
}

// ---------------------------------------------------------------------------
// Golden fixture constants (Story-named Mocks per PROFILE.md)
// ---------------------------------------------------------------------------

const FEAT_ID = "feat-001";
const STORY_1 = "001-alpha";
const STORY_2 = "002-beta";
const TASK_1 = `${FEAT_ID}/${STORY_1}/T1-done`;
const TASK_2 = `${FEAT_ID}/${STORY_1}/T2-pending`;
const TASK_3 = `${FEAT_ID}/${STORY_2}/T3-pending`;

const OP_INFLIGHT_ID = "op_INFLIGHT00000000000000000";
const OP_PENDING_ID = "op_PENDING000000000000000000";

// B4 regression — task timeline
const TL_TASK_ID = `${FEAT_ID}/${STORY_1}/T-timeline-001`;

// Fixed "now" for deterministic expiry computation.
const NOW_MS = 1_000_000;
// provision_resource pending op expires after 60s.
const PENDING_EXPIRY_MS = 60_000;
// pending_at chosen so the op expires in 5s from NOW_MS → expiring=true.
const EXPIRING_PENDING_AT = NOW_MS - (PENDING_EXPIRY_MS - 5_000);

const STATE_CONTENT = "# Golden State\nfeature in progress";
const JOURNAL_CONTENT = "# Golden Journal\nfirst entry";

// ---------------------------------------------------------------------------
// Task T2 — golden fixture constants (Mocks)
// ---------------------------------------------------------------------------

const SLOT_NAME = "slot-alpha";
const SLOT_REPO = "/repos/sandbox";
const SLOT_LEASE_HOLDER = "task-hold-001";
const SLOT_SESSION = "ses-abc123";

const BUDGET_TASK_NO_OVERRIDE = "feat-001/001-alpha/T1-budget-no-override";
const BUDGET_TASK_WITH_OVERRIDE = "feat-001/001-alpha/T2-budget-override";
const BUDGET_CEILING = 10.0;

// Reconciled ledger: reservation 3.0 → reconciled to 2.5; spent=2.5, breakerState=closed.
const LEDGER_NO_OVERRIDE = JSON.stringify([
  { kind: "reservation", reservationId: "rsv_001", conservativeCharge: 3.0 },
  { kind: "reconcile",   reservationId: "rsv_001", finalActual: 2.5 },
]);

// Override-only ledger (no reservations): override.present=true.
const LEDGER_WITH_OVERRIDE = JSON.stringify([
  { kind: "override", amount: 20.0, reason: "task needs more budget", actor: "ulrich" },
]);

const VERIFY_OUTCOME = "pass";
const VERIFY_REPORT_JSON = '{"divergences":[]}';

/**
 * T2 extended deps shape.
 * The SE will add these fields to ReadSurfacesDeps in production; this local
 * interface names the seam the new functions are tested against.
 */
interface ReadSurfacesDepsT2 extends ReadSurfacesDeps {
  slotRegistry: Array<{
    name: string;
    repo: string;
    strategy: string;
    heldLeases: string[];
    activeSessions: string[];
  }>;
  getBudgetCeiling: (taskId: string) => number;
  daemonVersion: string;
  uptimeFn: () => number;
  verifyFn: () => Promise<{ outcome: string; reportJson: string }>;
}

interface PublicConfiguration {
  diffEscalationPolicy: "escalate_all_diffs";
  brokerDeclarations: Array<{
    verb: string;
    tier: string;
    timeoutMs: number;
    idempotencyWindowMs: number;
    retryMax: number;
    retryBackoff: string;
    pollIntervalMs: number;
    terminalStates: string[];
    requestsPerMinute: number;
    observedStateCanRegress: boolean;
    pendingExpiryMs?: number;
  }>;
}

interface PublicConfigurationDeps extends ReadSurfacesDeps {
  publicConfiguration: PublicConfiguration;
}

const PUBLIC_CONFIGURATION: PublicConfiguration = {
  diffEscalationPolicy: "escalate_all_diffs",
  brokerDeclarations: [
    {
      verb: "github.create_pr",
      tier: "auto_with_audit",
      timeoutMs: 120_000,
      idempotencyWindowMs: 3_600_000,
      retryMax: 5,
      retryBackoff: "exponential",
      pollIntervalMs: 10_000,
      terminalStates: ["done", "failed", "escalation_needed"],
      requestsPerMinute: 60,
      observedStateCanRegress: true,
      pendingExpiryMs: 300_000,
    },
  ],
};

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Open a store, apply all schema (initSchema + compiled-plan tables). */
function openTestStore(dir: string): Store {
  const store = openStore(join(dir, "test.db"), { busyTimeout: 1000 });
  initSchema(store);
  applyCompiledPlanMigration(store);
  return store;
}

/**
 * Insert golden plan nodes, edges, scheduler-task rows, and broker ops into
 * the store. Layout:
 *   feature: feat-001 (epic)
 *   story 001-alpha: T1-done (done, exit_gate_passed), T2-pending (pending)
 *   story 002-beta:  T3-pending (pending)
 *   edge: T1-done → T2-pending (grammar)
 *   broker: 1 in-flight op (deploy_service) + 1 expiring pending op (provision_resource)
 */
function insertGoldenData(store: Store): void {
  // Epic (feature) node.
  store.run(
    "INSERT INTO plan_node (id, kind, feature_id, generation) VALUES (?, ?, ?, ?)",
    FEAT_ID, "epic", FEAT_ID, 1,
  );
  // Story nodes.
  store.run(
    "INSERT INTO plan_node (id, kind, feature_id, generation) VALUES (?, ?, ?, ?)",
    `${FEAT_ID}/${STORY_1}`, "story", FEAT_ID, 1,
  );
  store.run(
    "INSERT INTO plan_node (id, kind, feature_id, generation) VALUES (?, ?, ?, ?)",
    `${FEAT_ID}/${STORY_2}`, "story", FEAT_ID, 1,
  );
  // Task nodes.
  store.run(
    "INSERT INTO plan_node (id, kind, feature_id, generation) VALUES (?, ?, ?, ?)",
    TASK_1, "task", FEAT_ID, 1,
  );
  store.run(
    "INSERT INTO plan_node (id, kind, feature_id, generation) VALUES (?, ?, ?, ?)",
    TASK_2, "task", FEAT_ID, 1,
  );
  store.run(
    "INSERT INTO plan_node (id, kind, feature_id, generation) VALUES (?, ?, ?, ?)",
    TASK_3, "task", FEAT_ID, 1,
  );
  // DAG edge: T1→T2.
  store.run(
    "INSERT INTO plan_edge (from_node_id, to_node_id, kind) VALUES (?, ?, ?)",
    TASK_1, TASK_2, "grammar",
  );
  // Scheduler task statuses.
  store.run(
    "INSERT INTO scheduler_task (node_id, feature_id, status, exit_gate_passed) VALUES (?, ?, ?, ?)",
    TASK_1, FEAT_ID, "done", 1,
  );
  store.run(
    "INSERT INTO scheduler_task (node_id, feature_id, status, exit_gate_passed) VALUES (?, ?, ?, ?)",
    TASK_2, FEAT_ID, "pending", 0,
  );
  store.run(
    "INSERT INTO scheduler_task (node_id, feature_id, status, exit_gate_passed) VALUES (?, ?, ?, ?)",
    TASK_3, FEAT_ID, "pending", 0,
  );
  // In-flight broker op; feature_id is encoded in payload_json so the
  // implementation can correlate it to the feature's drill-down.
  store.run(
    `INSERT INTO broker_in_flight
       (op_id, verb, request_id, idempotency_key, payload_json, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    OP_INFLIGHT_ID,
    "deploy_service",
    "req-001",
    "idem-001",
    JSON.stringify({ feature_id: FEAT_ID }),
    "in_flight",
  );
  // Pending op with pending_at old enough to be flagged as expiring at NOW_MS.
  store.run(
    "INSERT INTO broker_pending (op_id, verb, idempotency_key, pending_at, status) VALUES (?, ?, ?, ?, ?)",
    OP_PENDING_ID,
    "provision_resource",
    "idem-002",
    EXPIRING_PENDING_AT,
    "pending",
  );
}

/** Verb registry for the golden fixture. */
function makeVerbRegistry(): Array<{ verb: string; tier: string; pending_expiry_ms?: number }> {
  return [
    { verb: "deploy_service", tier: "auto" },
    { verb: "provision_resource", tier: "approval_required", pending_expiry_ms: PENDING_EXPIRY_MS },
  ];
}

/**
 * Build the full ReadSurfacesDeps for a given temp dir:
 * opens the store, inserts golden data, writes STATE.md + JOURNAL.md.
 */
async function makeDeps(dir: string): Promise<{ deps: ReadSurfacesDeps; store: Store }> {
  const store = openTestStore(dir);
  insertGoldenData(store);
  const featureDir = join(dir, "features", FEAT_ID);
  await mkdir(featureDir, { recursive: true });
  await writeFile(join(featureDir, "STATE.md"), STATE_CONTENT, "utf8");
  await writeFile(join(featureDir, "JOURNAL.md"), JOURNAL_CONTENT, "utf8");
  const deps: ReadSurfacesDeps = {
    store,
    featureDataRoot: join(dir, "features"),
    nowMs: NOW_MS,
    verbRegistry: makeVerbRegistry(),
  };
  return { deps, store };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("src/rpc/read-surfaces.ts", () => {
  test("DaemonService descriptor exposes the GetFeatureSummary read method", () => {
    assert.ok(
      DaemonService.methods.some((method) => method.localName === "getFeatureSummary"),
      "DaemonService must expose GetFeatureSummary as the getFeatureSummary read method",
    );
  });

  test("getPublicConfiguration returns only typed allowlisted YAML configuration and DaemonService exposes no config write, path, or file method", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-public-config-"));
    try {
      const { deps } = await makeDeps(dir);
      const unsafeConfig = {
        ...PUBLIC_CONFIGURATION,
        configPath: "/private/kanthord.yaml",
        credentials: [{ username: "operator", password: "not-public" }],
      };
      const publicDeps: PublicConfigurationDeps = {
        ...deps,
        publicConfiguration: unsafeConfig,
      };

      assert.deepEqual(
        getPublicConfiguration(publicDeps),
        PUBLIC_CONFIGURATION,
        "the public configuration response must expose only the typed safe allowlist",
      );

      const configurationMethods = DaemonService.methods
        .map((method) => method.localName)
        .filter((name) => name.toLowerCase().includes("config"));
      assert.deepEqual(
        configurationMethods,
        ["getPublicConfiguration"],
        "DaemonService must expose only getPublicConfiguration: no config write, path, or file method",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (a) listFeatures – per-feature id, status, phase, progress summary
  // -------------------------------------------------------------------------
  test("listFeatures returns feature id, status, phase, and progress summary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-t1-list-"));
    try {
      const { deps } = await makeDeps(dir);
      const result = listFeatures(deps);
      assert.equal(result.features.length, 1, "one feature in the golden store");
      const feat = result.features[0];
      assert.ok(feat, "feature entry must be present");
      assert.equal(feat.featureId, FEAT_ID);
      assert.equal(feat.status, "in_progress");
      assert.equal(feat.phase, "coding");
      assert.equal(feat.progressSummary, "1/3 tasks satisfied");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (b) getFeature – drill-down: stories/tasks + DAG + ops + STATE/JOURNAL
  // -------------------------------------------------------------------------
  test("getFeature returns stories with tasks, DAG progress, in-flight ops, and STATE/JOURNAL views", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-t1-get-"));
    try {
      const { deps } = await makeDeps(dir);
      const result = await getFeature(FEAT_ID, deps);

      assert.equal(result.featureId, FEAT_ID);
      assert.equal(result.status, "in_progress");

      // Stories with tasks.
      assert.equal(result.stories.length, 2, "two stories");
      const story1 = result.stories.find(s => s.storyId === `${FEAT_ID}/${STORY_1}`);
      assert.ok(story1, "story 001-alpha must be present");
      assert.equal(story1.tasks.length, 2, "story 001-alpha has two tasks");

      const task1 = story1.tasks.find(t => t.taskId === TASK_1);
      assert.ok(task1, "T1-done must be present in story1");
      assert.equal(task1.status, "done");
      assert.equal(task1.exitGatePassed, true);

      const task2 = story1.tasks.find(t => t.taskId === TASK_2);
      assert.ok(task2, "T2-pending must be present in story1");
      assert.equal(task2.status, "pending");
      assert.equal(task2.exitGatePassed, false);

      const story2 = result.stories.find(s => s.storyId === `${FEAT_ID}/${STORY_2}`);
      assert.ok(story2, "story 002-beta must be present");
      assert.equal(story2.tasks.length, 1, "story 002-beta has one task");

      // DAG progress: 3 task nodes, 1 satisfied; 1 edge, 1 satisfied (T1 is done).
      assert.equal(result.dag.totalNodes, 3, "3 task nodes total");
      assert.equal(result.dag.satisfiedNodes, 1, "1 node with exit_gate_passed");
      assert.equal(result.dag.totalEdges, 1, "1 DAG edge");
      assert.equal(result.dag.satisfiedEdges, 1, "T1→T2 is satisfied since T1 is done");

      // In-flight ops for this feature.
      const inflight = result.inFlightOps.find(o => o.opId === OP_INFLIGHT_ID);
      assert.ok(inflight, "in-flight op must appear in feature drill-down");
      assert.equal(inflight.verb, "deploy_service");
      assert.equal(inflight.state, "in_flight");
      assert.equal(inflight.correlation, "idem-001");

      // STATE and JOURNAL content views.
      assert.equal(result.stateView, STATE_CONTENT);
      assert.equal(result.journalView, JOURNAL_CONTENT);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (c) listBrokerOperations – in-flight + expiring pending ops
  // -------------------------------------------------------------------------
  test("listBrokerOperations returns in-flight op and expiring pending op with correlation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-t1-ops-"));
    try {
      const { deps } = await makeDeps(dir);
      const result = listBrokerOperations(deps);

      assert.ok(result.operations.length >= 2, "at least two broker operations");

      const inflight = result.operations.find(o => o.opId === OP_INFLIGHT_ID);
      assert.ok(inflight, "in-flight op must be listed");
      assert.equal(inflight.verb, "deploy_service");
      assert.equal(inflight.state, "in_flight");
      assert.equal(inflight.correlation, "idem-001");

      // Expiring pending op – near its pending_expiry_ms deadline.
      const pending = result.operations.find(o => o.opId === OP_PENDING_ID);
      assert.ok(pending, "expiring pending op must be listed");
      assert.equal(pending.verb, "provision_resource");
      assert.equal(pending.correlation, "idem-002");
      assert.equal(
        pending.expiring,
        true,
        "pending op within expiry window of nowMs must be flagged as expiring",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (d) listBrokerVerbs – registry view with tiers; descriptor has no write method
  // -------------------------------------------------------------------------
  test("listBrokerVerbs returns registry verbs with tiers; DaemonService descriptor has no registry-write method", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-t1-verbs-"));
    try {
      const { deps } = await makeDeps(dir);
      const result = listBrokerVerbs(deps);
      assert.equal(result.verbs.length, 2, "two verbs in the registry fixture");

      const deployVerb = result.verbs.find(v => v.verb === "deploy_service");
      assert.ok(deployVerb, "deploy_service must be listed");
      assert.equal(deployVerb.tier, "auto");

      const provisionVerb = result.verbs.find(v => v.verb === "provision_resource");
      assert.ok(provisionVerb, "provision_resource must be listed");
      assert.ok(provisionVerb.tier.length > 0, "tier must be a non-empty string");

      // Descriptor check: no verb-registry write RPC exists.
      const methodNames = DaemonService.methods.map(m => m.name.toLowerCase());
      const registryWritePattern = /write.*verb|register.*verb|create.*verb|update.*verb|delete.*verb/;
      const hasRegistryWrite = methodNames.some(n => registryWritePattern.test(n));
      assert.equal(hasRegistryWrite, false, "DaemonService descriptor must hold no verb-registry write method");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // Task T2 — slots, budgets, daemon-ops, surface checklist
  // =========================================================================

  // -------------------------------------------------------------------------
  // T2 (a) listSlots – slot view with repo, strategy, held leases, active sessions
  // -------------------------------------------------------------------------
  test("listSlots returns registered slot with repo, strategy, held leases, and active sessions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-t2-slots-"));
    try {
      const { deps } = await makeDeps(dir);
      const t2Deps: ReadSurfacesDepsT2 = {
        ...deps,
        slotRegistry: [
          {
            name: SLOT_NAME,
            repo: SLOT_REPO,
            strategy: "worktree",
            heldLeases: [SLOT_LEASE_HOLDER],
            activeSessions: [SLOT_SESSION],
          },
        ],
        getBudgetCeiling: (_taskId) => BUDGET_CEILING,
        daemonVersion: "0.0.0",
        uptimeFn: () => 42,
        verifyFn: async () => ({ outcome: VERIFY_OUTCOME, reportJson: VERIFY_REPORT_JSON }),
      };

      const result = listSlots(t2Deps);
      assert.equal(result.slots.length, 1, "one slot in the registry");
      const slot = result.slots[0];
      assert.ok(slot, "slot entry must be present");
      assert.equal(slot.name, SLOT_NAME);
      assert.equal(slot.repo, SLOT_REPO);
      assert.equal(slot.strategy, "worktree");
      assert.deepEqual(slot.heldLeases, [SLOT_LEASE_HOLDER]);
      assert.deepEqual(slot.activeSessions, [SLOT_SESSION]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2 (b) getBudget – spent, ceiling, breakerState, and override info
  // -------------------------------------------------------------------------
  test("getBudget returns spent, ceiling, breakerState, and override info when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-t2-budget-"));
    try {
      const { deps, store } = await makeDeps(dir);
      const t2Deps: ReadSurfacesDepsT2 = {
        ...deps,
        slotRegistry: [],
        getBudgetCeiling: (_taskId) => BUDGET_CEILING,
        daemonVersion: "0.0.0",
        uptimeFn: () => 42,
        verifyFn: async () => ({ outcome: VERIFY_OUTCOME, reportJson: VERIFY_REPORT_JSON }),
      };

      // Insert golden budget ledger rows.
      store.run(
        "INSERT INTO budget_ledger (task_id, ledger) VALUES (?, ?)",
        BUDGET_TASK_NO_OVERRIDE,
        LEDGER_NO_OVERRIDE,
      );
      store.run(
        "INSERT INTO budget_ledger (task_id, ledger) VALUES (?, ?)",
        BUDGET_TASK_WITH_OVERRIDE,
        LEDGER_WITH_OVERRIDE,
      );

      // Case 1: reconciled ledger, no override.
      const result1 = await getBudget(BUDGET_TASK_NO_OVERRIDE, t2Deps);
      assert.equal(result1.taskId, BUDGET_TASK_NO_OVERRIDE);
      assert.equal(result1.spent, 2.5, "spent = reconciled finalActual");
      assert.equal(result1.ceiling, BUDGET_CEILING);
      assert.equal(result1.breakerState, "closed", "closed when spent < ceiling");
      assert.equal(result1.override.present, false, "no override entry in ledger");

      // Case 2: override entry only — override.present=true.
      const result2 = await getBudget(BUDGET_TASK_WITH_OVERRIDE, t2Deps);
      assert.equal(result2.override.present, true, "override entry present in ledger");
      assert.equal(result2.override.amount, 20.0);
      assert.equal(result2.override.reason, "task needs more budget");
      assert.equal(result2.override.actor, "ulrich");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2 (c-1) getDaemonStatus – version, uptimeSeconds, absent lastPing / lastVerify
  // -------------------------------------------------------------------------
  test("getDaemonStatus returns version, uptimeSeconds, and absent lastPing and lastVerify", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-t2-daemon-status-"));
    try {
      const { deps } = await makeDeps(dir);
      const t2Deps: ReadSurfacesDepsT2 = {
        ...deps,
        slotRegistry: [],
        getBudgetCeiling: (_taskId) => BUDGET_CEILING,
        daemonVersion: "0.0.0",
        uptimeFn: () => 42,
        verifyFn: async () => ({ outcome: VERIFY_OUTCOME, reportJson: VERIFY_REPORT_JSON }),
      };

      const result = await getDaemonStatus(t2Deps);
      assert.equal(result.version, "0.0.0");
      assert.equal(result.uptimeSeconds, 42);
      assert.ok(result.lastPing, "lastPing field must be present even with no ping stored");
      assert.equal(result.lastPing.present, false, "lastPing absent before Epic 029 populates it");
      assert.ok(result.lastVerify, "lastVerify field must be present even with no report stored");
      assert.equal(result.lastVerify.present, false, "lastVerify absent when no report stored");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2 (c-2) triggerVerify – calls verify engine and writes exactly one record
  // -------------------------------------------------------------------------
  test("triggerVerify calls the verify engine and writes exactly one report record", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-t2-verify-"));
    try {
      const { deps } = await makeDeps(dir);
      let writeCalls = 0;
      const countingStore: Store = {
        get: <T>(sql: string, ...params: unknown[]): T | undefined =>
          deps.store.get<T>(sql, ...params),
        all: <T>(sql: string, ...params: unknown[]): T[] =>
          deps.store.all<T>(sql, ...params),
        run: (sql: string, ...params: unknown[]): void => {
          writeCalls++;
          deps.store.run(sql, ...params);
        },
        close: () => deps.store.close(),
      };

      const t2Deps: ReadSurfacesDepsT2 = {
        ...deps,
        store: countingStore,
        slotRegistry: [],
        getBudgetCeiling: (_taskId) => BUDGET_CEILING,
        daemonVersion: "0.0.0",
        uptimeFn: () => 42,
        verifyFn: async () => ({ outcome: VERIFY_OUTCOME, reportJson: VERIFY_REPORT_JSON }),
      };

      const result = await triggerVerify(t2Deps);
      assert.equal(
        writeCalls,
        1,
        "triggerVerify must write exactly one report record (its single declared write)",
      );
      assert.ok(result.report, "report must be present in the response");
      assert.equal(result.report.present, true);
      assert.equal(result.report.outcome, VERIFY_OUTCOME);
      assert.equal(result.report.reportJson, VERIFY_REPORT_JSON);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2 (d) surface checklist – phases.md 2B surfaces → DaemonService methods;
  //         no plan-file or registry write method exists
  // -------------------------------------------------------------------------
  test("surface checklist — all phases.md 2B dashboard surfaces map to a DaemonService method and no plan/registry write method exists", () => {
    const methodNamesLower = DaemonService.methods.map((m) => m.name.toLowerCase());
    const methodSet = new Set(methodNamesLower);

    // Every phases.md Phase 2B control-plane surface must map to a descriptor method.
    const expectedSurfaces: Record<string, string> = {
      "features.list":               "listfeatures",
      "features.get":                "getfeature",
      "plan.signOff":                "signoffplan",
      "task.halt":                   "halttask",
      "feature.halt":                "haltfeature",
      "plan.approveReplan":          "approvereplan",
      "inbox.list":                  "listinboxitems",
      "inbox.respondEscalation":     "respondtoescalation",
      "inbox.respondApproval":       "respondtoapproval",
      "broker.operations":           "listbrokeroperations",
      "broker.verbs":                "listbrokerverbs",
      "slots.list":                  "listslots",
      "budgets.get":                 "getbudget",
      "budget.override":             "overridebudget",
      "daemon.status":               "getdaemonstatus",
      "daemon.verify":               "triggerverify",
      "audit.taskTimeline":          "gettasktimeline",
      "audit.sessionEvents":         "subscribesessionevents",
    };

    for (const [surface, expectedMethod] of Object.entries(expectedSurfaces)) {
      assert.ok(
        methodSet.has(expectedMethod),
        `phases.md surface "${surface}" must map to DaemonService method "${expectedMethod}"`,
      );
    }

    // No plan-file or registry write method may exist in the descriptor.
    const planRegistryWritePattern = /write.*plan|edit.*plan|update.*plan|create.*plan|delete.*plan|register.*verb|create.*verb|update.*verb|delete.*verb/;
    const hasWriteMethod = methodNamesLower.some((n) => planRegistryWritePattern.test(n));
    assert.equal(
      hasWriteMethod,
      false,
      "DaemonService must have no plan-file or registry write method (read-only by design)",
    );
  });

  // =========================================================================
  // Task T1 — zero writes (retained from original placement)
  // =========================================================================

  // -------------------------------------------------------------------------
  // (e) Zero writes – all store-reading functions perform zero store.run() calls
  // -------------------------------------------------------------------------
  // =========================================================================
  // B1 regression — JSON.parse errors in getFeature and listBrokerOperations
  // must be logged via an injected logger, not silently swallowed.
  // =========================================================================

  test("getFeature — JSON.parse error in broker payload is logged via injected logger (B1 regression)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-b1-getfeature-"));
    try {
      const { deps, store: s } = await makeDeps(dir);

      // Insert an extra broker_in_flight row whose payload_json is malformed.
      s.run(
        `INSERT INTO broker_in_flight
           (op_id, verb, request_id, idempotency_key, payload_json, status)
           VALUES (?, ?, ?, ?, ?, ?)`,
        "op_B1MALFORMED0000000000000",
        "deploy_service",
        "req-b1",
        "idem-b1",
        "not-valid-json{{{",
        "in_flight",
      );

      const fakeLogger = new FakeLeafLogger();
      // Wider object satisfies ReadSurfacesDeps (structural typing); logger is injected
      // so the fixed production code can call deps.logger?.warn(…) in the catch block.
      const depsWithLogger = { ...deps, logger: fakeLogger };

      await getFeature(FEAT_ID, depsWithLogger);

      const loggedCalls = [...fakeLogger.warnCalls, ...fakeLogger.debugCalls];
      assert.ok(
        loggedCalls.length > 0,
        "getFeature must log the JSON.parse error via deps.logger (not silently swallow it)",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("listBrokerOperations — JSON.parse error in broker payload is logged via injected logger (B1 regression)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-b1-ops-"));
    try {
      const { deps, store: s } = await makeDeps(dir);

      // Insert a broker_in_flight row with malformed payload_json.
      s.run(
        `INSERT INTO broker_in_flight
           (op_id, verb, request_id, idempotency_key, payload_json, status)
           VALUES (?, ?, ?, ?, ?, ?)`,
        "op_B1OPS0000000000000000000",
        "deploy_service",
        "req-b1-ops",
        "idem-b1-ops",
        "{bad json{{",
        "in_flight",
      );

      const fakeLogger = new FakeLeafLogger();
      const depsWithLogger = { ...deps, logger: fakeLogger };

      listBrokerOperations(depsWithLogger);

      const loggedCalls = [...fakeLogger.warnCalls, ...fakeLogger.debugCalls];
      assert.ok(
        loggedCalls.length > 0,
        "listBrokerOperations must log the JSON.parse error via deps.logger (not silently swallow it)",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // B4 regression — getTaskTimeline: thin wiring over 019.5's queryTaskTimeline
  // =========================================================================

  test("getTaskTimeline returns 019.5 queryTaskTimeline output as thin wiring — zero writes (B4 regression)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-b4-timeline-"));
    try {
      const { deps, store: s } = await makeDeps(dir);

      // Insert one golden timeline event for TL_TASK_ID.
      appendTimelineEvent(s, {
        task_id: TL_TASK_ID,
        attempt: 1,
        correlation_id: "corr-tl-001",
        kind: "task_start",
        ts: 1_000,
      });

      // Wrap the store to count writes; getTaskTimeline must make zero.
      let writeCalls = 0;
      const countingStore: Store = {
        get: <T>(sql: string, ...params: unknown[]): T | undefined =>
          deps.store.get<T>(sql, ...params),
        all: <T>(sql: string, ...params: unknown[]): T[] =>
          deps.store.all<T>(sql, ...params),
        run: (sql: string, ...params: unknown[]): void => {
          writeCalls++;
          deps.store.run(sql, ...params);
        },
        close: () => deps.store.close(),
      };
      const readDeps: ReadSurfacesDeps = { ...deps, store: countingStore };

      const result = getTaskTimeline(TL_TASK_ID, readDeps);

      assert.equal(writeCalls, 0, "getTaskTimeline must perform zero store.run() calls");
      assert.ok(result.length >= 1, "must return at least one timeline event for TL_TASK_ID");
      const evt = result[0];
      assert.ok(evt !== undefined, "first event must be present");
      assert.equal(evt.task_id, TL_TASK_ID, "event task_id must match");
      assert.equal(evt.kind, "task_start", "event kind must match");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // WIRE-2 — N1 feature name + N5 reconciliation_status (function-level RED)
  //
  // N1: listFeatures() return type currently has no 'name' field; accessing
  //     via Record cast yields undefined → assert.equal fails (RED).
  //     After the SE adds 'name' to the return shape and falls back to
  //     feature_id when plan_node.slug is null, the assertion passes.
  //
  // N5: listBrokerOperations() return type currently has no
  //     'reconciliationStatus' field; same cast pattern → undefined → RED.
  //     After the SE adds the field, populated from broker_in_flight.status
  //     when that status equals 'needs_reconciliation', the assertions pass.
  // =========================================================================

  test("listFeatures — N1: name falls back to feature_id when slug is not stored in plan_node", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-w2-n1-"));
    try {
      const store = openTestStore(dir);
      try {
        // Epic node inserted with no slug column value (NULL by default in DDL).
        store.run(
          "INSERT INTO plan_node (id, kind, feature_id, generation) VALUES (?, ?, ?, ?)",
          FEAT_ID, "epic", FEAT_ID, 1,
        );
        const deps: ReadSurfacesDeps = {
          store,
          featureDataRoot: dir,
          nowMs: NOW_MS,
          verbRegistry: [],
        };
        const result = listFeatures(deps);
        const feat = result.features.find((f) => f.featureId === FEAT_ID);
        assert.ok(feat !== undefined, "expected feature in listFeatures result");
        // N1 contract: listFeatures must return a 'name' field for each feature;
        // when plan_node.slug is NULL (no display name stored), fall back to
        // feature_id.  Currently the return shape has no 'name' property →
        // cast to Record yields undefined → assert.equal(undefined, FEAT_ID) fails.
        const featRecord = feat as unknown as Record<string, unknown>;
        assert.equal(
          featRecord["name"],
          FEAT_ID,
          "N1: listFeatures must return name=feature_id as fallback when no slug stored",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("listBrokerOperations — N5: op with status=needs_reconciliation has reconciliationStatus='needs_reconciliation'", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-w2-n5a-"));
    try {
      const store = openTestStore(dir);
      try {
        store.run(
          "INSERT INTO broker_in_flight (op_id, verb, request_id, idempotency_key, payload_json, status) VALUES (?, ?, ?, ?, ?, ?)",
          "op_W2RECON0001", "merge_pr", "req-w2r1", "key-w2r1", null, "needs_reconciliation",
        );
        const deps: ReadSurfacesDeps = {
          store,
          featureDataRoot: dir,
          nowMs: NOW_MS,
          verbRegistry: [],
        };
        const result = listBrokerOperations(deps);
        const op = result.operations.find((o) => o.opId === "op_W2RECON0001");
        assert.ok(op !== undefined, "expected op_W2RECON0001 in operations");
        // N5 contract: when a broker op's stored status is 'needs_reconciliation',
        // the function must expose that as reconciliationStatus on the returned
        // operation.  Currently the return shape has no such property →
        // cast yields undefined → assert.equal(undefined, "needs_reconciliation") fails.
        const opRecord = op as unknown as Record<string, unknown>;
        assert.equal(
          opRecord["reconciliationStatus"],
          "needs_reconciliation",
          "N5: op with status=needs_reconciliation must expose reconciliationStatus='needs_reconciliation'",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("listBrokerOperations — N5: normal in_flight op has reconciliationStatus='' (honest default)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-w2-n5b-"));
    try {
      const store = openTestStore(dir);
      try {
        store.run(
          "INSERT INTO broker_in_flight (op_id, verb, request_id, idempotency_key, payload_json, status) VALUES (?, ?, ?, ?, ?, ?)",
          "op_W2INFLIGHT01", "merge_pr", "req-w2i1", "key-w2i1", null, "in_flight",
        );
        const deps: ReadSurfacesDeps = {
          store,
          featureDataRoot: dir,
          nowMs: NOW_MS,
          verbRegistry: [],
        };
        const result = listBrokerOperations(deps);
        const op = result.operations.find((o) => o.opId === "op_W2INFLIGHT01");
        assert.ok(op !== undefined, "expected op_W2INFLIGHT01 in operations");
        // N5 honest-default: a normal in_flight op has reconciliationStatus=''.
        // Currently the field does not exist in the return shape →
        // cast yields undefined → assert.equal(undefined, "") fails (undefined !== "").
        const opRecord = op as unknown as Record<string, unknown>;
        assert.equal(
          opRecord["reconciliationStatus"],
          "",
          "N5: normal in_flight op must have reconciliationStatus='' (honest default)",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("listFeatures, getFeature, and listBrokerOperations perform zero writes to the store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-t1-writes-"));
    try {
      const { deps } = await makeDeps(dir);
      // Wrap the store to count run() calls (run = write path).
      let writeCalls = 0;
      const countingStore: Store = {
        get: <T>(sql: string, ...params: unknown[]): T | undefined =>
          deps.store.get<T>(sql, ...params),
        all: <T>(sql: string, ...params: unknown[]): T[] =>
          deps.store.all<T>(sql, ...params),
        run: (sql: string, ...params: unknown[]): void => {
          writeCalls++;
          deps.store.run(sql, ...params);
        },
        close: () => deps.store.close(),
      };
      const readDeps: ReadSurfacesDeps = { ...deps, store: countingStore };

      listFeatures(readDeps);
      await getFeature(FEAT_ID, readDeps);
      listBrokerOperations(readDeps);

      assert.equal(writeCalls, 0, "read methods must perform zero store.run() calls");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

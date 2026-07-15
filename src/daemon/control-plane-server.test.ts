/**
 * src/daemon/control-plane-server.test.ts
 *
 * WIRE-1 (serve-wiring + D1) — Scope Extension 2026-07-15.
 *
 * Pins that each of the 17 Epic-026 methods is SERVED by the Connect router
 * in createStatusServer, routing to its read-surfaces / control-verbs function
 * over a real loopback Connect client; and that the D1 auth interceptor
 * rejects unauthenticated Connect calls when credentials are configured
 * (dev/test mode: no credentials → no enforcement of auth).
 *
 * RED state: all WIRE-1 routing tests throw ConnectError(Code.Unimplemented)
 * because createStatusServer currently registers only 4 handlers (getStatus,
 * listInboxItems, respondToEscalation, respondToApproval) and has no auth
 * interceptor.  The new opts fields (featureDataRoot, verbRegistry, …,
 * credentials) are not yet in the production type and are silently ignored at
 * runtime — the handlers still return Unimplemented.
 *
 * GREEN state: after the SE (a) adds the new opts fields to createStatusServer,
 * (b) registers all 17 handlers as thin adapters over the rpc functions, and
 * (c) wires the auth interceptor, all tests pass.
 *
 * Open to Software Engineer:
 *   Extend createStatusServer opts with:
 *     featureDataRoot?: string
 *     nowMs?: number
 *     verbRegistry?: Array<{ verb: string; tier: string; pending_expiry_ms?: number }>
 *     slotRegistry?: Array<{ name: string; repo: string; strategy: string; heldLeases: string[]; activeSessions: string[] }>
 *     getBudgetCeiling?: (taskId: string) => number
 *     daemonVersion?: string
 *     uptimeFn?: () => number
 *     verifyFn?: () => Promise<{ outcome: string; reportJson: string }>
 *     featureDirFn?: (featureId: string) => string
 *     overrideRateLimitFn?: (taskId: string) => { allowed: boolean }
 *     overrideDayCapFn?: (taskId: string) => { allowed: boolean }
 *     credentials?: Array<{ username: string; password: string }>
 *   Register all 17 handlers; wire auth interceptor (Unauthenticated when
 *   credentials configured and header absent/wrong, no-op when absent).
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import { initSchema } from "../store/schema.ts";
import { applyCompiledPlanMigration } from "../compiler/compile.ts";
import { appendTimelineEvent } from "../metrics/task-timeline.ts";
import { createStatusServer } from "./status-server.ts";
import { createConnectTransport } from "@connectrpc/connect-node";
import { createClient } from "@connectrpc/connect";
import { Code, ConnectError } from "@connectrpc/connect";
import { DaemonService } from "../generated/kanthord/v1/daemon_pb.js";
import type { Store } from "../foundations/sqlite-store.ts";
import type { StatusServer } from "./status-server.ts";

// ---------------------------------------------------------------------------
// Golden fixture constants (Story-named Mocks)
// ---------------------------------------------------------------------------

const FEAT_ID = "wire1-feat-001";
const STORY_ID = `${FEAT_ID}/001-s1`;
const TASK_A = `${STORY_ID}/001-task-a`; // primary read-test task

// Isolated IDs for control verbs (avoid state pollution of read tests)
const HALT_TASK_ID = `${STORY_ID}/001-task-halt`;    // isolated for haltTask
const HALT_FEAT_ID = "wire1-feat-halt";                // isolated for haltFeature
const HALT_FEAT_TASK = `${HALT_FEAT_ID}/001-s1/001-t1`;
const OVERRIDE_TASK_ID = `${STORY_ID}/001-task-override`; // for overrideBudget
const SIGN_OFF_FEAT_ID = "wire1-feat-sign-off";       // for signOffPlan (invalid plan)
const INBOX_ID = "wire1-inbox-001";

// Injected dep constants
const DAEMON_VERSION = "wire1-test-0.1.0";
const BUDGET_CEILING = 20.0;
const VERB_REGISTRY = [{ verb: "merge_pr", tier: "approval-required" }];
const SLOT_REGISTRY = [
  {
    name: "slot-alpha",
    repo: "/repos/sandbox",
    strategy: "exclusive",
    heldLeases: [] as string[],
    activeSessions: [] as string[],
  },
];

// budget_ledger entry for TASK_A: one reservation, no override, spent=5.0
const BUDGET_LEDGER_A = JSON.stringify([
  { kind: "reservation", reservationId: "r1", conservativeCharge: 5.0 },
]);

// ---------------------------------------------------------------------------
// Transport + client factory (type-safe; creates per-test loopback client)
// ---------------------------------------------------------------------------

function makeClient(host: string, port: number) {
  const transport = createConnectTransport({
    baseUrl: `http://${host}:${port}`,
    httpVersion: "1.1",
  });
  return createClient(DaemonService, transport);
}

// ---------------------------------------------------------------------------
// WIRE-1 — 17 Epic-026 handler routing tests
// ---------------------------------------------------------------------------

describe("src/daemon/control-plane-server.ts — WIRE-1 serve-wiring + D1 auth", () => {
  let tmpDir: string;
  let store: Store;
  let srv: StatusServer;
  let srvHost = "";
  let srvPort = 0;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "wire1-"));
    store = openStore(join(tmpDir, "wire1.db"), { busyTimeout: 1000 });
    initSchema(store);
    applyCompiledPlanMigration(store);

    // ---- plan_node fixture (epic + story + task) ----
    store.run(
      "INSERT INTO plan_node (id, kind, feature_id, generation) VALUES (?, ?, ?, ?)",
      FEAT_ID, "epic", FEAT_ID, 1,
    );
    store.run(
      "INSERT INTO plan_node (id, kind, feature_id, generation) VALUES (?, ?, ?, ?)",
      STORY_ID, "story", FEAT_ID, 1,
    );
    store.run(
      "INSERT INTO plan_node (id, kind, feature_id, generation) VALUES (?, ?, ?, ?)",
      TASK_A, "task", FEAT_ID, 1,
    );

    // ---- scheduler_task fixture ----
    // Primary task (for read tests)
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status, exit_gate_passed) VALUES (?, ?, ?, ?)",
      TASK_A, FEAT_ID, "pending", 0,
    );
    // Isolated halt-task (only consumed by haltTask test)
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status, exit_gate_passed) VALUES (?, ?, ?, ?)",
      HALT_TASK_ID, FEAT_ID, "pending", 0,
    );
    // Isolated halt-feature task (only consumed by haltFeature test)
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status, exit_gate_passed) VALUES (?, ?, ?, ?)",
      HALT_FEAT_TASK, HALT_FEAT_ID, "pending", 0,
    );

    // ---- broker_in_flight fixture (for listBrokerOperations + getFeature) ----
    store.run(
      "INSERT INTO broker_in_flight (op_id, verb, request_id, idempotency_key, payload_json, status) VALUES (?, ?, ?, ?, ?, ?)",
      "op_WIRE1INF001", "merge_pr", "req-w1", "key-w1",
      JSON.stringify({ feature_id: FEAT_ID }), "in_flight",
    );

    // ---- budget_ledger fixture (for getBudget + listBudgets) ----
    store.run(
      "INSERT INTO budget_ledger (task_id, ledger) VALUES (?, ?)",
      TASK_A, BUDGET_LEDGER_A,
    );

    // ---- inbox_items fixture (for getInboxItem) ----
    store.run(
      "INSERT INTO inbox_items (id, kind, status, created_at, evidence) VALUES (?, ?, ?, ?, ?)",
      INBOX_ID, "escalation", "open", 1_000_000,
      JSON.stringify({ task_id: TASK_A }),
    );

    // ---- task_timeline_event fixture (for getTaskTimeline) ----
    appendTimelineEvent(store, {
      task_id: TASK_A,
      attempt: 0,
      correlation_id: "corr-w1",
      kind: "task_start",
      ts: 1_000_000,
    });

    // ---- filesystem fixtures ----
    // Feature dir: STATE.md + JOURNAL.md for getFeature
    const featDir = join(tmpDir, FEAT_ID);
    await mkdir(featDir, { recursive: true });
    await writeFile(join(featDir, "STATE.md"), "# Wire-1 State\nfeature in progress\n");
    await writeFile(join(featDir, "JOURNAL.md"), "# Wire-1 Journal\nfirst entry\n");

    // Feature dir for signOffPlan — minimal dir with only epic.md (no story dirs)
    // → compile() will fail → signOffPlan returns { valid: false, diagnostics: [...] }
    const signOffDir = join(tmpDir, SIGN_OFF_FEAT_ID);
    await mkdir(signOffDir, { recursive: true });
    await writeFile(join(signOffDir, "epic.md"), "# Epic Wire-1 Sign-Off\n");

    // ---- Create server with ALL WIRE-1 deps (design-in-test interface) ----
    // These new opts fields do not yet exist in createStatusServer's TypeScript
    // type; they are passed via a type assertion and silently ignored at runtime
    // (JavaScript drops unknown object properties).  The handlers are NOT
    // registered yet → every call below returns Code.Unimplemented (RED state).
    // The SE reads these opts as the interface contract to implement.
    srv = createStatusServer({
      store,
      port: 0,
      bind: "127.0.0.1",

      // ── read-surfaces deps ─────────────────────────────────────────────
      featureDataRoot: tmpDir,
      nowMs: 1_000_000,
      verbRegistry: VERB_REGISTRY,
      slotRegistry: SLOT_REGISTRY,
      getBudgetCeiling: (_taskId: string) => BUDGET_CEILING,
      daemonVersion: DAEMON_VERSION,
      uptimeFn: () => 99,
      verifyFn: async () => ({ outcome: "pass", reportJson: '{"checks":[]}' }),

      // ── control-verbs deps ─────────────────────────────────────────────
      featureDirFn: (featureId: string) => join(tmpDir, featureId),
      overrideRateLimitFn: (_taskId: string) => ({ allowed: true }),
      overrideDayCapFn: (_taskId: string) => ({ allowed: true }),

      // (no credentials field → dev/test mode; auth not enforced for WIRE-1 tests)
    } as unknown as Parameters<typeof createStatusServer>[0]);

    const addr = await srv.start();
    srvHost = addr.host;
    srvPort = addr.port;
  });

  after(async () => {
    await srv.stop();
    store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ─── listFeatures ────────────────────────────────────────────────────────
  test("listFeatures — handler routes to listFeatures and returns feature summary", async () => {
    const client = makeClient(srvHost, srvPort);
    const res = await client.listFeatures({});
    assert.ok(res.features.length >= 1, "expected at least one FeatureSummary");
    const feat = res.features.find((f) => f.featureId === FEAT_ID);
    assert.ok(feat !== undefined, `expected feature ${FEAT_ID} in response`);
    assert.ok(feat.progressSummary.length > 0, "progressSummary must be non-empty");
  });

  // ─── getFeature ──────────────────────────────────────────────────────────
  test("getFeature — handler routes to getFeature and returns drill-down response", async () => {
    const client = makeClient(srvHost, srvPort);
    const res = await client.getFeature({ featureId: FEAT_ID });
    assert.equal(res.featureId, FEAT_ID, "featureId must match requested id");
    assert.ok(res.stories.length >= 1, "expected at least one story");
    assert.ok(
      res.stateView.includes("Wire-1"),
      "stateView must contain STATE.md content (proves filesystem read)",
    );
  });

  // ─── listBrokerOperations ────────────────────────────────────────────────
  test("listBrokerOperations — handler routes to listBrokerOperations and returns op list", async () => {
    const client = makeClient(srvHost, srvPort);
    const res = await client.listBrokerOperations({});
    assert.ok(res.operations.length >= 1, "expected at least one BrokerOperation");
    const op = res.operations.find((o) => o.opId === "op_WIRE1INF001");
    assert.ok(op !== undefined, "expected op_WIRE1INF001 in operations");
    assert.equal(op.verb, "merge_pr", "op.verb must match fixture");
  });

  // ─── listBrokerVerbs ─────────────────────────────────────────────────────
  test("listBrokerVerbs — handler routes to listBrokerVerbs and returns verb registry", async () => {
    const client = makeClient(srvHost, srvPort);
    const res = await client.listBrokerVerbs({});
    assert.ok(res.verbs.length >= 1, "expected at least one BrokerVerbInfo");
    assert.ok(
      res.verbs.some((v) => v.verb === "merge_pr"),
      "expected merge_pr from injected verbRegistry",
    );
  });

  // ─── listSlots ───────────────────────────────────────────────────────────
  test("listSlots — handler routes to listSlots and returns slot list from slotRegistry", async () => {
    const client = makeClient(srvHost, srvPort);
    const res = await client.listSlots({});
    assert.ok(res.slots.length >= 1, "expected at least one SlotInfo");
    assert.ok(
      res.slots.some((s) => s.name === "slot-alpha"),
      "expected slot-alpha from injected slotRegistry",
    );
  });

  // ─── getBudget ───────────────────────────────────────────────────────────
  test("getBudget — handler routes to getBudget and returns budget for the task", async () => {
    const client = makeClient(srvHost, srvPort);
    const res = await client.getBudget({ taskId: TASK_A });
    assert.equal(res.taskId, TASK_A, "taskId must match requested id");
    assert.equal(res.ceiling, BUDGET_CEILING, "ceiling must come from injected getBudgetCeiling");
    assert.equal(res.breakerState, "closed", "spent(5.0) < ceiling(20.0) → breakerState closed");
  });

  // ─── listBudgets (N4) ────────────────────────────────────────────────────
  test("listBudgets — handler routes to listBudgets and returns all tracked budget rows", async () => {
    const client = makeClient(srvHost, srvPort);
    const res = await client.listBudgets({});
    assert.ok(res.budgets.length >= 1, "expected at least one GetBudgetResponse in budgets");
    const taskBudget = res.budgets.find((b) => b.taskId === TASK_A);
    assert.ok(taskBudget !== undefined, `expected budget row for task ${TASK_A}`);
  });

  // ─── getDaemonStatus ─────────────────────────────────────────────────────
  test("getDaemonStatus — handler routes to getDaemonStatus and returns daemon version + uptime", async () => {
    const client = makeClient(srvHost, srvPort);
    const res = await client.getDaemonStatus({});
    assert.equal(res.version, DAEMON_VERSION, "version must come from injected daemonVersion");
    assert.equal(res.uptimeSeconds, 99n, "uptimeSeconds must come from injected uptimeFn");
    assert.equal(res.lastPing?.present, false, "lastPing.present=false (Epic 029 not active)");
  });

  // ─── getTaskTimeline ─────────────────────────────────────────────────────
  test("getTaskTimeline — handler routes to getTaskTimeline and returns timeline events", async () => {
    const client = makeClient(srvHost, srvPort);
    const res = await client.getTaskTimeline({ taskId: TASK_A, attempt: 0n });
    assert.ok(Array.isArray(res.events), "events must be an array");
    assert.ok(res.events.length >= 1, "expected at least one TimelineEvent");
    const startEvent = res.events.find((e) => e.eventType === "task_start");
    assert.ok(startEvent !== undefined, "expected task_start event in timeline");
  });

  // ─── triggerVerify ───────────────────────────────────────────────────────
  test("triggerVerify — handler routes to triggerVerify and returns verify report", async () => {
    const client = makeClient(srvHost, srvPort);
    const res = await client.triggerVerify({});
    assert.ok(res.report !== undefined, "expected VerifyReport in response");
    assert.equal(res.report?.present, true, "report.present must be true");
    assert.equal(res.report?.outcome, "pass", "report.outcome must come from injected verifyFn");
  });

  // ─── signOffPlan (invalid plan dir → diagnostics returned) ───────────────
  test("signOffPlan — handler routes to signOffPlan (invalid plan returns diagnostics)", async () => {
    const client = makeClient(srvHost, srvPort);
    // Feature dir has only epic.md (no story dirs) → compile fails
    // → signOffPlan catches and returns { valid: false, diagnostics: [...] }
    const res = await client.signOffPlan({
      featureId: SIGN_OFF_FEAT_ID,
      actor: "ulrich",
    });
    assert.equal(res.valid, false, "compile on minimal dir must fail → valid=false");
    assert.ok(res.diagnostics.length > 0, "invalid plan must yield at least one diagnostic");
  });

  // ─── haltTask ────────────────────────────────────────────────────────────
  test("haltTask — handler routes to haltTask and returns a halted status string", async () => {
    const client = makeClient(srvHost, srvPort);
    const res = await client.haltTask({ taskId: HALT_TASK_ID, actor: "ulrich" });
    // Any non-empty status proves the handler ran (Unimplemented would throw, not reach here)
    assert.ok(res.status.length > 0, "status must be a non-empty string (proves handler ran)");
  });

  // ─── haltFeature ─────────────────────────────────────────────────────────
  test("haltFeature — handler routes to haltFeature and returns a halted status string", async () => {
    const client = makeClient(srvHost, srvPort);
    const res = await client.haltFeature({ featureId: HALT_FEAT_ID, actor: "ulrich" });
    assert.ok(res.status.length > 0, "status must be a non-empty string (proves handler ran)");
  });

  // ─── approveReplan — wrong base-generation → non-Unimplemented error ─────
  test("approveReplan — handler routes to approveReplan (wrong baseGeneration → non-Unimplemented error)", async () => {
    const client = makeClient(srvHost, srvPort);
    // baseGeneration: 99n will not match live generation (no plan compiled for FEAT_ID → 0)
    // → GenerationConflictError inside approveReplan → handler maps to a ConnectError
    // RED: handler not registered → Code.Unimplemented
    // GREEN: handler runs → Code is something other than Unimplemented
    let caught: ConnectError | undefined;
    try {
      await client.approveReplan({
        featureId: FEAT_ID,
        baseGeneration: 99n,
        edits: [],
        actor: "ulrich",
      });
    } catch (err) {
      if (err instanceof ConnectError) caught = err;
    }
    assert.ok(caught !== undefined, "expected a ConnectError from approveReplan");
    assert.notEqual(
      caught.code,
      Code.Unimplemented,
      `got Code.Unimplemented — approveReplan handler was not registered in the Connect router`,
    );
  });

  // ─── overrideBudget — first call succeeds → newCeiling > 0 ──────────────
  test("overrideBudget — handler routes to budgetOverride and returns newCeiling", async () => {
    const client = makeClient(srvHost, srvPort);
    // OVERRIDE_TASK_ID has no budget_ledger row → no existing override
    // Both rate-limit + day-cap fns return { allowed: true } → override accepted
    const res = await client.overrideBudget({
      taskId: OVERRIDE_TASK_ID,
      amount: 25.0,
      reason: "wire-1 routing proof",
      actor: "ulrich",
    });
    assert.ok(
      res.newCeiling > 0,
      "newCeiling must be > 0 (proves handler ran and mapped budgetOverride result to proto response)",
    );
  });

  // ─── getInboxItem (N2) ────────────────────────────────────────────────────
  test("getInboxItem — handler routes to getInboxItem and returns the inbox item", async () => {
    const client = makeClient(srvHost, srvPort);
    const res = await client.getInboxItem({ id: INBOX_ID });
    assert.ok(res.item !== undefined, "expected an InboxItem in response");
    assert.equal(res.item?.id, INBOX_ID, "item.id must match the requested id");
    assert.equal(res.item?.kind, "escalation", "item.kind must come from inbox_items row");
  });

  // ────────────────────────────────────────────────────────────────────────
  // D1 — Connect auth interceptor: credentials configured → reject unauthed
  // ────────────────────────────────────────────────────────────────────────

  describe("D1 — with credentials configured, unauthenticated call is rejected", () => {
    let authSrv: StatusServer;
    let authStore: Store;
    let authTmpDir: string;
    let authHost = "";
    let authPort = 0;

    before(async () => {
      authTmpDir = await mkdtemp(join(tmpdir(), "d1-auth-"));
      authStore = openStore(join(authTmpDir, "d1.db"), { busyTimeout: 1000 });
      initSchema(authStore);

      // Credentials configured → auth enforced for ALL Connect calls.
      // D1: unauthenticated calls must be rejected with Code.Unauthenticated.
      authSrv = createStatusServer({
        store: authStore,
        port: 0,
        bind: "127.0.0.1",
        credentials: [{ username: "admin", password: "correcthorsebatterystaple" }],
      } as unknown as Parameters<typeof createStatusServer>[0]);

      const addr = await authSrv.start();
      authHost = addr.host;
      authPort = addr.port;
    });

    after(async () => {
      await authSrv.stop();
      authStore.close();
      await rm(authTmpDir, { recursive: true, force: true });
    });

    test("unauthenticated call is rejected with Code.Unauthenticated when credentials are configured", async () => {
      // Call getStatus (the existing registered handler) without an Authorization header.
      // RED: no auth interceptor → getStatus returns a valid response → test fails on
      //      the assertion that a ConnectError was thrown.
      // GREEN: interceptor intercepts all Connect calls and rejects with Unauthenticated.
      const client = makeClient(authHost, authPort);
      let caught: ConnectError | undefined;
      try {
        await client.getStatus({});
      } catch (err) {
        if (err instanceof ConnectError) caught = err;
      }
      assert.ok(
        caught !== undefined,
        "expected ConnectError but call succeeded — auth interceptor not yet wired",
      );
      assert.equal(
        caught.code,
        Code.Unauthenticated,
        `expected Code.Unauthenticated; got ${caught !== undefined ? caught.code : "no error"}`,
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // D1 — no credentials configured → calls succeed without auth (dev/test)
  // ────────────────────────────────────────────────────────────────────────

  describe("D1 — without credentials configured, calls succeed without auth (dev/test mode)", () => {
    let noCredSrv: StatusServer;
    let noCredStore: Store;
    let noCredTmpDir: string;
    let noCredHost = "";
    let noCredPort = 0;

    before(async () => {
      noCredTmpDir = await mkdtemp(join(tmpdir(), "d1-nocred-"));
      noCredStore = openStore(join(noCredTmpDir, "nocred.db"), { busyTimeout: 1000 });
      initSchema(noCredStore);

      // No credentials → dev/test mode: auth interceptor must be a no-op.
      // This pins the existing behavior and must remain GREEN after the SE adds the interceptor.
      noCredSrv = createStatusServer({
        store: noCredStore,
        port: 0,
        bind: "127.0.0.1",
        // credentials absent → dev/test mode
      });

      const addr = await noCredSrv.start();
      noCredHost = addr.host;
      noCredPort = addr.port;
    });

    after(async () => {
      await noCredSrv.stop();
      noCredStore.close();
      await rm(noCredTmpDir, { recursive: true, force: true });
    });

    test("call without auth header succeeds when no credentials are configured (dev/test mode)", async () => {
      // Characterization test — pins existing behavior.  Must remain green after
      // the SE adds the auth interceptor (no-op when credentials absent).
      const client = makeClient(noCredHost, noCredPort);
      const res = await client.getStatus({});
      assert.ok(res !== undefined, "expected a valid GetStatusResponse with no credentials configured");
    });
  });
});

// ===========================================================================
// WIRE-2 — N1 feature name, N2 InboxItem fields, N3 broker_op_id,
//           N4 ListBudgets multi-task, N5 reconciliation_status
//
// All tests in a fresh server + store so fixture data is isolated from WIRE-1.
// Expected RED reasons on first run (before SE implements):
//   N1: feat.name === "" but assert expects W2_FEAT_ID → FAIL
//   N2: item.featureId === "" → FAIL; item.suggestedCategory === "" → FAIL
//       item.evidence === undefined → FAIL
//   N3: item.brokerOpId === "" → FAIL
//   N4: characterization test — intentional first-run PASS (handler already
//       correctly iterates budget_ledger rows; only golden-fixture data differs)
//   N5: op.reconciliationStatus === "" (hardcoded) → FAIL
// ===========================================================================

describe("src/daemon/control-plane-server.ts — WIRE-2 N1/N2/N3/N4/N5 field population", () => {
  // ── fixture constants ────────────────────────────────────────────────────
  const W2_FEAT_ID = "wire2-feat-001";
  const W2_STORY_ID = `${W2_FEAT_ID}/001-s1`;
  const W2_TASK_A = `${W2_STORY_ID}/001-task-a`;
  const W2_TASK_B = `${W2_STORY_ID}/001-task-b`;

  // Inbox items for N2/N3 tests
  const W2_ESC_ID = "wire2-inbox-esc-001";   // escalation; reason=budget-breach → suggestedCategory=correction
  const W2_DIFF_ID = "wire2-inbox-diff-001"; // diff evidence → structured DiffEvidence
  const W2_TEXT_ID = "wire2-inbox-text-001"; // text evidence → Evidence{type:"text",text}
  const W2_APPR_ID = "wire2-inbox-appr-001"; // approval; evidence.op_id → brokerOpId (N3)

  // Broker op for N5
  const W2_OP_RECON = "op_W2SERVER0001";

  let w2TmpDir = "";
  let w2Store: Store;
  let w2Srv: StatusServer;
  let w2Host = "";
  let w2Port = 0;

  before(async () => {
    w2TmpDir = await mkdtemp(join(tmpdir(), "wire2-"));
    w2Store = openStore(join(w2TmpDir, "wire2.db"), { busyTimeout: 1000 });
    initSchema(w2Store);
    applyCompiledPlanMigration(w2Store);

    // ── plan_node + scheduler_task (needed for featureId lookup from task_id) ──
    w2Store.run(
      "INSERT INTO plan_node (id, kind, feature_id, generation) VALUES (?, ?, ?, ?)",
      W2_FEAT_ID, "epic", W2_FEAT_ID, 1,
    );
    w2Store.run(
      "INSERT INTO plan_node (id, kind, feature_id, generation) VALUES (?, ?, ?, ?)",
      W2_STORY_ID, "story", W2_FEAT_ID, 1,
    );
    w2Store.run(
      "INSERT INTO plan_node (id, kind, feature_id, generation) VALUES (?, ?, ?, ?)",
      W2_TASK_A, "task", W2_FEAT_ID, 1,
    );
    w2Store.run(
      "INSERT INTO plan_node (id, kind, feature_id, generation) VALUES (?, ?, ?, ?)",
      W2_TASK_B, "task", W2_FEAT_ID, 1,
    );
    w2Store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status, exit_gate_passed) VALUES (?, ?, ?, ?)",
      W2_TASK_A, W2_FEAT_ID, "pending", 0,
    );
    w2Store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status, exit_gate_passed) VALUES (?, ?, ?, ?)",
      W2_TASK_B, W2_FEAT_ID, "pending", 0,
    );

    // ── inbox_items fixtures (N2 evidence + N3 broker_op_id) ─────────────────
    // ESC: escalation with reason=budget-breach → type="budget-breach",
    //      suggestedCategory=SIGNAL_MAP["budget-breach"]="correction",
    //      featureId=W2_FEAT_ID (via scheduler_task lookup for W2_TASK_A)
    w2Store.run(
      "INSERT INTO inbox_items (id, kind, status, created_at, evidence) VALUES (?, ?, ?, ?, ?)",
      W2_ESC_ID, "escalation", "open", 2_000_000,
      JSON.stringify({ task_id: W2_TASK_A, reason: "budget-breach" }),
    );
    // DIFF: structured diff evidence (N2 DiffEvidence)
    w2Store.run(
      "INSERT INTO inbox_items (id, kind, status, created_at, evidence) VALUES (?, ?, ?, ?, ?)",
      W2_DIFF_ID, "escalation", "open", 2_000_001,
      JSON.stringify({
        type: "diff", task_id: W2_TASK_A, reason: "diff-review",
        files: [{ path: "src/foo.ts", lines: [{ kind: "add", content: "+const x = 1;" }] }],
      }),
    );
    // TEXT: text evidence (N2 Evidence{type:"text",text})
    w2Store.run(
      "INSERT INTO inbox_items (id, kind, status, created_at, evidence) VALUES (?, ?, ?, ?, ?)",
      W2_TEXT_ID, "escalation", "open", 2_000_002,
      JSON.stringify({ type: "text", text: "scope violation detected", task_id: W2_TASK_A, reason: "scope-violation" }),
    );
    // APPR: approval with op_id → brokerOpId (N3)
    w2Store.run(
      "INSERT INTO inbox_items (id, kind, status, created_at, evidence) VALUES (?, ?, ?, ?, ?)",
      W2_APPR_ID, "approval", "open", 2_000_003,
      JSON.stringify({ op_id: "op_W2APPR001", task_id: W2_TASK_A }),
    );

    // ── budget_ledger (N4 — 2 tasks) ─────────────────────────────────────────
    w2Store.run(
      "INSERT INTO budget_ledger (task_id, ledger) VALUES (?, ?)",
      W2_TASK_A,
      JSON.stringify([{ kind: "reservation", reservationId: "r1", conservativeCharge: 5.0 }]),
    );
    w2Store.run(
      "INSERT INTO budget_ledger (task_id, ledger) VALUES (?, ?)",
      W2_TASK_B,
      JSON.stringify([{ kind: "reservation", reservationId: "r2", conservativeCharge: 12.0 }]),
    );

    // ── broker_in_flight (N5 — needs_reconciliation status) ──────────────────
    w2Store.run(
      "INSERT INTO broker_in_flight (op_id, verb, request_id, idempotency_key, payload_json, status) VALUES (?, ?, ?, ?, ?, ?)",
      W2_OP_RECON, "merge_pr", "req-w2srv", "key-w2srv", null, "needs_reconciliation",
    );

    // ── filesystem fixtures (getFeature STATE.md / JOURNAL.md) ───────────────
    const featDir = join(w2TmpDir, W2_FEAT_ID);
    await mkdir(featDir, { recursive: true });
    await writeFile(join(featDir, "STATE.md"), "# Wire-2 State\n");
    await writeFile(join(featDir, "JOURNAL.md"), "# Wire-2 Journal\n");

    // ── start server ─────────────────────────────────────────────────────────
    w2Srv = createStatusServer({
      store: w2Store,
      port: 0,
      bind: "127.0.0.1",
      featureDataRoot: w2TmpDir,
      nowMs: 2_000_000,
      verbRegistry: [{ verb: "merge_pr", tier: "approval-required" }],
      slotRegistry: [],
      getBudgetCeiling: () => 20.0,
      daemonVersion: "wire2-test-0.1.0",
      uptimeFn: () => 42,
      verifyFn: async () => ({ outcome: "pass", reportJson: "{}" }),
    } as unknown as Parameters<typeof createStatusServer>[0]);

    const addr = await w2Srv.start();
    w2Host = addr.host;
    w2Port = addr.port;
  });

  after(async () => {
    await w2Srv.stop();
    w2Store.close();
    await rm(w2TmpDir, { recursive: true, force: true });
  });

  // ── N1 — FeatureSummary.name ────────────────────────────────────────────

  test("listFeatures — N1: feature name is feature_id as fallback (not empty string)", async () => {
    const client = makeClient(w2Host, w2Port);
    const res = await client.listFeatures({});
    const feat = res.features.find((f) => f.featureId === W2_FEAT_ID);
    assert.ok(feat !== undefined, `expected ${W2_FEAT_ID} in listFeatures response`);
    // N1: currently the handler hardcodes name:"" → assert(""===W2_FEAT_ID) fails (RED).
    // After SE populates name from plan_node.slug ?? feature_id, this passes.
    assert.equal(
      feat.name,
      W2_FEAT_ID,
      "N1: name must be feature_id as fallback when no display name stored (currently '' → RED)",
    );
  });

  // ── N2 — listInboxItems full population ─────────────────────────────────

  test("listInboxItems — N2: escalation item has featureId populated from scheduler_task lookup", async () => {
    const client = makeClient(w2Host, w2Port);
    const res = await client.listInboxItems({});
    const item = res.items.find((i) => i.id === W2_ESC_ID);
    assert.ok(item !== undefined, `expected ${W2_ESC_ID} in listInboxItems response`);
    // N2: currently featureId:"" hardcoded → assert(""===W2_FEAT_ID) fails (RED).
    // After SE looks up scheduler_task WHERE node_id=evidence.task_id → feature_id,
    // this passes.
    assert.equal(
      item.featureId,
      W2_FEAT_ID,
      "N2: featureId must come from scheduler_task lookup via evidence.task_id (currently '' → RED)",
    );
  });

  test("listInboxItems — N2: escalation item has suggestedCategory from SIGNAL_MAP on evidence.reason", async () => {
    const client = makeClient(w2Host, w2Port);
    const res = await client.listInboxItems({});
    const item = res.items.find((i) => i.id === W2_ESC_ID);
    assert.ok(item !== undefined, `expected ${W2_ESC_ID} in listInboxItems response`);
    // N2: SIGNAL_MAP["budget-breach"] === "correction".
    // Currently suggestedCategory:"" hardcoded → FAIL (RED).
    assert.equal(
      item.suggestedCategory,
      "correction",
      "N2: suggestedCategory must be SIGNAL_MAP['budget-breach']='correction' (currently '' → RED)",
    );
  });

  // ── N2 — getInboxItem full population (featureId + evidence) ────────────

  test("getInboxItem — N2: item has featureId populated from task_id in evidence", async () => {
    const client = makeClient(w2Host, w2Port);
    const res = await client.getInboxItem({ id: W2_ESC_ID });
    assert.ok(res.item !== undefined, "expected item in getInboxItem response");
    // N2: currently featureId:"" hardcoded → FAIL (RED).
    assert.equal(
      res.item.featureId,
      W2_FEAT_ID,
      "N2: featureId must come from scheduler_task lookup via evidence.task_id (currently '' → RED)",
    );
  });

  test("getInboxItem — N2: diff evidence produces structured DiffEvidence with file path and line kind", async () => {
    const client = makeClient(w2Host, w2Port);
    const res = await client.getInboxItem({ id: W2_DIFF_ID });
    assert.ok(res.item !== undefined, "expected item in getInboxItem response");
    // N2: currently evidence is not set in the response (handler omits it) →
    // evidence is undefined → first assertion fails (RED).
    const ev = res.item.evidence;
    assert.ok(
      ev !== undefined,
      "N2: evidence field must be present for diff-type inbox item (currently absent → RED)",
    );
    assert.equal(ev.type, "diff", "N2: evidence.type must be 'diff'");
    assert.ok(ev.diff !== undefined, "N2: evidence.diff must be present");
    const file = ev.diff?.files[0];
    assert.ok(file !== undefined, "N2: evidence.diff.files[0] must be present");
    assert.equal(file.path, "src/foo.ts", "N2: file path must match fixture");
    const line = file.lines[0];
    assert.ok(line !== undefined, "N2: evidence.diff.files[0].lines[0] must be present");
    assert.equal(line.kind, "add", "N2: line.kind must be 'add'");
    assert.equal(line.content, "+const x = 1;", "N2: line.content must match fixture");
  });

  test("getInboxItem — N2: text evidence produces Evidence{type:'text', text}", async () => {
    const client = makeClient(w2Host, w2Port);
    const res = await client.getInboxItem({ id: W2_TEXT_ID });
    assert.ok(res.item !== undefined, "expected item in getInboxItem response");
    // N2: currently evidence is not set → undefined → first assertion fails (RED).
    const ev = res.item.evidence;
    assert.ok(
      ev !== undefined,
      "N2: evidence field must be present for text-type inbox item (currently absent → RED)",
    );
    assert.equal(ev.type, "text", "N2: evidence.type must be 'text'");
    assert.equal(ev.text, "scope violation detected", "N2: evidence.text must match fixture");
  });

  // ── N3 — InboxItem.broker_op_id for approval items ──────────────────────

  test("getInboxItem — N3: approval item has brokerOpId from evidence.op_id", async () => {
    const client = makeClient(w2Host, w2Port);
    const res = await client.getInboxItem({ id: W2_APPR_ID });
    assert.ok(res.item !== undefined, "expected approval item in getInboxItem response");
    // N3: currently brokerOpId:"" hardcoded → assert(""==="op_W2APPR001") fails (RED).
    assert.equal(
      res.item.brokerOpId,
      "op_W2APPR001",
      "N3: brokerOpId must come from evidence.op_id for approval items (currently '' → RED)",
    );
  });

  // ── N4 — ListBudgets multi-task (characterization — intentional first-run PASS) ──
  //
  // The listBudgets handler already correctly iterates all budget_ledger rows and
  // calls getBudget per task.  This golden-fixture test proves the multi-task
  // behavior with 2 distinct tasks and asserts correct field values.  It is an
  // intentional first-run pass — sensitivity is proven by the fixture data: if the
  // handler did NOT query both rows, res.budgets.length would not equal 2.

  test("listBudgets — N4: 2 distinct task_ids in budget_ledger yield 2 budget rows with correct spent amounts", async () => {
    const client = makeClient(w2Host, w2Port);
    const res = await client.listBudgets({});
    // Fresh store: only W2_TASK_A and W2_TASK_B are in budget_ledger.
    assert.equal(res.budgets.length, 2,
      "N4: exactly 2 budget rows for the 2 task_ids inserted in budget_ledger");
    const budgetA = res.budgets.find((b) => b.taskId === W2_TASK_A);
    const budgetB = res.budgets.find((b) => b.taskId === W2_TASK_B);
    assert.ok(budgetA !== undefined, `N4: budget for ${W2_TASK_A} must be present`);
    assert.ok(budgetB !== undefined, `N4: budget for ${W2_TASK_B} must be present`);
    assert.equal(budgetA.spent, 5.0, "N4: TASK_A spent must be 5.0 from its ledger reservation");
    assert.equal(budgetB.spent, 12.0, "N4: TASK_B spent must be 12.0 from its ledger reservation");
    assert.equal(budgetA.ceiling, 20.0, "N4: TASK_A ceiling from getBudgetCeiling");
    assert.equal(budgetB.ceiling, 20.0, "N4: TASK_B ceiling from getBudgetCeiling");
    assert.equal(budgetA.breakerState, "closed", "N4: TASK_A spent(5.0) < ceiling(20.0) → closed");
    assert.equal(budgetB.breakerState, "closed", "N4: TASK_B spent(12.0) < ceiling(20.0) → closed");
  });

  // ── N5 — BrokerOperation.reconciliation_status ──────────────────────────

  test("listBrokerOperations — N5: op with needs_reconciliation status has reconciliationStatus field populated", async () => {
    const client = makeClient(w2Host, w2Port);
    const res = await client.listBrokerOperations({});
    const op = res.operations.find((o) => o.opId === W2_OP_RECON);
    assert.ok(op !== undefined, `expected ${W2_OP_RECON} in listBrokerOperations response`);
    // N5: currently hardcoded reconciliationStatus:"" → assert(""==="needs_reconciliation")
    // fails (RED).  After SE reads broker_in_flight.status and surfaces it as
    // reconciliationStatus when status is reconciliation-related, this passes.
    assert.equal(
      op.reconciliationStatus,
      "needs_reconciliation",
      "N5: reconciliationStatus must be 'needs_reconciliation' when op.status carries that value (currently '' → RED)",
    );
  });
});

// ===========================================================================
// ES2+ES4 regression — getInboxItem error paths (reviewer auto-fix cycle 2026-07-15)
//
// ES2: a getInboxItem call whose evidence column is MALFORMED JSON must still
//      return the item (best-effort) without throwing. Pins the never-swallow
//      behavior per AGENTS.md; the SE will add a global-log fallback so the
//      error is always logged even when opts.logger is absent.
//
// ES4: a getInboxItem call for a nonexistent id must return ConnectError with
//      Code.NotFound (code-correct path, previously untested — coverage lock).
// ===========================================================================

describe("src/daemon/control-plane-server.ts — getInboxItem error-path regressions (ES2/ES4)", () => {
  const MALFORMED_INBOX_ID = "regression-inbox-malformed-es2";

  let esTmpDir = "";
  let esStore: Store;
  let esSrv: StatusServer;
  let esHost = "";
  let esPort = 0;

  before(async () => {
    esTmpDir = await mkdtemp(join(tmpdir(), "es2es4-"));
    esStore = openStore(join(esTmpDir, "es2es4.db"), { busyTimeout: 1000 });
    initSchema(esStore);

    // ES2 fixture: inbox item with intentionally malformed JSON in the evidence column.
    esStore.run(
      "INSERT INTO inbox_items (id, kind, status, created_at, evidence) VALUES (?, ?, ?, ?, ?)",
      MALFORMED_INBOX_ID, "escalation", "open", 4_000_000,
      "MALFORMED-JSON{{{not-valid",
    );

    // Server created WITHOUT opts.logger so opts.logger is undefined.
    // Current code: catch calls opts.logger?.info(...) which silently drops the
    // error when logger is absent (AGENTS.md never-swallow violation).
    // The SE fix will add a global-log fallback; the observable behaviour locked
    // here is that the item is returned without throwing regardless.
    esSrv = createStatusServer({
      store: esStore,
      port: 0,
      bind: "127.0.0.1",
      // No logger: opts.logger = undefined — exercises the silent-drop path.
    });

    const addr = await esSrv.start();
    esHost = addr.host;
    esPort = addr.port;
  });

  after(async () => {
    await esSrv.stop();
    esStore.close();
    await rm(esTmpDir, { recursive: true, force: true });
  });

  // ES2 — malformed evidence JSON: item returned without throwing, evidence absent.
  // NOTE: the current code already handles this correctly (JSON.parse throws, the
  // catch block silently continues, evidenceData defaults to {}). This test is a
  // regression lock — it pins the no-throw, best-effort behaviour so future
  // refactors (including the SE's global-log fallback) cannot accidentally surface
  // the parse error to the caller. Expected first-run result: PASS.
  test("getInboxItem — ES2: malformed evidence JSON returns item without throwing (evidence absent, best-effort)", async () => {
    const client = makeClient(esHost, esPort);
    // Must not throw; the item from the DB row must be returned.
    const res = await client.getInboxItem({ id: MALFORMED_INBOX_ID });
    assert.ok(
      res.item !== undefined,
      "ES2: item must be returned even when evidence JSON is malformed",
    );
    assert.equal(res.item?.id, MALFORMED_INBOX_ID, "ES2: item.id must match the requested id");
    assert.equal(res.item?.kind, "escalation", "ES2: item.kind must come from the DB row");
    // Evidence defaults to absent when JSON parse fails (evidenceData={} → evType="" → no branch taken).
    assert.equal(
      res.item?.evidence,
      undefined,
      "ES2: evidence must be absent when evidence JSON parse fails (best-effort default)",
    );
  });

  // ES4 — nonexistent id: ConnectError(Code.NotFound).
  // NOTE: the handler already throws ConnectError(Code.NotFound) when the row is
  // absent — this is a coverage-closing test for that code-correct but previously
  // untested path. Expected first-run result: PASS.
  test("getInboxItem — ES4: nonexistent id returns ConnectError with Code.NotFound", async () => {
    const client = makeClient(esHost, esPort);
    let caught: ConnectError | undefined;
    try {
      await client.getInboxItem({ id: "nonexistent-id-es4-regression" });
    } catch (err) {
      if (err instanceof ConnectError) caught = err;
    }
    assert.ok(
      caught !== undefined,
      "ES4: expected ConnectError for a nonexistent inbox item id",
    );
    assert.equal(
      caught?.code,
      Code.NotFound,
      `ES4: expected Code.NotFound; got ${caught !== undefined ? caught.code : "no error thrown"}`,
    );
  });
});

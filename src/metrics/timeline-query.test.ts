import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { initSchema } from "../store/schema.ts";
import { appendTimelineEvent, readTimelineEvents } from "./task-timeline.ts";
import { appendModelCallRecord } from "./model-call-log.ts";
import { queryTaskTimeline, type EnrichedTimelineEvent } from "./timeline-query.ts";

// ---------------------------------------------------------------------------
// Suite: src/metrics/timeline-query
//
// Story 005 T1 (Epic 019.5) — queryTaskTimeline enriched join
// ---------------------------------------------------------------------------

describe("Story 005 T1 (Epic 019.5) — queryTaskTimeline enriched join", () => {
  let tmpDir = "";
  let store: Store;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-tq-"));
    store = openStore(join(tmpDir, "timeline-query.db"), { busyTimeout: 1000 });
    initSchema(store);
  });

  after(async () => {
    store.close();
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  test("T1: ordered timeline includes all events in event_id-descending order (newest-first) with observed_failure_signal", () => {
    const task_id = "task-tq-s005t1-a";
    const correlation_id = `${task_id}:1`;

    appendTimelineEvent(store, {
      task_id,
      attempt: 1,
      correlation_id,
      kind: "spawn",
      ts: 1000,
      summary: "session spawned",
    });
    appendTimelineEvent(store, {
      task_id,
      attempt: 1,
      correlation_id,
      kind: "gate_failed",
      ts: 2000,
      observed_failure_signal: "gate_failed",
      summary: "gate check failed",
    });
    appendTimelineEvent(store, {
      task_id,
      attempt: 1,
      correlation_id,
      kind: "budget_breach",
      ts: 3000,
      observed_failure_signal: "budget_breach",
      summary: "budget halted",
    });

    const events = queryTaskTimeline(store, task_id);
    assert.ok(events.length >= 3, "must return at least 3 events");

    // event_id DESC default (newest-first): budget_breach, gate_failed, spawn
    const relevant = events.filter((e) => e.task_id === task_id && e.attempt === 1);
    assert.equal(relevant[0]?.kind, "budget_breach");
    assert.equal(relevant[0]?.observed_failure_signal, "budget_breach");
    assert.equal(relevant[1]?.kind, "gate_failed");
    assert.equal(relevant[1]?.observed_failure_signal, "gate_failed");
    assert.equal(relevant[2]?.kind, "spawn");
  });

  test("T1: model_call events enriched with account_id and model from per-call record", () => {
    const task_id = "task-tq-s005t1-b";
    const correlation_id = `${task_id}:1`;

    appendModelCallRecord(store, {
      task_id,
      attempt: 1,
      session_id: "sess-b1",
      account_id: "acct-123",
      model: "claude-3-5-haiku",
      tokens_in: 100,
      tokens_out: 50,
      cost: 0.001,
      latency_ms: 300,
      stop_reason: "end_turn",
      correlation_id,
    });

    const events = queryTaskTimeline(store, task_id);
    const modelCallEvent = events.find(
      (e) => e.kind === "model_call" && e.task_id === task_id,
    );

    assert.ok(
      modelCallEvent !== undefined,
      "must include a model_call timeline event",
    );
    assert.equal(
      modelCallEvent.account_id,
      "acct-123",
      "model_call event must be enriched with account_id from model_call_log",
    );
    assert.equal(
      modelCallEvent.model,
      "claude-3-5-haiku",
      "model_call event must be enriched with model from model_call_log",
    );
  });

  test("T1: non-model-call events have account_id and model unset", () => {
    const task_id = "task-tq-s005t1-c";
    const correlation_id = `${task_id}:1`;

    appendTimelineEvent(store, {
      task_id,
      attempt: 1,
      correlation_id,
      kind: "gate_failed",
      ts: 5000,
      observed_failure_signal: "gate_failed",
      summary: "gate check failed",
    });

    const events = queryTaskTimeline(store, task_id);
    const gateEvent = events.find(
      (e) => e.kind === "gate_failed" && e.task_id === task_id,
    );

    assert.ok(gateEvent !== undefined, "must include the gate_failed event");
    assert.ok(
      gateEvent.account_id === undefined || gateEvent.account_id === null,
      "non-model-call event must not have account_id set",
    );
    assert.ok(
      gateEvent.model === undefined || gateEvent.model === null,
      "non-model-call event must not have model set",
    );
  });

  test("T1: failuresOnly filter returns only signal-bearing events with account_id+model on model-call failures", () => {
    const task_id = "task-tq-s005t1-d";
    const correlation_id = `${task_id}:1`;

    // non-failure event
    appendTimelineEvent(store, {
      task_id,
      attempt: 1,
      correlation_id,
      kind: "spawn",
      ts: 6000,
      summary: "session spawned",
    });
    // signal-bearing non-model-call event
    appendTimelineEvent(store, {
      task_id,
      attempt: 1,
      correlation_id,
      kind: "broker_failed",
      ts: 7000,
      observed_failure_signal: "broker_failed",
      summary: "broker op failed",
    });
    // signal-bearing model_call failure — enriched with account_id + model
    appendModelCallRecord(store, {
      task_id,
      attempt: 1,
      session_id: "sess-d1",
      account_id: "acct-456",
      model: "gpt-4o-mini",
      tokens_in: 200,
      tokens_out: 80,
      cost: 0.002,
      latency_ms: 500,
      stop_reason: "rate_limit",
      typed_error: "rate_limited",
      correlation_id,
    });
    // manually append an observed_failure_signal to the model_call timeline row
    // (since appendModelCallRecord does not set observed_failure_signal itself, we
    // use a second timeline event to represent the rate-limit failure signal on the same task)
    appendTimelineEvent(store, {
      task_id,
      attempt: 1,
      correlation_id,
      kind: "model_call",
      ts: 8001,
      observed_failure_signal: "rate_limited",
      summary: "rate_limited on model call",
      session_id: "sess-d1",
    });

    // all events
    const all = queryTaskTimeline(store, task_id);
    assert.ok(all.length >= 4, "must return at least 4 events");

    // failures only
    const failures = queryTaskTimeline(store, task_id, { failuresOnly: true });
    const failKinds = failures.map((e: EnrichedTimelineEvent) => e.kind);
    assert.ok(
      !failKinds.includes("spawn"),
      "spawn (no signal) must be excluded by failuresOnly filter",
    );
    assert.ok(
      failures.every((e: EnrichedTimelineEvent) => typeof e.observed_failure_signal === "string"),
      "every event in failuresOnly result must carry observed_failure_signal",
    );
  });

  test("T1: two attempts on different accounts attribute to the correct account_id in the timeline", () => {
    const task_id = "task-tq-s005t1-e";

    appendModelCallRecord(store, {
      task_id,
      attempt: 1,
      session_id: "sess-e1",
      account_id: "acct-A",
      model: "claude-3-5-haiku",
      tokens_in: 50,
      tokens_out: 20,
      cost: 0.0005,
      latency_ms: 100,
      stop_reason: "end_turn",
      correlation_id: `${task_id}:1`,
    });
    appendModelCallRecord(store, {
      task_id,
      attempt: 2,
      session_id: "sess-e2",
      account_id: "acct-B",
      model: "gpt-4o",
      tokens_in: 60,
      tokens_out: 30,
      cost: 0.0008,
      latency_ms: 150,
      stop_reason: "end_turn",
      correlation_id: `${task_id}:2`,
    });

    const events = queryTaskTimeline(store, task_id);
    const a1 = events.filter(
      (e) => e.attempt === 1 && e.kind === "model_call" && e.task_id === task_id,
    );
    const a2 = events.filter(
      (e) => e.attempt === 2 && e.kind === "model_call" && e.task_id === task_id,
    );

    assert.ok(a1.length >= 1, "attempt 1 must have at least one model_call event");
    assert.ok(a2.length >= 1, "attempt 2 must have at least one model_call event");
    assert.equal(a1[0]?.account_id, "acct-A", "attempt 1 model_call must attribute to acct-A");
    assert.equal(a2[0]?.account_id, "acct-B", "attempt 2 model_call must attribute to acct-B");
  });
});

// ---------------------------------------------------------------------------
// BLOCKER S6 regression (Epic 019.5) — fragile ts-join in queryTaskTimeline
//
// The LEFT JOIN in timeline-query.ts joins task_timeline_event to model_call_log
// on te.ts = mcl.ts. Two model calls in the same millisecond (same ts) collide:
// the join produces a cartesian product (4 rows) or NULL account_id.
//
// Fix: add a call_id column to task_timeline_event; appendModelCallRecord passes
// its generated call_id into the appendTimelineEvent call for kind="model_call";
// change the join to ON te.call_id = mcl.call_id.
//
// RED signal: each timeline model_call event must carry a call_id linking to
// exactly one model_call_log row. This fails now (task_timeline_event has no
// call_id column → ev.call_id is absent/undefined).
// ---------------------------------------------------------------------------

describe("BLOCKER S6 (Epic 019.5) — fragile ts-join: each model_call timeline event must carry call_id", () => {
  let s6Dir = "";
  let s6Store: Store;

  before(async () => {
    s6Dir = await mkdtemp(join(tmpdir(), "kanthord-tq-s6-"));
    s6Store = openStore(join(s6Dir, "s6.db"), { busyTimeout: 1000 });
    initSchema(s6Store);
  });

  after(async () => {
    s6Store.close();
    if (s6Dir) await rm(s6Dir, { recursive: true, force: true });
  });

  test("S6: two model calls in one attempt must each be attributed to their OWN account_id/model with no duplication — each timeline model_call event carries a call_id", () => {
    const task_id = "task-s6-callid";
    const correlation_id = `${task_id}:1`;

    // Insert two model calls synchronously — high likelihood of same Date.now()
    // (same ms), which triggers the cartesian JOIN collision in the current code.
    appendModelCallRecord(s6Store, {
      task_id,
      attempt: 1,
      session_id: "sess-s6-1",
      account_id: "acct-s6-A",
      model: "gpt-A",
      tokens_in: 100,
      tokens_out: 50,
      cost: 0.001,
      latency_ms: 200,
      stop_reason: "end_turn",
      correlation_id,
    });
    appendModelCallRecord(s6Store, {
      task_id,
      attempt: 1,
      session_id: "sess-s6-1",
      account_id: "acct-s6-B",
      model: "gpt-B",
      tokens_in: 120,
      tokens_out: 60,
      cost: 0.002,
      latency_ms: 250,
      stop_reason: "end_turn",
      correlation_id,
    });

    const events = queryTaskTimeline(s6Store, task_id);
    const modelCallEvents = events.filter(
      (e) => e.kind === "model_call" && e.task_id === task_id,
    );

    // Primary RED assertion: each model_call timeline event must carry a call_id
    // that uniquely identifies the model_call_log row it corresponds to.
    // Fails NOW because task_timeline_event has no call_id column — ev.call_id is undefined.
    for (const ev of modelCallEvents) {
      const callId = (ev as Record<string, unknown>)["call_id"];
      assert.ok(
        typeof callId === "string" && callId.length > 0,
        `S6: each model_call timeline event must carry a non-empty call_id linking to one model_call_log row; got call_id=${JSON.stringify(callId)} — task_timeline_event currently has no call_id column`,
      );
    }

    // Deduplication: exactly 2 model_call events (no cartesian product duplication)
    assert.equal(
      modelCallEvents.length,
      2,
      `S6: must have exactly 2 model_call timeline events (one per appendModelCallRecord call); got ${modelCallEvents.length} — ts-join collision may cause cartesian product`,
    );

    // Attribution: each event attributed to its OWN account_id/model
    const accountIds = modelCallEvents.map((e) => e.account_id);
    assert.ok(
      accountIds.includes("acct-s6-A"),
      "S6: one model_call event must be attributed to acct-s6-A",
    );
    assert.ok(
      accountIds.includes("acct-s6-B"),
      "S6: one model_call event must be attributed to acct-s6-B",
    );
  });
});

// ---------------------------------------------------------------------------
// BLOCKER S2 regression (Epic 019.5) — queryTaskTimeline (timeline-query) must NOT self-migrate
// ---------------------------------------------------------------------------

describe("BLOCKER S2 regression (Epic 019.5) — queryTaskTimeline (timeline-query) must not self-migrate", () => {
  test("BLOCKER S2: queryTaskTimeline throws 'no such table' on uninitialised store", async () => {
    // queryTaskTimeline currently calls initTaskTimelineSchema + initModelCallLogSchema
    // before querying (self-migration). On an uninitialised store it therefore
    // succeeds with an empty result instead of throwing. After the fix it must throw.
    const noSchemaDir = await mkdtemp(join(tmpdir(), "kanthord-tq-s2-"));
    const noSchemaStore = openStore(join(noSchemaDir, "no-schema.db"), { busyTimeout: 1000 });
    try {
      assert.throws(
        () => queryTaskTimeline(noSchemaStore, "task-s2-probe"),
        /no such table/,
        "queryTaskTimeline must not self-migrate; must throw on uninitialised store",
      );
    } finally {
      noSchemaStore.close();
      await rm(noSchemaDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// BLOCKER TQ1/TQ2/TQ3 (Epic 019.5) — queryTaskTimeline paging and no-join
//
// Current code: LEFT JOIN to model_call_log, ORDER BY ts ASC, no LIMIT, no
// before-cursor support. All three tests below fail against the current impl.
// After the redesign (single-table scan + DESC default + LIMIT + before cursor),
// all three must pass.
// ---------------------------------------------------------------------------

describe("BLOCKER TQ1/TQ2/TQ3 (Epic 019.5) — queryTaskTimeline paging and no-join redesign", () => {
  let pDir = "";
  let pStore: Store;

  before(async () => {
    pDir = await mkdtemp(join(tmpdir(), "kanthord-tq-paging-"));
    pStore = openStore(join(pDir, "paging.db"), { busyTimeout: 1000 });
    initSchema(pStore);
  });

  after(async () => {
    pStore.close();
    if (pDir) await rm(pDir, { recursive: true, force: true });
  });

  test("TQ1: default order is DESC — newest event_id returned first", () => {
    const task_id = "task-tq1-desc-order";
    const correlation_id = `${task_id}:1`;
    appendTimelineEvent(pStore, { task_id, attempt: 1, correlation_id, kind: "spawn", ts: 30001 });
    appendTimelineEvent(pStore, { task_id, attempt: 1, correlation_id, kind: "gate_failed", ts: 30002, observed_failure_signal: "gate_failed" });

    const events = queryTaskTimeline(pStore, task_id);
    const relevant = events.filter((e) => e.task_id === task_id);
    assert.ok(relevant.length >= 2, "must return at least 2 events for the task");
    // DESC default: gate_failed (higher event_id) must be first; current code returns ts ASC so spawn is first → FAILS
    assert.equal(
      relevant[0]?.kind,
      "gate_failed",
      "TQ1: default DESC order — newest event (gate_failed) must be first; current code returns ts ASC so spawn comes first",
    );
  });

  test("TQ1: limit option caps the returned page size", () => {
    const task_id = "task-tq1-limit-cap";
    const correlation_id = `${task_id}:1`;
    for (let i = 0; i < 5; i++) {
      appendTimelineEvent(pStore, { task_id, attempt: 1, correlation_id, kind: "spawn", ts: 40000 + i });
    }
    const events = queryTaskTimeline(pStore, task_id, { limit: 3 });
    // current code has no LIMIT → returns all 5 → FAILS
    assert.equal(events.length, 3, "TQ1: limit:3 must return exactly 3 events; current code ignores limit");
  });

  test("TQ1: before cursor returns next page — events strictly beyond cursor in sort order", () => {
    const task_id = "task-tq1-before-cursor";
    const correlation_id = `${task_id}:1`;
    // Insert 4 events sequentially; monotonicFactory ULID guarantees ascending event_id
    for (let i = 0; i < 4; i++) {
      appendTimelineEvent(pStore, { task_id, attempt: 1, correlation_id, kind: "spawn", ts: 50000 + i });
    }
    // readTimelineEvents returns ts ASC, which matches insertion (ULID monotonic) order
    const allAsc = readTimelineEvents(pStore, task_id);
    assert.equal(allAsc.length, 4, "setup: must have exactly 4 events for cursor test");

    // cursor = 3rd event (index 2); in DESC page2 must contain only events[0] and events[1]
    const cursor = allAsc[2]!.event_id;
    const page2 = queryTaskTimeline(pStore, task_id, { before: cursor, limit: 10 });
    // current code ignores `before` → returns all 4 including events with event_id >= cursor → FAILS
    assert.ok(
      page2.every((e) => e.event_id < cursor),
      "TQ1: before cursor — all returned events must have event_id < cursor; current code ignores before so events with id >= cursor are included",
    );
    assert.ok(page2.length > 0, "page before cursor must be non-empty (2 older events exist)");
    assert.ok(page2.length < 3, "page before cursor must exclude cursor and newer events (max 2 older)");
  });
});

// ---------------------------------------------------------------------------
// BLOCKER TQ-S1 (Epic 019.5) — no-join structural guard
//
// queryTaskTimeline must issue NO SQL JOIN in its primary scan.
// Model-call enrichment must be a separate second .all() call targeting
// model_call_log. A spy Store wraps the real store and records sql strings;
// this pins the two-query design so any reintroduction of a JOIN is caught.
// ---------------------------------------------------------------------------

describe("BLOCKER TQ-S1 (Epic 019.5) — no-join structural guard: primary scan contains no JOIN, enrichment is a separate second query", () => {
  let s1Dir = "";
  let s1Store: Store;

  before(async () => {
    s1Dir = await mkdtemp(join(tmpdir(), "kanthord-tq-s1-"));
    s1Store = openStore(join(s1Dir, "s1.db"), { busyTimeout: 1000 });
    initSchema(s1Store);
  });

  after(async () => {
    s1Store.close();
    if (s1Dir) await rm(s1Dir, { recursive: true, force: true });
  });

  test("TQ-S1: primary scan query contains no JOIN and model_call enrichment is a separate second .all query targeting model_call_log", () => {
    const task_id = "task-tq-s1-nojoin";
    const correlation_id = `${task_id}:1`;

    // Seed a model_call record so there is a call_id on the page,
    // which triggers the second enrichment query in queryTaskTimeline.
    appendModelCallRecord(s1Store, {
      task_id,
      attempt: 1,
      session_id: "sess-s1-nojoin",
      account_id: "acct-s1",
      model: "claude-3-5-haiku",
      tokens_in: 50,
      tokens_out: 20,
      cost: 0.001,
      latency_ms: 100,
      stop_reason: "end_turn",
      correlation_id,
    });

    // Spy Store: delegates all calls to the real store but records sql strings
    // passed to .all() so we can inspect the queries queryTaskTimeline issues.
    const capturedSql: string[] = [];
    const spyStore: Store = {
      get: <T>(sql: string, ...params: unknown[]): T | undefined =>
        s1Store.get<T>(sql, ...params),
      run: (sql: string, ...params: unknown[]): void =>
        s1Store.run(sql, ...params),
      all: <T>(sql: string, ...params: unknown[]): T[] => {
        capturedSql.push(sql);
        return s1Store.all<T>(sql, ...params);
      },
      close: (): void => {},
    };

    queryTaskTimeline(spyStore, task_id);

    // Must have at least 2 store.all calls: primary scan + model_call enrichment
    assert.ok(
      capturedSql.length >= 2,
      `TQ-S1: expected at least 2 store.all calls (primary scan + model_call_log enrichment); got ${capturedSql.length}`,
    );

    // (a) Primary scan must contain no JOIN keyword (case-insensitive)
    const primarySql = capturedSql[0];
    assert.ok(
      typeof primarySql === "string" && !/join/i.test(primarySql),
      `TQ-S1: primary scan query must contain no JOIN keyword (case-insensitive); got: ${primarySql ?? "<undefined>"}`,
    );

    // (b) Second .all call must target model_call_log (the enrichment query)
    const enrichSql = capturedSql[1];
    assert.ok(
      typeof enrichSql === "string" && /model_call_log/i.test(enrichSql),
      `TQ-S1: second store.all query must SELECT from model_call_log for enrichment; got: ${enrichSql ?? "<undefined>"}`,
    );
  });
});

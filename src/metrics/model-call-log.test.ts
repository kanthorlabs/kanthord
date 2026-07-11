import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { initSchema } from "../store/schema.ts";
import {
  appendModelCallRecord,
  initModelCallLogSchema,
  queryModelCallLog,
  type ModelCallRecord,
} from "./model-call-log.ts";
import { readTimelineEvents } from "./task-timeline.ts";

// ---------------------------------------------------------------------------
// Suite: src/metrics/model-call-log
//
// Story 003 T1 (Epic 019.5) — per-model-call record joined to the timeline
// ---------------------------------------------------------------------------

describe("Story 003 T1 (Epic 019.5) — per-model-call record joined to the timeline", () => {
  let tmpDir = "";
  let store: Store;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-mcl-"));
    store = openStore(join(tmpDir, "model-call.db"), { busyTimeout: 1000 });
    initSchema(store);
  });

  after(async () => {
    store.close();
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  test("T1: a model_call event produces a per-call record with full shape and correct account_id", () => {
    const task_id = "task-mcl-001";
    const attempt = 1;
    const session_id = "sess-abc";
    const account_id = "acct-openai-primary";
    const correlation_id = `${task_id}:${attempt}`;

    appendModelCallRecord(store, {
      task_id,
      attempt,
      session_id,
      account_id,
      model: "gpt-4o",
      tokens_in: 512,
      tokens_out: 128,
      cost: 0.0042,
      latency_ms: 720,
      stop_reason: "end_turn",
      correlation_id,
    });

    const records = queryModelCallLog(store, task_id);
    assert.equal(records.length, 1, "exactly one per-call record must exist");

    const rec = records[0] as ModelCallRecord;
    assert.match(rec.call_id, /^call_[0-9A-HJKMNP-TV-Z]{26}$/, "call_id must match ^call_<26-char Crockford base32>$");
    assert.equal(rec.task_id, task_id);
    assert.equal(rec.attempt, attempt);
    assert.equal(rec.session_id, session_id);
    assert.equal(rec.account_id, account_id, "account_id must match the account that served the call");
    assert.equal(rec.model, "gpt-4o");
    assert.equal(rec.tokens_in, 512);
    assert.equal(rec.tokens_out, 128);
    assert.equal(rec.stop_reason, "end_turn");
    assert.equal(rec.correlation_id, correlation_id, "record must carry the task's correlation_id");
    assert.ok(typeof rec.cost === "number");
    assert.ok(typeof rec.latency_ms === "number");
  });

  test("T1: model_call record joins the task timeline — timeline contains a model_call entry for the same correlation_id", () => {
    const task_id = "task-mcl-002";
    const attempt = 1;
    const correlation_id = `${task_id}:${attempt}`;

    appendModelCallRecord(store, {
      task_id,
      attempt,
      session_id: "sess-bcd",
      account_id: "acct-openai-primary",
      model: "gpt-4o",
      tokens_in: 300,
      tokens_out: 60,
      cost: 0.002,
      latency_ms: 400,
      stop_reason: "end_turn",
      correlation_id,
    });

    // The per-call record must also produce a timeline event (kind="model_call")
    const timeline = readTimelineEvents(store, task_id);
    const tlEntry = timeline.find((e) => e.kind === "model_call");
    assert.ok(
      tlEntry !== undefined,
      "appendModelCallRecord must also write a timeline event with kind='model_call'",
    );
    assert.equal(
      tlEntry.correlation_id,
      correlation_id,
      "timeline event must share the same correlation_id",
    );
    assert.equal(tlEntry.task_id, task_id);
  });

  test("T1: two attempts on different accounts each attribute to the correct account_id", () => {
    const task_id = "task-mcl-003";
    const correlation_id_1 = `${task_id}:1`;
    const correlation_id_2 = `${task_id}:2`;

    appendModelCallRecord(store, {
      task_id,
      attempt: 1,
      session_id: "sess-att1",
      account_id: "acct-openai-primary",
      model: "gpt-4o",
      tokens_in: 100,
      tokens_out: 20,
      cost: 0.001,
      latency_ms: 200,
      stop_reason: "end_turn",
      correlation_id: correlation_id_1,
    });

    appendModelCallRecord(store, {
      task_id,
      attempt: 2,
      session_id: "sess-att2",
      account_id: "acct-copilot-secondary",
      model: "gpt-4o",
      tokens_in: 150,
      tokens_out: 30,
      cost: 0.0015,
      latency_ms: 250,
      stop_reason: "max_tokens",
      correlation_id: correlation_id_2,
    });

    const all = queryModelCallLog(store, task_id);
    const att1Records = all.filter((r) => r.attempt === 1);
    const att2Records = all.filter((r) => r.attempt === 2);

    assert.equal(att1Records.length, 1, "attempt 1 must have exactly one record");
    assert.equal(att2Records.length, 1, "attempt 2 must have exactly one record");

    assert.equal(
      att1Records[0]?.account_id,
      "acct-openai-primary",
      "attempt 1 must be attributed to the primary account",
    );
    assert.equal(
      att2Records[0]?.account_id,
      "acct-copilot-secondary",
      "attempt 2 must be attributed to the secondary account",
    );
  });
});

// ---------------------------------------------------------------------------
// BLOCKER S1 regression (Epic 019.5) — appendModelCallRecord must NOT self-migrate
// ---------------------------------------------------------------------------

describe("BLOCKER S1 regression (Epic 019.5) — appendModelCallRecord must not self-migrate task_timeline_event", () => {
  test("BLOCKER S1: appendModelCallRecord throws 'no such table' on uninitialised task_timeline_event schema", async () => {
    // Initialize ONLY model_call_log — NOT task_timeline_event.
    // appendModelCallRecord currently self-migrates task_timeline_event via
    // initTaskTimelineSchema(), so it succeeds instead of throwing.
    // After the fix, it must propagate the "no such table" error.
    const noSchemaDir = await mkdtemp(join(tmpdir(), "kanthord-mcl-s1-"));
    const noSchemaStore = openStore(join(noSchemaDir, "no-schema.db"), { busyTimeout: 1000 });
    try {
      initModelCallLogSchema(noSchemaStore);
      assert.throws(
        () =>
          appendModelCallRecord(noSchemaStore, {
            task_id: "t-s1",
            attempt: 1,
            session_id: "sess-s1",
            account_id: "acct-s1",
            model: "gpt-4o",
            tokens_in: 10,
            tokens_out: 5,
            cost: 0.0001,
            latency_ms: 50,
            stop_reason: "end_turn",
            correlation_id: "t-s1:1",
          }),
        /no such table/,
        "appendModelCallRecord must not self-migrate task_timeline_event; must throw on uninitialised timeline schema",
      );
    } finally {
      noSchemaStore.close();
      await rm(noSchemaDir, { recursive: true, force: true });
    }
  });
});

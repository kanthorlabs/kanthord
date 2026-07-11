/**
 * src/cli/timeline.test.ts
 *
 * Story 005 T2 (Epic 019.5) — kanthord timeline CLI
 *
 * Tests drive the CLI's exported `runTimelineCli(store, opts, out)` with an
 * injected output sink and a seeded temp store, keeping the suite hermetic
 * (no network, no spawned subprocess).
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { initSchema } from "../store/schema.ts";
import { appendTimelineEvent } from "../metrics/task-timeline.ts";
import { appendModelCallRecord } from "../metrics/model-call-log.ts";

// ---------------------------------------------------------------------------
// The seam under test — will fail RED until src/cli/timeline.ts exists.
// ---------------------------------------------------------------------------

import { runTimelineCli } from "./timeline.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOutput(): { write(s: string): void; value: string } {
  let value = "";
  return {
    get value() { return value; },
    write(s: string) { value += s; },
  };
}

// ---------------------------------------------------------------------------
// Suite: Story 005 T2 — kanthord timeline CLI
// ---------------------------------------------------------------------------

describe("Story 005 T2 (Epic 019.5) — kanthord timeline CLI", () => {
  let tmpDir = "";
  let store: Store;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-cli-tl-"));
    store = openStore(join(tmpDir, "timeline-cli.db"), { busyTimeout: 1000 });
    initSchema(store);
  });

  after(async () => {
    store.close();
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  test("T2: ordered timeline printed with all events in event_id-descending order (newest-first)", () => {
    const taskId = "task-cli-t2-a";
    const correlation_id = `${taskId}:1`;

    appendTimelineEvent(store, {
      task_id: taskId, attempt: 1, correlation_id,
      kind: "spawn", ts: 1000, summary: "session spawned",
    });
    appendTimelineEvent(store, {
      task_id: taskId, attempt: 1, correlation_id,
      kind: "gate_failed", ts: 2000,
      observed_failure_signal: "gate_failed", summary: "gate check failed",
    });
    appendTimelineEvent(store, {
      task_id: taskId, attempt: 1, correlation_id,
      kind: "budget_breach", ts: 3000,
      observed_failure_signal: "budget_breach", summary: "budget halted",
    });

    const out = makeOutput();
    runTimelineCli(store, { taskId }, out);

    const text = out.value;
    assert.ok(text.includes("spawn"), `output must mention 'spawn'; got: ${JSON.stringify(text)}`);
    assert.ok(text.includes("gate_failed"), `output must mention 'gate_failed'; got: ${JSON.stringify(text)}`);
    assert.ok(text.includes("budget_breach"), `output must mention 'budget_breach'; got: ${JSON.stringify(text)}`);

    // event_id DESC (newest-first): budget_breach before gate_failed before spawn
    const spawnIdx = text.indexOf("spawn");
    const gateIdx = text.indexOf("gate_failed");
    const budgetIdx = text.indexOf("budget_breach");
    assert.ok(budgetIdx < gateIdx, "budget_breach (newest) must appear before gate_failed in output");
    assert.ok(gateIdx < spawnIdx, "gate_failed must appear before spawn (oldest) in output");
  });

  test("T2: --failures filter prints only signal-bearing events", () => {
    const taskId = "task-cli-t2-b";
    const correlation_id = `${taskId}:1`;

    appendTimelineEvent(store, {
      task_id: taskId, attempt: 1, correlation_id,
      kind: "spawn", ts: 4000, summary: "session spawned",
    });
    appendTimelineEvent(store, {
      task_id: taskId, attempt: 1, correlation_id,
      kind: "gate_failed", ts: 5000,
      observed_failure_signal: "gate_failed", summary: "gate check failed",
    });

    const out = makeOutput();
    runTimelineCli(store, { taskId, failures: true }, out);

    const text = out.value;
    assert.ok(
      !text.includes("spawn"),
      `--failures output must NOT include 'spawn' (no signal); got: ${JSON.stringify(text)}`,
    );
    assert.ok(
      text.includes("gate_failed"),
      `--failures output must include 'gate_failed' (has signal); got: ${JSON.stringify(text)}`,
    );
  });

  test("T2: model_call events print account_id and model in output", () => {
    const taskId = "task-cli-t2-c";
    const correlation_id = `${taskId}:1`;

    appendModelCallRecord(store, {
      task_id: taskId, attempt: 1, session_id: "sess-c1",
      account_id: "acct-PROD", model: "claude-3-5-haiku",
      tokens_in: 100, tokens_out: 50, cost: 0.001,
      latency_ms: 300, stop_reason: "end_turn", correlation_id,
    });

    const out = makeOutput();
    runTimelineCli(store, { taskId }, out);

    const text = out.value;
    assert.ok(
      text.includes("acct-PROD"),
      `output must include account_id 'acct-PROD'; got: ${JSON.stringify(text)}`,
    );
    assert.ok(
      text.includes("claude-3-5-haiku"),
      `output must include model 'claude-3-5-haiku'; got: ${JSON.stringify(text)}`,
    );
  });

  test("T2: two attempts on different accounts each appear attributed correctly in output", () => {
    const taskId = "task-cli-t2-d";

    appendModelCallRecord(store, {
      task_id: taskId, attempt: 1, session_id: "sess-d1",
      account_id: "acct-Alpha", model: "claude-3-5-haiku",
      tokens_in: 50, tokens_out: 20, cost: 0.0005,
      latency_ms: 100, stop_reason: "end_turn", correlation_id: `${taskId}:1`,
    });
    appendModelCallRecord(store, {
      task_id: taskId, attempt: 2, session_id: "sess-d2",
      account_id: "acct-Beta", model: "gpt-4o-mini",
      tokens_in: 60, tokens_out: 30, cost: 0.0008,
      latency_ms: 150, stop_reason: "end_turn", correlation_id: `${taskId}:2`,
    });

    const out = makeOutput();
    runTimelineCli(store, { taskId }, out);

    const text = out.value;
    assert.ok(
      text.includes("acct-Alpha"),
      `output must include 'acct-Alpha'; got: ${JSON.stringify(text)}`,
    );
    assert.ok(
      text.includes("acct-Beta"),
      `output must include 'acct-Beta'; got: ${JSON.stringify(text)}`,
    );
  });
});

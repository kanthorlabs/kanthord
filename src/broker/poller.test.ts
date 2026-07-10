import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import { FakeClock } from "../foundations/clock.ts";
import type { AsyncVerbAdapter, VerbRegistryEntry } from "./registry.ts";
import type { InFlightOp } from "./submit.ts";
import { startPolling } from "./poller.ts";
import { initSchema } from "../store/schema.ts";

/** Row shape of broker_completion as read back from SQLite. */
interface CompletionRow {
  op_id: string;
  status: string;
  result_json: string | null;
  error_json: string | null;
}

function makeEntry(overrides?: Partial<VerbRegistryEntry>): VerbRegistryEntry {
  return {
    verb: "deploy_service",
    tier: "auto",
    timeout: 30000,
    idempotency: { window_ms: 3600000 },
    retry: { max: 3, backoff: "exponential" },
    poll_interval: 5000,
    terminal_states: ["done", "failed"],
    rate_limit: { requests_per_minute: 60 },
    observed_state_can_regress: false,
    ...overrides,
  };
}

function makeOp(overrides?: Partial<InFlightOp>): InFlightOp {
  return {
    op_id: "op-poll-001",
    verb: "deploy_service",
    request_id: "req-poll-001",
    status: "in_flight",
    ...overrides,
  };
}

describe("src/broker/poller.ts", () => {
  // -------------------------------------------------------------------------
  // T1a — Advancing by poll_interval calls poll_status; done writes result_json
  // -------------------------------------------------------------------------
  test("advancing by poll_interval calls poll_status and writes done completion row with result_json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-poller-t1a-"));
    try {
      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(0);
        const entry = makeEntry();
        const op = makeOp();

        let pollStatusCalls = 0;
        const adapter: AsyncVerbAdapter = {
          submit: async () => "req-id",
          poll_status: async (_requestId: unknown) => {
            pollStatusCalls += 1;
            return { status: "done", result: { deployed: true } };
          },
          reconcile: async () => ({}),
        };

        startPolling(op, entry, adapter, store, clock);

        // Advance exactly one poll_interval — fires the scheduled timer
        clock.advance(entry.poll_interval);
        // poll_status is async: let its microtask-queue continuation run
        await Promise.resolve();

        // poll_status called once per interval
        assert.equal(pollStatusCalls, 1, "poll_status called once per interval");

        // broker_completion row written keyed by op_id with result_json set
        const row = store.get<CompletionRow>(
          "SELECT op_id, status, result_json, error_json FROM broker_completion WHERE op_id = ?",
          op.op_id,
        );
        assert.ok(row !== undefined, "completion row must be written");
        assert.equal(row.op_id, op.op_id, "completion row keyed by op_id");
        assert.equal(row.status, "done", "completion row status is done");
        assert.ok(row.result_json !== null, "result_json is set for done");
        assert.equal(row.error_json, null, "error_json is null for done");
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // T1b — failed terminal state writes completion row with error_json
  // -------------------------------------------------------------------------
  test("advancing by poll_interval with failed terminal state writes completion row with error_json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-poller-t1b-"));
    try {
      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(0);
        const entry = makeEntry();
        const op = makeOp({ op_id: "op-poll-002", request_id: "req-poll-002" });

        const adapter: AsyncVerbAdapter = {
          submit: async () => "req-id",
          poll_status: async (_requestId: unknown) => {
            return { status: "failed", error: { message: "deployment error" } };
          },
          reconcile: async () => ({}),
        };

        startPolling(op, entry, adapter, store, clock);
        clock.advance(entry.poll_interval);
        await Promise.resolve();

        const row = store.get<CompletionRow>(
          "SELECT op_id, status, result_json, error_json FROM broker_completion WHERE op_id = ?",
          op.op_id,
        );
        assert.ok(row !== undefined, "completion row must be written for failed");
        assert.equal(row.status, "failed", "completion row status is failed");
        assert.ok(row.error_json !== null, "error_json is set for failed");
        assert.equal(row.result_json, null, "result_json is null for failed");
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // T1c — Idempotent write: same op_id written twice yields only one row
  // -------------------------------------------------------------------------
  test("writing completion for the same op_id twice does not duplicate the broker_completion row", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-poller-t1c-"));
    try {
      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(0);
        const entry = makeEntry();
        const op = makeOp({ op_id: "op-poll-003", request_id: "req-poll-003" });

        // Adapter always returns terminal "done"
        const adapter: AsyncVerbAdapter = {
          submit: async () => "req-id",
          poll_status: async () => ({ status: "done", result: { ok: true } }),
          reconcile: async () => ({}),
        };

        // Start two pollers for the same op — simulates a double-fire; both
        // write the same op_id; INSERT OR REPLACE keeps exactly one row.
        startPolling(op, entry, adapter, store, clock);
        startPolling(op, entry, adapter, store, clock);
        clock.advance(entry.poll_interval);
        await Promise.resolve();

        const rows = store.all<CompletionRow>(
          "SELECT op_id FROM broker_completion WHERE op_id = ?",
          op.op_id,
        );
        assert.equal(
          rows.length,
          1,
          "only one completion row for the op_id (idempotent write)",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2a — Verb exceeding timeout emits escalation_needed and stops polling
  // -------------------------------------------------------------------------
  test("verb exceeding timeout with no terminal state emits escalation_needed and stops polling", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-poller-t2a-"));
    try {
      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(0);
        // timeout=15000ms, poll_interval=5000ms: after 3 non-terminal polls the
        // cumulative elapsed time reaches the timeout → escalation_needed
        const entry = makeEntry({ timeout: 15000, poll_interval: 5000 });
        const op = makeOp({ op_id: "op-t2a-001", request_id: "req-t2a-001" });

        let pollCount = 0;
        const adapter: AsyncVerbAdapter = {
          submit: async () => "req-id",
          poll_status: async () => {
            pollCount += 1;
            return { status: "pending" };
          },
          reconcile: async () => ({}),
        };

        startPolling(op, entry, adapter, store, clock);

        clock.advance(5000);
        await Promise.resolve(); // t=5000, poll 1 — pending, elapsed<timeout
        clock.advance(5000);
        await Promise.resolve(); // t=10000, poll 2 — pending, elapsed<timeout
        clock.advance(5000);
        await Promise.resolve(); // t=15000, poll 3 — elapsed>=timeout → escalate

        const row = store.get<CompletionRow>(
          "SELECT op_id, status, result_json, error_json FROM broker_completion WHERE op_id = ?",
          op.op_id,
        );
        assert.ok(
          row !== undefined,
          "escalation row must be written when timeout is reached",
        );
        assert.equal(
          row.status,
          "escalation_needed",
          "status is escalation_needed on timeout",
        );

        // No further polls after escalation (polling must stop)
        const countAfterEscalation = pollCount;
        clock.advance(5000);
        await Promise.resolve();
        assert.equal(
          pollCount,
          countAfterEscalation,
          "no further polls after escalation_needed is emitted",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2b — Exponential backoff on retryable non-terminal error
  // -------------------------------------------------------------------------
  test("retryable non-terminal error schedules next poll at doubled interval (exponential backoff)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-poller-t2b-"));
    try {
      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(0);
        // poll_interval=1000ms, backoff="exponential": first retry at 2000ms
        // so second poll fires at t=1000+2000=3000
        const entry = makeEntry({
          poll_interval: 1000,
          timeout: 300000,
          retry: { max: 3, backoff: "exponential" },
        });
        const op = makeOp({ op_id: "op-t2b-001", request_id: "req-t2b-001" });

        let pollCount = 0;
        const adapter: AsyncVerbAdapter = {
          submit: async () => "req-id",
          poll_status: async () => {
            pollCount += 1;
            if (pollCount === 1) {
              // Non-terminal with error field → retryable error → backoff
              return {
                status: "pending",
                error: { message: "transient network error" },
              };
            }
            return { status: "done", result: { deployed: true } };
          },
          reconcile: async () => ({}),
        };

        startPolling(op, entry, adapter, store, clock);

        // t=1000: poll 1 fires, retryable error → reschedule at doubled interval (2000ms)
        clock.advance(1000);
        await Promise.resolve();
        assert.equal(pollCount, 1, "first poll fired at t=1000");

        // t=2000: would fire normally, but backoff doubled interval to 2000ms from t=1000
        // → next poll due at t=3000, not t=2000
        clock.advance(1000);
        await Promise.resolve();
        assert.equal(
          pollCount,
          1,
          "no second poll at t=2000 (exponential backoff: next poll at t=3000)",
        );

        // t=3000: second poll fires (2000ms backoff window elapsed from t=1000)
        clock.advance(1000);
        await Promise.resolve();
        assert.equal(
          pollCount,
          2,
          "second poll fires at t=3000 after exponential backoff",
        );

        const row = store.get<CompletionRow>(
          "SELECT status FROM broker_completion WHERE op_id = ?",
          op.op_id,
        );
        assert.ok(row !== undefined, "completion row written after done response");
        assert.equal(row.status, "done", "completion row status is done");
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2c — Rate-limit deferral
  // -------------------------------------------------------------------------
  test("rate-limit response defers next poll by 60000/rpm ms instead of poll_interval", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-poller-t2c-"));
    try {
      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(0);
        // rate_limit: 10/min → 6000ms per-request deferral; poll_interval=1000ms
        const entry = makeEntry({
          poll_interval: 1000,
          rate_limit: { requests_per_minute: 10 },
          timeout: 300000,
        });
        const op = makeOp({ op_id: "op-t2c-001", request_id: "req-t2c-001" });

        let pollCount = 0;
        const adapter: AsyncVerbAdapter = {
          submit: async () => "req-id",
          poll_status: async () => {
            pollCount += 1;
            if (pollCount === 1) return { status: "rate_limited" };
            return { status: "done", result: { ok: true } };
          },
          reconcile: async () => ({}),
        };

        startPolling(op, entry, adapter, store, clock);

        // t=1000: poll 1 fires, rate_limited → defer next poll to t=7000 (1000+6000)
        clock.advance(1000);
        await Promise.resolve();
        assert.equal(pollCount, 1, "first poll fired, returned rate_limited");

        // t=2000: no poll (deferred to t=7000, not t=2000)
        clock.advance(1000);
        await Promise.resolve();
        assert.equal(
          pollCount,
          1,
          "no poll at t=2000 (rate-limit deferred to t=7000)",
        );

        // t=7000: second poll fires (6000ms rate-limit window elapsed from t=1000)
        clock.advance(5000);
        await Promise.resolve();
        assert.equal(
          pollCount,
          2,
          "second poll fires at t=7000 after 6000ms rate-limit deferral",
        );

        const row = store.get<CompletionRow>(
          "SELECT status FROM broker_completion WHERE op_id = ?",
          op.op_id,
        );
        assert.ok(row !== undefined, "completion row written after done response");
        assert.equal(row.status, "done");
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2d(1) — observed_state_can_regress: false, terminal done is final
  //          Characterization test — behavior already shipped by T1a; included
  //          here to establish the explicit contrast with T2d(2).
  // -------------------------------------------------------------------------
  test("observed_state_can_regress: false — terminal done is written as final completion row immediately", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-poller-t2d1-"));
    try {
      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(0);
        const entry = makeEntry({ observed_state_can_regress: false });
        const op = makeOp({ op_id: "op-t2d1-001", request_id: "req-t2d1-001" });

        const adapter: AsyncVerbAdapter = {
          submit: async () => "req-id",
          poll_status: async () => ({ status: "done", result: { ok: true } }),
          reconcile: async () => ({}),
        };

        startPolling(op, entry, adapter, store, clock);
        clock.advance(entry.poll_interval);
        await Promise.resolve();

        const row = store.get<CompletionRow>(
          "SELECT status FROM broker_completion WHERE op_id = ?",
          op.op_id,
        );
        assert.ok(
          row !== undefined,
          "terminal done must be immediately written as final completion row when can_regress=false",
        );
        assert.equal(row.status, "done", "completion row status is done");
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2d(2) — observed_state_can_regress: true, regression after terminal
  //          is NOT left as final done (withheld/marked regressable)
  // -------------------------------------------------------------------------
  test("observed_state_can_regress: true — terminal done followed by regression is NOT left final done", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-poller-t2d2-"));
    try {
      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(0);
        const entry = makeEntry({ observed_state_can_regress: true, timeout: 300000 });
        const op = makeOp({ op_id: "op-t2d2-001", request_id: "req-t2d2-001" });

        let pollCount = 0;
        const adapter: AsyncVerbAdapter = {
          submit: async () => "req-id",
          poll_status: async () => {
            pollCount += 1;
            if (pollCount === 1)
              return { status: "done", result: { ok: true } }; // terminal
            return { status: "pending" }; // regression: state reverted to non-terminal
          },
          reconcile: async () => ({}),
        };

        startPolling(op, entry, adapter, store, clock);

        // t=5000: poll 1 returns "done" — with can_regress: true, must NOT finalize yet
        clock.advance(entry.poll_interval);
        await Promise.resolve();
        assert.equal(pollCount, 1, "first poll fired");

        // t=10000: poll 2 returns "pending" — regression detected
        // (can_regress: true means the poller continues polling after terminal)
        clock.advance(entry.poll_interval);
        await Promise.resolve();
        assert.equal(
          pollCount,
          2,
          "second poll fires because can_regress: true does not stop polling on first terminal",
        );

        const row = store.get<CompletionRow>(
          "SELECT status FROM broker_completion WHERE op_id = ?",
          op.op_id,
        );
        assert.ok(
          row === undefined || row.status !== "done",
          "can_regress: true — regression after terminal must NOT leave a final done row",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // T1d — Terminality decided by declared terminal_states, not hardcoded set
  // -------------------------------------------------------------------------
  test("terminality is decided by declared terminal_states, not a hardcoded done/failed set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-poller-t1d-"));
    try {
      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const clock = new FakeClock(0);
        // Verb with custom terminal_states — "done" and "failed" are NOT terminal here
        const entry = makeEntry({ terminal_states: ["completed", "aborted"] });
        const op = makeOp({ op_id: "op-poll-004", request_id: "req-poll-004" });

        let pollCount = 0;
        const adapter: AsyncVerbAdapter = {
          submit: async () => "req-id",
          poll_status: async () => {
            pollCount += 1;
            // First call returns "done" — NOT in this verb's terminal_states
            if (pollCount === 1) return { status: "done" };
            // Second call returns "completed" — IS in terminal_states
            return { status: "completed", result: { finished: true } };
          },
          reconcile: async () => ({}),
        };

        startPolling(op, entry, adapter, store, clock);

        // First interval: "done" is not terminal for this verb — no completion row
        clock.advance(entry.poll_interval);
        await Promise.resolve();
        const noRow = store.get<CompletionRow>(
          "SELECT op_id FROM broker_completion WHERE op_id = ?",
          op.op_id,
        );
        assert.equal(
          noRow,
          undefined,
          '"done" is not terminal per declared states — no completion row after first interval',
        );

        // Second interval: "completed" IS terminal — completion row written
        clock.advance(entry.poll_interval);
        await Promise.resolve();
        const row = store.get<CompletionRow>(
          "SELECT op_id, status FROM broker_completion WHERE op_id = ?",
          op.op_id,
        );
        assert.ok(
          row !== undefined,
          '"completed" is declared terminal — completion row written after second interval',
        );
        assert.equal(
          row.status,
          "completed",
          "completion row status matches declared terminal state",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

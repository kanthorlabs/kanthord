import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import { FakeClock } from "../foundations/clock.ts";
import type { AsyncVerbAdapter, VerbRegistryEntry } from "./registry.ts";
import { createPendingOp, releasePendingOp } from "./expiry.ts";

// Suite: src/broker/expiry.ts
// Story 005 — Per-Verb Pending Expiry, Task T1:
// advancing past the per-verb expiry window transitions a pending op to expired
// (never submitted); a fresh op within the window still submits; two verbs with
// different windows expire independently.

describe("src/broker/expiry.ts", () => {
  // -------------------------------------------------------------------------
  // T1a — advancing past expiry → expired, never submitted
  // -------------------------------------------------------------------------
  test("advancing past expiry window transitions pending op to expired and never submits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-expiry-t1a-"));
    try {
      const store = openStore(join(dir, "expiry.db"), { busyTimeout: 1000 });
      try {
        const clock = new FakeClock(0);
        // VerbRegistryEntry with pending_expiry_ms declares the per-verb window.
        const entry = {
          verb: "deploy_service",
          tier: "auto",
          timeout: 60000,
          idempotency: { window_ms: 3600000 },
          retry: { max: 3, backoff: "exponential" },
          poll_interval: 5000,
          terminal_states: ["done", "failed"],
          rate_limit: { requests_per_minute: 60 },
          observed_state_can_regress: false,
          pending_expiry_ms: 1000,
        } satisfies VerbRegistryEntry;

        let submitCalls = 0;
        const adapter: AsyncVerbAdapter = {
          submit: async () => {
            submitCalls++;
            return "req-expired-T1a";
          },
          poll_status: async () => ({ status: "done" }),
          reconcile: async () => ({ outcome: "done", observed_hash: "" }),
        };

        const opId = createPendingOp(entry, "idem-expiry-T1a", store, clock);
        assert.ok(opId.length > 0, "createPendingOp must return a non-empty op_id");

        // advance past the 1000ms expiry window
        clock.advance(1001);

        const result = await releasePendingOp(
          opId,
          entry,
          adapter,
          { data: "payload-T1a" },
          store,
          clock,
        );
        assert.strictEqual(result, "expired", "expired op result must be 'expired'");
        assert.strictEqual(
          submitCalls,
          0,
          "adapter.submit must not be called for a past-expiry pending op",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T1b — within window → submits (→ in_flight)
  // -------------------------------------------------------------------------
  test("pending op within expiry window submits and transitions to in_flight", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-expiry-t1b-"));
    try {
      const store = openStore(join(dir, "expiry.db"), { busyTimeout: 1000 });
      try {
        const clock = new FakeClock(0);
        const entry = {
          verb: "deploy_service",
          tier: "auto",
          timeout: 60000,
          idempotency: { window_ms: 3600000 },
          retry: { max: 3, backoff: "exponential" },
          poll_interval: 5000,
          terminal_states: ["done", "failed"],
          rate_limit: { requests_per_minute: 60 },
          observed_state_can_regress: false,
          pending_expiry_ms: 5000,
        } satisfies VerbRegistryEntry;

        let submitCalls = 0;
        const adapter: AsyncVerbAdapter = {
          submit: async () => {
            submitCalls++;
            return "req-fresh-T1b";
          },
          poll_status: async () => ({ status: "done" }),
          reconcile: async () => ({ outcome: "done", observed_hash: "" }),
        };

        const opId = createPendingOp(entry, "idem-expiry-T1b", store, clock);

        // advance within the 5000ms window
        clock.advance(1000);

        const result = await releasePendingOp(
          opId,
          entry,
          adapter,
          { data: "payload-T1b" },
          store,
          clock,
        );
        assert.strictEqual(result, "in_flight", "fresh pending op must submit (→ in_flight)");
        assert.strictEqual(submitCalls, 1, "adapter.submit must be called exactly once");
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T1c — two verbs with different windows expire independently
  // -------------------------------------------------------------------------
  test("two verbs with different expiry windows expire independently", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-expiry-t1c-"));
    try {
      const store = openStore(join(dir, "expiry.db"), { busyTimeout: 1000 });
      try {
        const clock = new FakeClock(0);

        // short_verb expires after 1 000 ms
        const entryShort = {
          verb: "short_verb",
          tier: "auto",
          timeout: 60000,
          idempotency: { window_ms: 3600000 },
          retry: { max: 3, backoff: "exponential" },
          poll_interval: 5000,
          terminal_states: ["done", "failed"],
          rate_limit: { requests_per_minute: 60 },
          observed_state_can_regress: false,
          pending_expiry_ms: 1000,
        } satisfies VerbRegistryEntry;

        // long_verb expires after 5 000 ms
        const entryLong = {
          verb: "long_verb",
          tier: "auto",
          timeout: 60000,
          idempotency: { window_ms: 3600000 },
          retry: { max: 3, backoff: "exponential" },
          poll_interval: 5000,
          terminal_states: ["done", "failed"],
          rate_limit: { requests_per_minute: 60 },
          observed_state_can_regress: false,
          pending_expiry_ms: 5000,
        } satisfies VerbRegistryEntry;

        let submitCalls = 0;
        const adapter: AsyncVerbAdapter = {
          submit: async () => {
            submitCalls++;
            return `req-independent-${submitCalls}`;
          },
          poll_status: async () => ({ status: "done" }),
          reconcile: async () => ({ outcome: "done", observed_hash: "" }),
        };

        const opId1 = createPendingOp(entryShort, "idem-expiry-T1c-short", store, clock);
        const opId2 = createPendingOp(entryLong, "idem-expiry-T1c-long", store, clock);

        // advance 2 000 ms — past short_verb's 1 000 ms window, within long_verb's 5 000 ms window
        clock.advance(2000);

        const result1 = await releasePendingOp(
          opId1,
          entryShort,
          adapter,
          {},
          store,
          clock,
        );
        const result2 = await releasePendingOp(
          opId2,
          entryLong,
          adapter,
          {},
          store,
          clock,
        );

        assert.strictEqual(result1, "expired", "short_verb op must be expired");
        assert.strictEqual(result2, "in_flight", "long_verb op must still be within window");
        assert.strictEqual(submitCalls, 1, "only the fresh op (long_verb) must invoke adapter.submit");
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // S4 REGRESSION — createPendingOp must dedup on (verb, idempotency_key)
  // A second call with the same key must return the existing op_id and must
  // NOT insert a second row into broker_pending.
  // -------------------------------------------------------------------------
  test("second createPendingOp with same (verb, idempotency_key) returns the existing pending op_id and creates no second pending row", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-expiry-s4-"));
    try {
      const store = openStore(join(dir, "expiry.db"), { busyTimeout: 1000 });
      try {
        const clock = new FakeClock(0);
        const entry = {
          verb: "deploy_service",
          tier: "auto",
          timeout: 60000,
          idempotency: { window_ms: 3600000 },
          retry: { max: 3, backoff: "exponential" },
          poll_interval: 5000,
          terminal_states: ["done", "failed"],
          rate_limit: { requests_per_minute: 60 },
          observed_state_can_regress: false,
          pending_expiry_ms: 60000,
        } satisfies VerbRegistryEntry;

        const opId1 = createPendingOp(entry, "idem-dedup-s4", store, clock);
        const opId2 = createPendingOp(entry, "idem-dedup-s4", store, clock);

        assert.strictEqual(
          opId2,
          opId1,
          "second createPendingOp with same (verb, idempotency_key) must return the original op_id",
        );

        interface PendingRow {
          op_id: string;
        }
        const rows = store.all<PendingRow>(
          "SELECT op_id FROM broker_pending WHERE verb = ? AND idempotency_key = ?",
          entry.verb,
          "idem-dedup-s4",
        );
        assert.equal(
          rows.length,
          1,
          "only one broker_pending row must exist for the (verb, idempotency_key) pair",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

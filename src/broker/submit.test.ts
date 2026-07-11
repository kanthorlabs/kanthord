import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { AsyncVerbAdapter, VerbRegistryEntry } from "./registry.ts";
import { submit, getInFlightOp } from "./submit.ts";
import { initSchema } from "../store/schema.ts";

// Story-named request_id the Mock adapter returns (PROFILE.md: Mock = Story-named value)
const MOCK_REQUEST_ID = "req-stub-T1-001";

function makeEntry(): VerbRegistryEntry {
  return {
    verb: "deploy_service",
    tier: "auto",
    timeout: 30000,
    idempotency: { window_ms: 3600000 },
    retry: { max: 3, backoff: "exponential" },
    poll_interval: 5000,
    terminal_states: ["success", "failed"],
    rate_limit: { requests_per_minute: 60 },
    observed_state_can_regress: false,
  };
}

function makeMockAdapter(): {
  adapter: AsyncVerbAdapter;
  calls: { submit: number };
} {
  const calls = { submit: 0 };
  const adapter: AsyncVerbAdapter = {
    submit: async (_input: unknown) => {
      calls.submit += 1;
      return MOCK_REQUEST_ID;
    },
    poll_status: async (_requestId: unknown) => ({ status: "in_flight" }),
    reconcile: async (_ledger: unknown) => ({ outcome: "done" }),
  };
  return { adapter, calls };
}

describe("src/broker/submit.ts", () => {
  // -------------------------------------------------------------------------
  // T1 — Submit returns op_id + records in-flight op
  // -------------------------------------------------------------------------
  test("submit returns op_id and records in-flight op with the fake verb's request_id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-submit-t1-"));
    try {
      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const entry = makeEntry();
        const { adapter, calls } = makeMockAdapter();

        const opId = await submit(
          entry,
          adapter,
          { service: "api" },
          "idem-key-001",
          store,
        );

        // op_id must be a prefixed ULID: op_<26-char Crockford base32>
        assert.match(opId, /^op_[0-9A-HJKMNP-TV-Z]{26}$/, "op_id must match ^op_<26-char Crockford base32>$");

        // fake adapter's submit was invoked exactly once
        assert.equal(
          calls.submit,
          1,
          "fake adapter submit called exactly once",
        );

        // in-flight op is recorded with the fake verb's request_id
        const inFlight = getInFlightOp(opId, store);
        assert.ok(
          inFlight !== undefined,
          "in-flight op must be recorded in the store",
        );
        assert.equal(
          inFlight.request_id,
          MOCK_REQUEST_ID,
          "request_id matches the mock adapter's return value",
        );
        assert.equal(inFlight.status, "in_flight", "status is in_flight");
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2a — Idempotent resubmit: same (verb, idempotencyKey) → same op_id
  // -------------------------------------------------------------------------
  test("resubmit with same (verb, idempotencyKey) returns the same op_id and invokes submit only once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-submit-t2a-"));
    try {
      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const entry = makeEntry();
        const { adapter, calls } = makeMockAdapter();

        const opId1 = await submit(
          entry,
          adapter,
          { service: "api" },
          "idem-key-T2",
          store,
        );
        const opId2 = await submit(
          entry,
          adapter,
          { service: "api" },
          "idem-key-T2",
          store,
        );

        // same idempotency key → same op_id returned
        assert.equal(opId2, opId1, "resubmit with same key returns the same op_id");

        // adapter's submit was called only once, not twice
        assert.equal(
          calls.submit,
          1,
          "adapter submit invoked exactly once across two submits with the same key",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2b — Required-key enforcement: empty key rejected when entry requires one
  // -------------------------------------------------------------------------
  test("submit without idempotency key when entry requires one throws error naming the verb", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-submit-t2b-"));
    try {
      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        // makeEntry() returns idempotency.window_ms = 3600000 > 0 → key required
        const entry = makeEntry();
        const { adapter } = makeMockAdapter();

        await assert.rejects(
          () => submit(entry, adapter, { service: "api" }, "", store),
          (err: unknown) => {
            assert.ok(err instanceof Error, "throws an Error instance");
            assert.ok(
              err.message.includes("deploy_service"),
              "error message names the verb",
            );
            return true;
          },
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

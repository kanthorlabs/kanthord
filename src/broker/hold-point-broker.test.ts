import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { AsyncVerbAdapter, VerbRegistryEntry } from "./registry.ts";
import { submit } from "./submit.ts";
import { makeHoldPoint } from "./hold-point.ts";
import type { HoldPointConfig } from "./hold-point.ts";
import { initSchema } from "../store/schema.ts";

// Suite: src/broker/hold-point — broker-level integration
// BLOCKER hold-point-not-integrated regression:
//   When a hold-point is configured for a verb at "pre-submit", a call to
//   submit() must NOT invoke the adapter (op stays held); when the hold is
//   absent (empty config), submit() invokes the adapter normally.

function makeEntry(): VerbRegistryEntry {
  return {
    verb: "github.create_pr",
    tier: "auto",
    timeout: 30000,
    idempotency: { window_ms: 0 }, // window_ms=0 — key not required
    retry: { max: 3, backoff: "exponential" },
    poll_interval: 5000,
    terminal_states: ["done", "failed"],
    rate_limit: { requests_per_minute: 60 },
    observed_state_can_regress: false,
  };
}

function makeTrackingAdapter(): {
  adapter: AsyncVerbAdapter;
  calls: { submit: number };
} {
  const calls = { submit: 0 };
  const adapter: AsyncVerbAdapter = {
    submit: async (_input: unknown) => {
      calls.submit += 1;
      return "req-hold-broker-test-001";
    },
    poll_status: async (_requestId: unknown) => ({ status: "in_flight" }),
    reconcile: async (_ledger: unknown) => ({ status: "done" }),
  };
  return { adapter, calls };
}

describe("src/broker/hold-point — broker integration", () => {
  // -------------------------------------------------------------------------
  // pre-submit hold: submit called, adapter NOT invoked while held
  // -------------------------------------------------------------------------
  test("pre-submit hold: submit called, adapter not invoked while held", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-hold-pre-submit-"));
    try {
      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const entry = makeEntry();
        const { adapter, calls } = makeTrackingAdapter();
        const config: HoldPointConfig = {
          holds: { "github.create_pr": "pre-submit" },
        };
        const hp = makeHoldPoint(config);

        // submit() must accept an optional holdPoint option and honour it.
        // Current code ignores the extra arg → adapter IS called → assertion FAILS (RED).
        // After SE wires the hold-point into submit(), adapter is NOT called → GREEN.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (submit as (...args: unknown[]) => Promise<string>)(
          entry,
          adapter,
          { branch: "feature/hold-test" },
          "",
          store,
          { holdPoint: hp },
        );

        assert.equal(
          calls.submit,
          0,
          "adapter.submit must not be called while a pre-submit hold is active",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // no hold (empty config): submit invokes adapter normally — hold-point
  // must not change behaviour when off (default-off semantics).
  // -------------------------------------------------------------------------
  test("no hold (empty config): submit invokes adapter normally", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-hold-off-"));
    try {
      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      initSchema(store);
      try {
        const entry = makeEntry();
        const { adapter, calls } = makeTrackingAdapter();
        const config: HoldPointConfig = { holds: {} }; // flag off
        const hp = makeHoldPoint(config);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (submit as (...args: unknown[]) => Promise<string>)(
          entry,
          adapter,
          { branch: "feature/no-hold-test" },
          "",
          store,
          { holdPoint: hp },
        );

        assert.equal(
          calls.submit,
          1,
          "adapter.submit must be called exactly once when no hold is configured",
        );
      } finally {
        store.close();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

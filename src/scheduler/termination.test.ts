/**
 * Story 003 T2 (Epic 019.3) — termination decision function
 *
 * Seam under test: src/scheduler/termination.ts
 *
 * Covers:
 *  - pass → complete verdict, ledger incremented
 *  - needs_human → needs-human verdict, ledger incremented
 *  - fail under max → retry-intent verdict, evidence recorded, ledger incremented
 *  - fail at max, no grant-one → attempts-exhausted verdict
 *  - fail at max, grant-one active → retry-intent verdict, grant-one cleared
 *  - recording precedes verdict: evidence row exists immediately after the call
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import { initSchema } from "../store/schema.ts";
import { readAttempts, grantOne, readGrantOne } from "./attempt-ledger.ts";
import { latestEvidence } from "./attempt-evidence.ts";
import {
  postSessionDecision,
  type Verdict,
} from "./termination.ts";
import type { GateResult } from "../workflow/workflow.ts";

// ---------------------------------------------------------------------------
// Suite: src/scheduler/termination
// ---------------------------------------------------------------------------

async function withStore(
  fn: (storeFile: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "termination-t2-"));
  try {
    await fn(join(dir, "test.db"));
  } finally {
    await rm(dir, { recursive: true });
  }
}

test("Story 003 T2 (Epic 019.3) — pass outcome → complete verdict, ledger incremented", async () => {
  await withStore(async (file) => {
    const store = openStore(file, { busyTimeout: 1000 });
    initSchema(store);
    try {
      const result: GateResult = { outcome: "pass" };
      const verdict = postSessionDecision(store, {
        taskId: "task-t2-pass",
        phase: "tdd",
        gateResult: result,
        maxAttempts: 3,
      });
      assert.equal(verdict.kind, "complete", "pass gate must yield complete verdict");
      assert.equal(
        readAttempts(store, "task-t2-pass"),
        1,
        "ledger must be incremented even on pass",
      );
    } finally {
      store.close();
    }
  });
});

test("Story 003 T2 (Epic 019.3) — needs_human outcome → needs-human verdict, ledger incremented", async () => {
  await withStore(async (file) => {
    const store = openStore(file, { busyTimeout: 1000 });
    initSchema(store);
    try {
      const result: GateResult = { outcome: "needs_human", summary: "needs review" };
      const verdict = postSessionDecision(store, {
        taskId: "task-t2-nh",
        phase: "tdd",
        gateResult: result,
        maxAttempts: 3,
      });
      assert.equal(verdict.kind, "needs-human", "needs_human gate must yield needs-human verdict");
      assert.equal(readAttempts(store, "task-t2-nh"), 1, "ledger must be incremented on needs_human");
    } finally {
      store.close();
    }
  });
});

test("Story 003 T2 (Epic 019.3) — fail under max → retry-intent verdict, evidence recorded, ledger incremented", async () => {
  await withStore(async (file) => {
    const store = openStore(file, { busyTimeout: 1000 });
    initSchema(store);
    try {
      const result: GateResult = { outcome: "fail", summary: "2 tests red" };
      const verdict = postSessionDecision(store, {
        taskId: "task-t2-fail",
        phase: "tdd",
        gateResult: result,
        maxAttempts: 3,
      });
      assert.equal(verdict.kind, "retry-intent", "fail under max must yield retry-intent verdict");
      assert.equal(readAttempts(store, "task-t2-fail"), 1, "ledger must be incremented on fail");
      const ev = latestEvidence(store, "task-t2-fail");
      assert.notEqual(ev, null, "evidence must be recorded after fail");
      assert.equal(ev?.summary, "2 tests red", "evidence must carry the gate summary");
    } finally {
      store.close();
    }
  });
});

test("Story 003 T2 (Epic 019.3) — fail at max, no grant-one → attempts-exhausted verdict", async () => {
  await withStore(async (file) => {
    const store = openStore(file, { busyTimeout: 1000 });
    initSchema(store);
    try {
      const result: GateResult = { outcome: "fail", summary: "still failing" };
      // Simulate 2 prior dispatches so this is the 3rd (= max)
      postSessionDecision(store, { taskId: "task-t2-max", phase: "tdd", gateResult: result, maxAttempts: 3 });
      postSessionDecision(store, { taskId: "task-t2-max", phase: "tdd", gateResult: result, maxAttempts: 3 });
      const verdict = postSessionDecision(store, {
        taskId: "task-t2-max",
        phase: "tdd",
        gateResult: result,
        maxAttempts: 3,
      });
      assert.equal(verdict.kind, "attempts-exhausted", "fail at max must yield attempts-exhausted verdict");
      assert.equal(
        (verdict as { kind: "attempts-exhausted"; attemptCount: number }).attemptCount,
        3,
        "attempts-exhausted verdict must carry the attempt count",
      );
    } finally {
      store.close();
    }
  });
});

test("Story 003 T2 (Epic 019.3) — fail at max, grant-one active → retry-intent verdict, grant-one cleared", async () => {
  await withStore(async (file) => {
    const store = openStore(file, { busyTimeout: 1000 });
    initSchema(store);
    try {
      const result: GateResult = { outcome: "fail", summary: "still failing" };
      // Hit max: 3 dispatches
      postSessionDecision(store, { taskId: "task-t2-grantone", phase: "tdd", gateResult: result, maxAttempts: 3 });
      postSessionDecision(store, { taskId: "task-t2-grantone", phase: "tdd", gateResult: result, maxAttempts: 3 });
      postSessionDecision(store, { taskId: "task-t2-grantone", phase: "tdd", gateResult: result, maxAttempts: 3 });
      // Operator grants one extra
      grantOne(store, "task-t2-grantone");
      assert.equal(readGrantOne(store, "task-t2-grantone"), true, "grant-one flag must be set");
      // This 4th attempt should be allowed by grant-one
      const verdict = postSessionDecision(store, {
        taskId: "task-t2-grantone",
        phase: "tdd",
        gateResult: result,
        maxAttempts: 3,
      });
      assert.equal(verdict.kind, "retry-intent", "grant-one must allow one extra attempt past max");
      assert.equal(
        readGrantOne(store, "task-t2-grantone"),
        false,
        "grant-one flag must be cleared after consuming the extra attempt",
      );
    } finally {
      store.close();
    }
  });
});

test("Story 003 T2 (Epic 019.3) — recording precedes verdict: evidence row exists immediately after decision call", async () => {
  await withStore(async (file) => {
    const store = openStore(file, { busyTimeout: 1000 });
    initSchema(store);
    try {
      const result: GateResult = { outcome: "fail", summary: "SENTINEL_RECORD_ORDER" };
      const verdict = postSessionDecision(store, {
        taskId: "task-t2-order",
        phase: "tdd",
        gateResult: result,
        maxAttempts: 5,
      });
      // Both recording AND verdict happen in the same synchronous call;
      // the evidence row must exist when we read back immediately after.
      const ev = latestEvidence(store, "task-t2-order");
      assert.notEqual(ev, null, "evidence must be in store immediately after decision call");
      assert.equal(ev?.summary, "SENTINEL_RECORD_ORDER", "evidence row must carry the sentinel summary");
      assert.equal(verdict.kind, "retry-intent", "verdict must still be retry-intent");
    } finally {
      store.close();
    }
  });
});


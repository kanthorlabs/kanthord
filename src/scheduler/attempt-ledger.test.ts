/**
 * Story 003 T1 (Epic 019.3) — durable attempt ledger
 *
 * Seam under test: src/scheduler/attempt-ledger.ts
 *
 * Covers:
 *  - incrementAttempt returns 1, 2, 3 on successive calls
 *  - count survives a simulated daemon restart (fresh Store, same file)
 *  - readAttempts never increments the count
 *  - rearmLedger resets to 0 and returns the prior value
 *  - grantOne marks exactly one extra attempt allowed without changing the count
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import {
  incrementAttempt,
  readAttempts,
  rearmLedger,
  grantOne,
  readGrantOne,
} from "./attempt-ledger.ts";

// ---------------------------------------------------------------------------
// Suite: src/scheduler/attempt-ledger
// ---------------------------------------------------------------------------

test("Story 003 T1 (Epic 019.3) — increment-on-dispatch returns 1, 2, 3 across calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-ledger-"));
  const dbPath = join(dir, "test.db");
  try {
    const store = openStore(dbPath, { busyTimeout: 1000 });
    const c1 = incrementAttempt(store, "task-alpha");
    const c2 = incrementAttempt(store, "task-alpha");
    const c3 = incrementAttempt(store, "task-alpha");
    store.close();

    assert.equal(c1, 1, "first increment must return 1");
    assert.equal(c2, 2, "second increment must return 2");
    assert.equal(c3, 3, "third increment must return 3");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Story 003 T1 (Epic 019.3) — count reads back after a simulated daemon restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-ledger-"));
  const dbPath = join(dir, "test.db");
  try {
    // First handle — record two dispatches
    const store1 = openStore(dbPath, { busyTimeout: 1000 });
    incrementAttempt(store1, "task-beta");
    incrementAttempt(store1, "task-beta");
    store1.close();

    // Second handle — simulates restart; count must survive
    const store2 = openStore(dbPath, { busyTimeout: 1000 });
    const count = readAttempts(store2, "task-beta");
    store2.close();

    assert.equal(count, 2, "attempt count must survive a daemon restart");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Story 003 T1 (Epic 019.3) — a no-op read never increments the count", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-ledger-"));
  const dbPath = join(dir, "test.db");
  try {
    const store = openStore(dbPath, { busyTimeout: 1000 });
    const before = readAttempts(store, "task-gamma");
    readAttempts(store, "task-gamma");
    readAttempts(store, "task-gamma");
    const after = readAttempts(store, "task-gamma");
    store.close();

    assert.equal(before, 0, "readAttempts on a new task must return 0");
    assert.equal(after, 0, "readAttempts must never increment the count");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Story 003 T1 (Epic 019.3) — re-arm resets count to 0 and returns the prior value", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-ledger-"));
  const dbPath = join(dir, "test.db");
  try {
    const store = openStore(dbPath, { busyTimeout: 1000 });
    incrementAttempt(store, "task-delta");
    incrementAttempt(store, "task-delta");
    incrementAttempt(store, "task-delta");

    const prior = rearmLedger(store, "task-delta");
    const afterRearm = readAttempts(store, "task-delta");
    store.close();

    assert.equal(prior, 3, "rearmLedger must return the count before reset");
    assert.equal(afterRearm, 0, "count must be 0 after re-arm");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Story 003 T1 (Epic 019.3) — grant-one marks extra attempt allowed without changing the count", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-ledger-"));
  const dbPath = join(dir, "test.db");
  try {
    const store = openStore(dbPath, { busyTimeout: 1000 });
    incrementAttempt(store, "task-epsilon");
    incrementAttempt(store, "task-epsilon");
    incrementAttempt(store, "task-epsilon");

    const countBeforeGrant = readAttempts(store, "task-epsilon");
    const grantActiveBefore = readGrantOne(store, "task-epsilon");

    grantOne(store, "task-epsilon");

    const countAfterGrant = readAttempts(store, "task-epsilon");
    const grantActiveAfter = readGrantOne(store, "task-epsilon");
    store.close();

    assert.equal(countBeforeGrant, 3, "count must be 3 before grant");
    assert.equal(grantActiveBefore, false, "grant must not be active before grantOne");
    assert.equal(countAfterGrant, 3, "grantOne must not change the dispatch count");
    assert.equal(grantActiveAfter, true, "grant must be active after grantOne");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

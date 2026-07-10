import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { FakeClock } from "../foundations/clock.ts";
import { LeaseManager } from "./leases.ts";
import type { Capability } from "./leases.ts";
import { initSchema } from "../store/schema.ts";

// ---------------------------------------------------------------------------
// Suite: src/scheduler/leases
//
// Each test gets a fresh SQLite temp DB and a FakeClock starting at epoch 0.
// ---------------------------------------------------------------------------

describe("src/scheduler/leases", () => {
  let testDir = "";
  let store: Store;
  let clock: FakeClock;
  let mgr: LeaseManager;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "kanthord-leases-"));
    const dbPath = join(testDir, "test.db");
    store = openStore(dbPath, { busyTimeout: 1000 });
    initSchema(store);
    clock = new FakeClock(0);
    mgr = new LeaseManager(store, clock);
  });

  afterEach(async () => {
    store.close();
    if (testDir) await rm(testDir, { recursive: true, force: true });
    testDir = "";
  });

  // ---------------------------------------------------------------------------
  // T1 — Acquire/serialize on shared capability, concurrency on disjoint
  // ---------------------------------------------------------------------------

  describe("acquire/release — shared vs disjoint capabilities", () => {
    test("disjoint write_scope: both tasks acquire simultaneously", () => {
      const iosScope: Capability = { kind: "write_scope", path: "ios/**" };
      const macosScope: Capability = { kind: "write_scope", path: "macos/**" };

      const got1 = mgr.acquire("task-1", [iosScope]);
      const got2 = mgr.acquire("task-2", [macosScope]);

      assert.equal(got1, true, "task-1 should acquire ios/** immediately");
      assert.equal(got2, true, "task-2 should acquire macos/** simultaneously (disjoint)");
    });

    test("ios/** and ios/foo/** overlap: second task blocks", () => {
      const iosAll: Capability = { kind: "write_scope", path: "ios/**" };
      const iosFoo: Capability = { kind: "write_scope", path: "ios/foo/**" };

      const got1 = mgr.acquire("task-1", [iosAll]);
      assert.equal(got1, true, "task-1 should acquire ios/**");

      const got2 = mgr.acquire("task-2", [iosFoo]);
      assert.equal(got2, false, "task-2 should block: ios/foo/** overlaps ios/**");
    });

    test("ios/** and ios2/** are disjoint: both acquire simultaneously", () => {
      const iosAll: Capability = { kind: "write_scope", path: "ios/**" };
      const ios2All: Capability = { kind: "write_scope", path: "ios2/**" };

      const got1 = mgr.acquire("task-1", [iosAll]);
      const got2 = mgr.acquire("task-2", [ios2All]);

      assert.equal(got1, true, "task-1 should acquire ios/**");
      assert.equal(got2, true, "task-2 should acquire ios2/** (disjoint, not a prefix of ios/**)");
    });

    test("ios and ios/ canonicalize to the same scope: second task blocks", () => {
      const iosNoSlash: Capability = { kind: "write_scope", path: "ios" };
      const iosSlash: Capability = { kind: "write_scope", path: "ios/" };

      const got1 = mgr.acquire("task-1", [iosNoSlash]);
      assert.equal(got1, true, "task-1 should acquire ios");

      const got2 = mgr.acquire("task-2", [iosSlash]);
      assert.equal(got2, false, "task-2 should block: ios/ canonicalizes to same scope as ios");
    });

    test("same resource key: second task blocks until first releases", () => {
      const port5432: Capability = { kind: "resource", key: "ports:5432" };

      const got1 = mgr.acquire("task-1", [port5432]);
      assert.equal(got1, true, "task-1 should acquire ports:5432");

      const got2 = mgr.acquire("task-2", [port5432]);
      assert.equal(got2, false, "task-2 should block on same resource key ports:5432");
    });

    test("release then acquire in the same poll pass: waiter acquires immediately after holder releases", () => {
      const scope: Capability = { kind: "write_scope", path: "ios/**" };

      mgr.acquire("task-1", [scope]);

      const blockedBefore = mgr.acquire("task-2", [scope]);
      assert.equal(blockedBefore, false, "task-2 blocks while task-1 holds the lease");

      mgr.release("task-1");

      const acquiredAfter = mgr.acquire("task-2", [scope]);
      assert.equal(acquiredAfter, true, "task-2 acquires within the same poll pass after task-1 releases");
    });

    test("atomic all-or-nothing: failing on one capability leaves no partial lease rows for other capabilities", () => {
      const writeScopeA: Capability = { kind: "write_scope", path: "android/**" };
      const port5432: Capability = { kind: "resource", key: "ports:5432" };

      // task-1 holds ports:5432
      mgr.acquire("task-1", [port5432]);

      // task-2 needs android/** AND ports:5432 but ports:5432 is taken
      const atomicResult = mgr.acquire("task-2", [writeScopeA, port5432]);
      assert.equal(atomicResult, false, "task-2 fails to acquire all capabilities (ports:5432 is held)");

      // No partial lease: android/** must be free for task-3
      const task3Result = mgr.acquire("task-3", [writeScopeA]);
      assert.equal(task3Result, true, "android/** is free — task-2 holds no partial lease");
    });
  });

  // ---------------------------------------------------------------------------
  // T2 — Expiry + heartbeat reclaim
  // ---------------------------------------------------------------------------

  describe("expiry + heartbeat", () => {
    test("expired lease (past expires_at with no heartbeat) is reclaimable: waiter acquires", () => {
      const scope: Capability = { kind: "write_scope", path: "ios/**" };

      // task-1 acquires at t=0; default TTL is 30 000 ms → expires_at = 30 000
      mgr.acquire("task-1", [scope]);

      // task-2 is blocked while the lease is live
      assert.equal(mgr.acquire("task-2", [scope]), false, "task-2 blocks before expiry");

      // advance clock past expiry: now = 30 001 > expires_at = 30 000
      clock.advance(30_001);

      // expired lease must be reclaimable — task-2 should now acquire
      assert.equal(
        mgr.acquire("task-2", [scope]),
        true,
        "task-2 acquires after task-1's lease has expired (no heartbeat)",
      );
    });

    test("heartbeat before expiry extends the lease: waiter stays blocked past original expiry", () => {
      const scope: Capability = { kind: "write_scope", path: "ios/**" };

      // task-1 acquires at t=0; default TTL → expires_at = 30 000
      mgr.acquire("task-1", [scope]);

      // heartbeat at t=15 000 — must extend expires_at beyond 30 001
      clock.advance(15_000);
      mgr.heartbeat("task-1");

      // advance past the *original* expiry (total clock = 30 001)
      clock.advance(15_001);

      // waiter must still be blocked: heartbeat extended the lease
      assert.equal(
        mgr.acquire("task-2", [scope]),
        false,
        "task-2 stays blocked past original expiry because task-1 sent a heartbeat",
      );
    });
  });
});

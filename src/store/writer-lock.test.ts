/**
 * src/store/writer-lock.test.ts
 *
 * Story 012-002 Task T1 — Acquire / reject / release
 * Story 012-002 Task T2 — Stale-lock takeover
 * Reviewer finding B1 — concurrent stale-lock takeover single-winner atomicity
 *
 * Tests that:
 *   (a) a first write-open acquires the lock and records token + pid + acquired-at;
 *   (b) a second write-open on the same root throws a typed store-locked error;
 *   (c) two concurrent acquire attempts yield exactly one winner (O_EXCL atomicity);
 *   (d) after close, write-open succeeds and a fresh lock is held;
 *   (e) close with a mismatched token does not release the lock;
 *   (f) read-only open succeeds while the lock is held.
 *   T2:
 *   (g) with a dead holder, acquire succeeds and rewrites the lock with a new token;
 *   (h) takeover appends a takeover event to the store journal;
 *   (i) a probe returning EPERM is treated as alive — no takeover (fail-safe).
 *   B1:
 *   (j) two concurrent stale-lock takeovers yield exactly one winner (single-writer invariant);
 *       the loser receives a StoreLocked error, and the lock file holds only one token.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { unlinkSync, openSync, writeSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LivenessProbe } from "./writer-lock.ts";
import { WriterLock, StoreLocked } from "./writer-lock.ts";

describe("src/store/writer-lock — Story 012-002 Task T1", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-wlock-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("first write-open acquires the lock and persists token, pid, acquired-at", async () => {
    const lock = new WriterLock(tmpDir);
    await lock.acquire();

    const lockPath = join(tmpDir, ".kanthord-writer-lock");
    const raw = JSON.parse(await readFile(lockPath, "utf8")) as {
      token: string;
      pid: number;
      acquiredAt: string;
    };

    assert.equal(typeof raw.token, "string");
    assert.ok(raw.token.length > 0, "token must be non-empty");
    assert.equal(raw.pid, process.pid);
    const acquired = new Date(raw.acquiredAt);
    assert.ok(
      !isNaN(acquired.getTime()),
      "acquiredAt must be a valid ISO date string",
    );

    await lock.release(raw.token);
  });

  test("second write-open on the same root throws StoreLocked naming holder", async () => {
    const lockA = new WriterLock(tmpDir);
    const beforeAcquire = new Date();
    const tokenA = await lockA.acquire();

    const lockB = new WriterLock(tmpDir);
    await assert.rejects(
      () => lockB.acquire(),
      (err: unknown) => {
        assert.ok(err instanceof StoreLocked, "must throw StoreLocked");
        const locked = err as StoreLocked;
        assert.equal(locked.code, "store-locked");
        // The error message must name the holder token, pid, AND acquired-at
        // (Story 002 AC: "named holder token + pid + acquired-at").
        assert.ok(
          locked.message.includes(tokenA),
          `message must include holder token, got: ${locked.message}`,
        );
        assert.ok(
          locked.message.includes(String(process.pid)),
          `message must include holder pid, got: ${locked.message}`,
        );
        // acquired-at: the message must contain a full ISO timestamp (with ms + Z)
        // parseable as a date >= beforeAcquire (coarse check — confirms presence).
        // Regex captures the full ISO-8601 form: YYYY-MM-DDTHH:MM:SS.mmmZ
        const isoMatch = locked.message.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/);
        assert.ok(
          isoMatch !== null,
          `message must include an ISO acquired-at timestamp, got: ${locked.message}`,
        );
        const parsedAt = new Date(isoMatch![0]);
        assert.ok(
          !isNaN(parsedAt.getTime()),
          `acquired-at in message must be a valid date, got: ${isoMatch![0]}`,
        );
        assert.ok(
          parsedAt >= beforeAcquire,
          `acquired-at must be >= acquisition time, got: ${isoMatch![0]}`,
        );
        return true;
      },
    );

    await lockA.release(tokenA);
  });

  test("two concurrent acquire attempts yield exactly one winner (O_EXCL atomicity)", async () => {
    const results = await Promise.allSettled([
      new WriterLock(tmpDir).acquire(),
      new WriterLock(tmpDir).acquire(),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1, "exactly one acquirer must win");
    assert.equal(rejected.length, 1, "exactly one acquirer must lose");

    const winner = fulfilled[0];
    assert.ok(winner !== undefined && winner.status === "fulfilled");
    // Release the winner so the temp dir cleanup can proceed.
    const winnerLock = new WriterLock(tmpDir);
    // We can't easily release via the winner reference (no handle), but the
    // lock file cleanup happens via rm(tmpDir) in afterEach; this is fine.
    void winner.value; // ensure the token exists (non-undefined)
    assert.equal(typeof winner.value, "string");
  });

  test("after release the same root can be locked again", async () => {
    const lock1 = new WriterLock(tmpDir);
    const token1 = await lock1.acquire();
    await lock1.release(token1);

    const lock2 = new WriterLock(tmpDir);
    const token2 = await lock2.acquire();
    assert.equal(typeof token2, "string");
    assert.ok(token2.length > 0, "second lock token must be non-empty");

    await lock2.release(token2);
  });

  test("release with a mismatched token does not remove the lock file", async () => {
    const lock = new WriterLock(tmpDir);
    const realToken = await lock.acquire();

    // Attempt to release with wrong token — must not throw but must not clear.
    await lock.release("wrong-token-xyz");

    // Lock file must still exist and still hold the real token.
    const lockPath = join(tmpDir, ".kanthord-writer-lock");
    const raw = JSON.parse(await readFile(lockPath, "utf8")) as {
      token: string;
    };
    assert.equal(raw.token, realToken, "lock file must still hold real token");

    await lock.release(realToken);
  });

  test("read-only open succeeds while a writer holds the lock", async () => {
    const writerLock = new WriterLock(tmpDir);
    const writerToken = await writerLock.acquire();

    // A read-only open must not throw.
    const readonlyLock = new WriterLock(tmpDir, { readOnly: true });
    await assert.doesNotReject(() => readonlyLock.acquire());

    // Releasing a read-only lock is a no-op — no token needed.
    await readonlyLock.release(null);

    await writerLock.release(writerToken);
  });
});

describe("src/store/writer-lock — Story 012-002 Task T2", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-wlock-t2-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("stale lock with dead holder: acquire succeeds and rewrites lock with new token", async () => {
    // Arrange: place a stale lock file whose holder is reported dead.
    const staleToken = "stale-token-dead-holder";
    const stalePid = 99999; // Arbitrarily large; probe will report dead.
    const lockPath = join(tmpDir, ".kanthord-writer-lock");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      lockPath,
      JSON.stringify({ token: staleToken, pid: stalePid, acquiredAt: new Date().toISOString() }),
      "utf8",
    );

    // Liveness probe: always reports the holder as dead.
    const deadProbe: LivenessProbe = (_pid: number) => false;

    const newLock = new WriterLock(tmpDir, { livenessProbe: deadProbe });
    const newToken = await newLock.acquire();

    // Must have a new, different token.
    assert.ok(newToken.length > 0, "new token must be non-empty");
    assert.notEqual(newToken, staleToken, "new token must differ from stale token");

    // Lock file must now record the new token.
    const raw = JSON.parse(await readFile(lockPath, "utf8")) as { token: string; pid: number };
    assert.equal(raw.token, newToken, "lock file must hold new token");
    assert.equal(raw.pid, process.pid, "lock file must hold current pid");

    await newLock.release(newToken);
  });

  test("stale lock takeover appends a takeover event to the store journal", async () => {
    // Arrange: place a stale lock file.
    const staleToken = "stale-token-for-journal";
    const stalePid = 99998;
    const lockPath = join(tmpDir, ".kanthord-writer-lock");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      lockPath,
      JSON.stringify({ token: staleToken, pid: stalePid, acquiredAt: new Date().toISOString() }),
      "utf8",
    );

    const deadProbe: LivenessProbe = (_pid: number) => false;
    const newLock = new WriterLock(tmpDir, { livenessProbe: deadProbe });
    const newToken = await newLock.acquire();

    // The store journal must contain a takeover record.
    const journalPath = join(tmpDir, ".kanthord-store.journal.jsonl");
    const journalRaw = await readFile(journalPath, "utf8");
    const lines = journalRaw.trim().split("\n").filter((l) => l.length > 0);
    assert.ok(lines.length >= 1, "journal must have at least one entry after takeover");

    const entry = JSON.parse(lines[lines.length - 1]!) as {
      event: string;
      stalePid?: number;
      staleToken?: string;
    };
    assert.equal(entry.event, "lock-takeover", "journal entry must have event=lock-takeover");
    assert.equal(entry.stalePid, stalePid, "journal entry must name the stale pid");
    assert.equal(entry.staleToken, staleToken, "journal entry must name the stale token");

    await newLock.release(newToken);
  });

  test("liveness probe returning EPERM is treated as alive — no takeover", async () => {
    // Arrange: place a stale-looking lock file.
    const existingToken = "existing-token-eperm";
    const existingPid = 99997;
    const lockPath = join(tmpDir, ".kanthord-writer-lock");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      lockPath,
      JSON.stringify({ token: existingToken, pid: existingPid, acquiredAt: new Date().toISOString() }),
      "utf8",
    );

    // Liveness probe returns EPERM — fail-safe: treat as alive.
    const epermProbe: LivenessProbe = (_pid: number) => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); };

    const challenger = new WriterLock(tmpDir, { livenessProbe: epermProbe });
    await assert.rejects(
      () => challenger.acquire(),
      (err: unknown) => {
        assert.ok(err instanceof StoreLocked, "must throw StoreLocked when probe is EPERM");
        return true;
      },
    );

    // Lock file must still hold the original token (no takeover occurred).
    const raw = JSON.parse(await readFile(lockPath, "utf8")) as { token: string };
    assert.equal(raw.token, existingToken, "lock file must be unchanged after EPERM probe");
  });
});

// ---------------------------------------------------------------------------
// Suite: Reviewer Finding B1 (fourth review) — stale-lock takeover must not
//        delete a freshly-created lock from a concurrent winner
//
// The race the reviewer describes (unlink-then-open): if racer A wins open("wx"),
// a racing racer B that held the same stale token still calls unlink — AFTER A's
// new lock is in place — and can destroy A's lock, then win its own open("wx"),
// yielding two holders.  This suite verifies that the implementation prevents
// this specific window.
// ---------------------------------------------------------------------------

describe("src/store/writer-lock — B1(4th) stale-takeover must not unlink a concurrent winner's lock", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-wlock-b1-4-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // (B1-k) Simulate the exact race window:
  //   1. B reads the stale lock file (pid = stalePid → cached as "dead holder")
  //   2. While the liveness probe is in-flight, A simultaneously takes over
  //      the lock (unlinks stale, creates new lock with aToken + aPid).
  //   3. The probe returns false (dead) for stalePid.
  //   4. B proceeds to unlink — in the buggy implementation this deletes A's
  //      new lock, not the stale one — and then B opens("wx"), claiming a
  //      second token → two holders!
  //
  // We simulate step 2 as a side effect inside the probe: by the time the
  // probe returns, A's lock is fully in place.  A correct implementation
  // must re-check the token before unlinking (or use an approach that cannot
  // destroy a lock it doesn't own) so that B throws StoreLocked.
  test("acquire() with dead-probe does not unlink a concurrent winner's lock installed while probe ran", async () => {
    const { writeFile: fsWrite } = await import("node:fs/promises");

    const staleToken = "stale-for-b1-4th";
    const stalePid = 77777;
    const lockPath = join(tmpDir, ".kanthord-writer-lock");

    // Place the stale lock that B will read.
    await fsWrite(
      lockPath,
      JSON.stringify({ token: staleToken, pid: stalePid, acquiredAt: new Date().toISOString() }),
      "utf8",
    );

    // aToken is the new holder that racer A creates while B's probe is running.
    const aToken = "winner-token-racer-a";

    // The probe is the injection point for the race side-effect.
    // When B calls probe(stalePid), it means B has already read the stale lock
    // and is about to decide "dead → unlink".  We use this synchronous hook to
    // perform A's complete takeover so that by the time the probe returns,
    // the lock file holds A's token — not the stale one.
    let probeCalledCount = 0;
    const raceSideEffectProbe: LivenessProbe = (pid: number) => {
      probeCalledCount++;
      // Only inject the race once — for the stale pid that B read.
      if (pid === stalePid) {
        // Simulate racer A: synchronously replace the stale lock with A's new
        // lock.  We use sync ops because LivenessProbe is synchronous.
        try { unlinkSync(lockPath); } catch { /* ENOENT ok */ }
        const fd = openSync(lockPath, "wx");
        writeSync(fd, JSON.stringify({ token: aToken, pid: process.pid, acquiredAt: new Date().toISOString() }), 0, "utf8");
        closeSync(fd);
        // Return false: B believes the stale holder is dead and proceeds to unlink.
        return false;
      }
      // For any other pid (e.g., process.pid = alive), return true.
      return true;
    };

    // Racer B acquires — its probe fires, A's takeover happens inside,
    // then B tries to unlink + open("wx").
    // Expected (correct): B sees that the lock token has changed from the
    // stale value it read and throws StoreLocked — NOT returns a token.
    const racerB = new WriterLock(tmpDir, { livenessProbe: raceSideEffectProbe });
    await assert.rejects(
      () => racerB.acquire(),
      (err: unknown) => {
        assert.ok(err instanceof StoreLocked, `racer B must throw StoreLocked after A's takeover, got: ${String(err)}`);
        return true;
      },
    );

    // The probe must have been called exactly once (for stalePid).
    assert.equal(probeCalledCount, 1, "probe must be called exactly once");

    // The lock file must still hold A's token — B must not have unlinked it.
    const stored = JSON.parse(await readFile(lockPath, "utf8")) as { token: string };
    assert.equal(stored.token, aToken, "lock file must still hold racer A's token — B must not have unlinked it");
  });
});

// ---------------------------------------------------------------------------
// Suite: Reviewer Finding B1 (second review) — concurrent stale-lock takeover
//        must yield exactly one winner (single-writer invariant on takeover path)
// ---------------------------------------------------------------------------

describe("src/store/writer-lock — B1 concurrent stale-lock takeover single-winner", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-wlock-b1-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // (B1-j) Two concurrent callers both see a stale lock (dead holder) and race to
  //         take it over.  Exactly one must win (return a token); the loser must
  //         throw StoreLocked.  The lock file must record exactly the winner's token
  //         so the resource is never doubly-claimed.
  test("two concurrent stale-lock takeovers yield exactly one winner", async () => {
    const { writeFile: fsWrite } = await import("node:fs/promises");

    // Arrange: place a stale lock that both racers will try to replace.
    const staleToken = "stale-token-concurrent-takeover";
    const stalePid = 88888;
    const lockPath = join(tmpDir, ".kanthord-writer-lock");
    await fsWrite(
      lockPath,
      JSON.stringify({ token: staleToken, pid: stalePid, acquiredAt: new Date().toISOString() }),
      "utf8",
    );

    // Probe: always reports dead — both racers see the holder as dead.
    const deadProbe: LivenessProbe = (_pid: number) => false;

    // Launch two concurrent takeover attempts.
    const results = await Promise.allSettled([
      new WriterLock(tmpDir, { livenessProbe: deadProbe }).acquire(),
      new WriterLock(tmpDir, { livenessProbe: deadProbe }).acquire(),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected  = results.filter((r) => r.status === "rejected");

    // Exactly one winner, exactly one loser.
    assert.equal(fulfilled.length, 1, "exactly one takeover must succeed");
    assert.equal(rejected.length,  1, "exactly one takeover must lose");

    // The loser must throw StoreLocked (not any other error).
    const loser = rejected[0];
    assert.ok(loser !== undefined && loser.status === "rejected");
    assert.ok(
      loser.reason instanceof StoreLocked,
      `loser must throw StoreLocked, got: ${loser.reason}`,
    );

    // The winner's token must be in the lock file (and must differ from the stale token).
    const winner = fulfilled[0];
    assert.ok(winner !== undefined && winner.status === "fulfilled");
    const winnerToken = winner.value;
    assert.ok(winnerToken.length > 0, "winner token must be non-empty");
    assert.notEqual(winnerToken, staleToken, "winner token must differ from stale token");

    const stored = JSON.parse(await readFile(lockPath, "utf8")) as { token: string };
    assert.equal(stored.token, winnerToken, "lock file must hold the winner's token");
  });
});

// ---------------------------------------------------------------------------
// Suite: Reviewer Finding B1 (6th review) — a leftover claim file from a
// crashed process must NOT permanently block stale-lock takeover.
//
// The claim-file mutex (.kanthord-writer-lock.takeover-in-progress) is created
// before the critical section and removed in a finally block.  But if the Node
// process crashes (SIGKILL, OOM) between creation and removal, the claim file is
// left behind.  Future stale-lock takeover attempts see EEXIST on the claim path
// and throw StoreLocked immediately — the store is permanently deadlocked.
// ---------------------------------------------------------------------------

describe("src/store/writer-lock — B1(6th) leftover claim file must not deadlock stale-lock takeover", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-wlock-b1-6-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // (B1-6th) Simulate a crashed takeover: claim file exists but has no owner
  // (lock file still holds the stale token, claim-file owner is dead/unknown).
  // A fresh acquire() with a dead-probe MUST still succeed — the orphaned claim
  // file must not be treated as a live lock holder.
  test("acquire() with dead-probe succeeds when an orphaned claim file is present", async () => {
    const { writeFile: fsWrite } = await import("node:fs/promises");

    const staleToken = "stale-for-b1-6th";
    const stalePid = 66666;
    const lockPath = join(tmpDir, ".kanthord-writer-lock");
    const claimPath = lockPath + ".takeover-in-progress";

    // Place the stale lock (dead holder).
    await fsWrite(
      lockPath,
      JSON.stringify({ token: staleToken, pid: stalePid, acquiredAt: new Date().toISOString() }),
      "utf8",
    );

    // Place the orphaned claim file simulating a crash between claim creation
    // and the finally-block removal — its owner is gone (stale pid too).
    await fsWrite(claimPath, "", "utf8");

    const deadProbe: LivenessProbe = () => false;

    // A fresh acquire() must succeed despite the orphaned claim file.
    const wl = new WriterLock(tmpDir, { livenessProbe: deadProbe });
    let token: string;
    await assert.doesNotReject(async () => {
      token = await wl.acquire();
    }, "acquire() must succeed even when an orphaned claim file is present");

    // After a successful orphan-recovery takeover the claim file STAYS on disk
    // until release() is called.  This is intentional: the claim file acts as a
    // concurrent-takeover guard for the entire lock-held period — any late racer
    // that arrives (even after acquire() returns) will see the live claim and
    // throw StoreLocked, preventing a second holder from forming.
    const claimExistsAfterAcquire = await import("node:fs/promises").then(({ stat }) =>
      stat(claimPath).then(() => true).catch(() => false)
    );
    assert.equal(claimExistsAfterAcquire, true, "claim file must remain on disk after orphan-recovery takeover (mutex guard until release)");

    // The lock file must hold the new token (not the stale one).
    const stored = JSON.parse(await readFile(lockPath, "utf8")) as { token: string };
    assert.notEqual(stored.token, staleToken, "lock file must hold new token after takeover");

    // After release() the claim file must be absent (mutex window closed).
    await wl.release(token!);
    const claimExistsAfterRelease = await import("node:fs/promises").then(({ stat }) =>
      stat(claimPath).then(() => true).catch(() => false)
    );
    assert.equal(claimExistsAfterRelease, false, "claim file must be removed by release() after orphan-recovery takeover");
  });
});

// ---------------------------------------------------------------------------
// Suite: Reviewer Finding B1 (8th review) — orphaned-claim recovery must not
// delete a concurrently-created live claim.
//
// Race window: Racer B sees EEXIST on the claim file, reads it, decides it is
// orphaned (empty content — written between open and writeFile by another racer
// that was killed), and calls unlink(claimPath).  Between B's read-complete and
// B's unlink, Racer A may have created a fresh live claim at the same path.
// B's unlink destroys A's live claim, both proceed through the critical section,
// and two holder tokens are returned simultaneously.
//
// The fix must verify the claim content has not changed before unlink.
// ---------------------------------------------------------------------------

describe("src/store/writer-lock — B1(8th) orphaned-claim recovery must not clobber a concurrent live claim", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-wlock-b1-8-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // (B1-8th) Pre-place BOTH a stale lock AND an orphaned claim file (empty).
  // 5 concurrent dead-probe racers all see the EEXIST on the claim and all
  // independently decide the claim is orphaned.  They race to unlink and re-claim.
  // The current code unlinks without verifying the claim is still the same file,
  // so when a concurrent racer's newly-created (but not yet PID-written) claim
  // is mistaken for the same orphan and unlinked, multiple racers enter the
  // critical section.  Exactly 1 winner must emerge.
  test("concurrent orphan-claim recovery with pre-placed empty claim yields exactly one winner", async () => {
    const { writeFile: fsWrite } = await import("node:fs/promises");

    const staleToken = "stale-for-b1-8th";
    const stalePid = 99991;
    const lockPath = join(tmpDir, ".kanthord-writer-lock");
    const claimPath = lockPath + ".takeover-in-progress";

    const deadProbe: LivenessProbe = () => false;

    // Repeat 10× to expose the probabilistic race.
    for (let round = 0; round < 10; round++) {
      // Reinstall stale lock each round.
      await fsWrite(
        lockPath,
        JSON.stringify({ token: staleToken, pid: stalePid, acquiredAt: new Date().toISOString() }),
        "utf8",
      );
      // Pre-place an orphaned claim file (empty content — simulates crash between
      // claim-open and claim-writeFile, leaving a zero-byte file on disk).
      await fsWrite(claimPath, "", "utf8");

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          new WriterLock(tmpDir, { livenessProbe: deadProbe }).acquire()
        ),
      );

      const winners = results.filter((r) => r.status === "fulfilled");
      const losers  = results.filter((r) => r.status === "rejected");

      assert.equal(
        winners.length,
        1,
        `round ${round}: exactly 1 takeover winner expected, got ${winners.length}`,
      );
      assert.equal(
        losers.length,
        4,
        `round ${round}: exactly 4 losers expected, got ${losers.length}`,
      );

      for (const loser of losers) {
        assert.ok(
          loser.status === "rejected" && loser.reason instanceof StoreLocked,
          `round ${round}: each loser must throw StoreLocked`,
        );
      }

      // Release winner's lock before next round.
      const winner = winners[0];
      if (winner?.status === "fulfilled") {
        const wl = new WriterLock(tmpDir);
        await wl.release(winner.value);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: Reviewer Finding B1 (5th review) — stale-takeover with N concurrent
// racers must still yield exactly one winner.
//
// The 2-racer B1-concurrent test passes, but with ≥3 concurrent stale-takeover
// racers the re-read+unlink window allows multiple winners: racer B's re-read
// completes (sees stale token = match), racer C completes its entire unlink +
// O_EXCL + write between B's re-read and B's unlink, then B unlinks C's new
// lock and also wins O_EXCL.  Two holder tokens exist simultaneously.
// ---------------------------------------------------------------------------

describe("src/store/writer-lock — B1(5th) stale-takeover N-concurrent single-winner", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-wlock-b1-5-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // (B1-5th) 5 concurrent stale-takeover racers must yield exactly 1 winner.
  // Repeated 10× to reliably expose the probabilistic re-read+unlink race window:
  // with 5 concurrent racers each round, the race manifests predictably.
  test("5 concurrent stale-takeover attempts yield exactly one winner", async () => {
    const { writeFile: fsWrite } = await import("node:fs/promises");

    const staleToken = "stale-5-concurrent";
    const stalePid = 77779;
    const lockPath = join(tmpDir, ".kanthord-writer-lock");

    const deadProbe: LivenessProbe = () => false;

    // Repeat the race 10 times in the same dir (reinstall stale lock each round).
    for (let round = 0; round < 10; round++) {
      await fsWrite(
        lockPath,
        JSON.stringify({ token: staleToken, pid: stalePid, acquiredAt: new Date().toISOString() }),
        "utf8",
      );

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          new WriterLock(tmpDir, { livenessProbe: deadProbe }).acquire()
        ),
      );

      const winners = results.filter((r) => r.status === "fulfilled");
      const losers  = results.filter((r) => r.status === "rejected");

      assert.equal(
        winners.length,
        1,
        `round ${round}: exactly 1 takeover winner expected, got ${winners.length}`,
      );
      assert.equal(
        losers.length,
        4,
        `round ${round}: exactly 4 losers expected, got ${losers.length}`,
      );

      // Losers must all throw StoreLocked.
      for (const loser of losers) {
        assert.ok(
          loser.status === "rejected" && loser.reason instanceof StoreLocked,
          `round ${round}: each loser must throw StoreLocked`,
        );
      }

      // Release the winner's lock before next round.
      const winner = winners[0];
      if (winner?.status === "fulfilled") {
        const wl = new WriterLock(tmpDir);
        await wl.release(winner.value);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: Reviewer Finding B1 (7th review) — claim-file liveness must use the
// OS-level process check, NOT the injected livenessProbe.
//
// When a concurrent racer holds the claim file, its PID is the current
// process.pid.  If the claim-file orphan check uses the injected
// livenessProbe (which may be a test double returning `false` for all PIDs),
// a live claim holder looks dead and is treated as an orphan — any concurrent
// racer can unlink and re-claim, yielding multiple takeover winners.
//
// The fix: the claim-file PID check must use `defaultLivenessProbe` (OS-level
// `process.kill(pid, 0)`) unconditionally, regardless of the injected probe.
// ---------------------------------------------------------------------------

describe("src/store/writer-lock — B1(7th) claim-file liveness uses OS probe, not injected probe", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-wlock-b1-7-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // (B1-7th) When the injected livenessProbe always returns false, a live
  // claim file (owned by process.pid — the current process) must still be
  // treated as live: acquire() must throw StoreLocked, not proceed as orphan.
  test("claim-file with current process.pid is treated as live even when injected probe says dead", async () => {
    const { writeFile: fsWrite } = await import("node:fs/promises");

    const staleToken = "stale-for-b1-7th";
    const stalePid = 88881;
    const lockPath = join(tmpDir, ".kanthord-writer-lock");
    const claimPath = lockPath + ".takeover-in-progress";

    // Place a stale lock (dead holder).
    await fsWrite(
      lockPath,
      JSON.stringify({ token: staleToken, pid: stalePid, acquiredAt: new Date().toISOString() }),
      "utf8",
    );

    // Place a claim file owned by the CURRENT process (simulating a live concurrent racer).
    await fsWrite(
      claimPath,
      JSON.stringify({ pid: process.pid }),
      "utf8",
    );

    // Use a dead probe that always returns false — including for process.pid.
    const deadProbe: LivenessProbe = () => false;

    // acquire() must throw StoreLocked because the claim holder (process.pid)
    // is alive — the OS can confirm it.  The injected dead probe must NOT be
    // used for claim-file liveness.
    const wl = new WriterLock(tmpDir, { livenessProbe: deadProbe });
    await assert.rejects(
      () => wl.acquire(),
      (err: unknown) => {
        assert.ok(err instanceof StoreLocked, "must throw StoreLocked");
        return true;
      },
      "acquire() must throw StoreLocked when claim holder is the current (live) process",
    );

    // The claim file must still be present (we did not touch it).
    const claimExists = await import("node:fs/promises").then(({ stat }) =>
      stat(claimPath).then(() => true).catch(() => false)
    );
    assert.equal(claimExists, true, "claim file must be intact after rejected acquire");
  });
});

// ---------------------------------------------------------------------------
// Suite: Human decision S2 — malformed/unreadable lock files are fail-safe
// locked (no automatic recovery for corrupt locks).
//
// Story 002 AC: stale-lock recoverability requires a readable lock file with
// a parseable holder PID.  Corrupt/malformed lock files (empty, non-JSON,
// missing fields, directory, permission-denied) MUST be treated as held —
// the lock is fail-safe locked and acquire() must throw StoreLocked.
//
// Regression coverage: proves the existing "assume alive" fallback at
// writer-lock.ts:121-123 is not accidentally removed and that no automatic
// recovery path bypasses it.
// ---------------------------------------------------------------------------

describe("src/store/writer-lock — S2 malformed lock files are fail-safe locked", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-wlock-s2-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // (S2-a) Empty lock file — not parseable, no PID → fail-safe locked.
  test("empty lock file is treated as held — acquire throws StoreLocked", async () => {
    const lockPath = join(tmpDir, ".kanthord-writer-lock");
    // Write an empty lock file (simulates a crash immediately after O_EXCL create
    // but before the payload was written).
    const fd = openSync(lockPath, "wx");
    closeSync(fd);

    const wl = new WriterLock(tmpDir);
    await assert.rejects(
      () => wl.acquire(),
      (err: unknown) => {
        assert.ok(err instanceof StoreLocked, "must throw StoreLocked");
        assert.equal(err.code, "store-locked");
        return true;
      },
      "empty lock file must be treated as held (fail-safe)",
    );

    // Lock file must still exist — no automatic deletion occurred.
    const lockExists = await readFile(lockPath, "utf8").then(() => true).catch(() => false);
    assert.equal(lockExists, true, "empty lock file must remain on disk — no automatic recovery");
  });

  // (S2-b) Non-JSON content in lock file — not parseable → fail-safe locked.
  test("non-JSON lock file is treated as held — acquire throws StoreLocked", async () => {
    const lockPath = join(tmpDir, ".kanthord-writer-lock");
    const fd = openSync(lockPath, "wx");
    writeSync(fd, "THIS IS NOT JSON");
    closeSync(fd);

    const wl = new WriterLock(tmpDir);
    await assert.rejects(
      () => wl.acquire(),
      (err: unknown) => {
        assert.ok(err instanceof StoreLocked, "must throw StoreLocked");
        assert.equal(err.code, "store-locked");
        return true;
      },
      "non-JSON lock file must be treated as held (fail-safe)",
    );

    const content = await readFile(lockPath, "utf8");
    assert.equal(content, "THIS IS NOT JSON", "non-JSON lock file must remain unchanged — no automatic recovery");
  });

  // (S2-c) Valid JSON but missing required `pid` field — cannot probe liveness,
  //        no PID → fail-safe locked.
  test("lock file with missing pid field is treated as held — acquire throws StoreLocked", async () => {
    const lockPath = join(tmpDir, ".kanthord-writer-lock");
    const fd = openSync(lockPath, "wx");
    writeSync(fd, JSON.stringify({ token: "tok-no-pid", acquiredAt: new Date().toISOString() }));
    closeSync(fd);

    const wl = new WriterLock(tmpDir);
    await assert.rejects(
      () => wl.acquire(),
      (err: unknown) => {
        assert.ok(err instanceof StoreLocked, "must throw StoreLocked");
        assert.equal(err.code, "store-locked");
        return true;
      },
      "lock file with no pid must be treated as held (fail-safe)",
    );

    const raw = JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
        assert.equal(raw["token"], "tok-no-pid", "lock file must remain unchanged — no automatic recovery");
  });
});

// ---------------------------------------------------------------------------
// Suite: Reviewer Finding B1 — orphan-claim recovery keeps mutex held for the
// entire takeover critical section (Steps 2+3).
//
// The gap: after the orphan-recovery winner calls `unlink(claimPath)` it uses a
// placeholder claimHandle and proceeds to Step 2+3 WITHOUT the claim file on
// disk.  A fresh/late racer arriving NOW finds no claim, creates one via
// open("wx"), and also enters Step 2+3 concurrently — both can overwrite
// `.kanthord-writer-lock`, yielding two holder tokens simultaneously.
//
// Proof: launch N concurrent stale-takeover racers where the claim file is
// orphaned (empty content, dead PID) so all racers trigger the orphan-unlink
// path.  Then inject a "late" fresh racer that starts after a setImmediate
// delay (giving the early winner time to enter its critical section before the
// late racer finds no claim file).  Exactly 1 winner must emerge across BOTH
// groups and the lock file must contain exactly one token.
// ---------------------------------------------------------------------------

describe("src/store/writer-lock — B1 orphan-claim recovery keeps mutex for entire critical section", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-wlock-b1-mutex-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // (B1-mutex) The orphan-recovery winner unlinking the claim creates a window
  // where the claim path is absent from disk.  Any new racer arriving in that
  // window can create a fresh claim with open("wx") and enter Steps 2+3
  // concurrently with the orphan-recovery winner — both could overwrite
  // `.kanthord-writer-lock`, yielding two holder tokens simultaneously.
  //
  // Scenario: pre-place a stale lock AND an orphaned claim file (empty, dead PID).
  // Launch an early batch + a late batch.  The late batch starts after a
  // setImmediate so the early-batch orphan-recovery winner has entered its
  // critical section (Step 2) with no claim file on disk.  The late-batch racer
  // finds no claim file, creates one, and enters Step 2+3 concurrently.
  // Invariant: exactly 1 winner across ALL racers and the lock file holds one token.
  test("orphan-recovery winner and concurrent fresh racer yield exactly one winner", async () => {
    const { writeFile: fsWrite } = await import("node:fs/promises");

    const staleToken = "stale-for-b1-mutex";
    const stalePid = 11119;
    const lockPath = join(tmpDir, ".kanthord-writer-lock");
    const claimPath = lockPath + ".takeover-in-progress";

    const deadProbe: LivenessProbe = () => false;

    // Repeat 50 rounds to reliably surface the probabilistic race window.
    // The window is: after unlink(claimPath) removes the orphaned claim, the
    // claim path is absent.  A fresh late racer finds no claim and creates one
    // via open("wx"), entering Steps 2+3 concurrently with the orphan-recovery
    // winner.  With 50 rounds and 4+4 racers the race surfaces reliably.
    for (let round = 0; round < 50; round++) {
      // Install a fresh stale lock each round.
      await fsWrite(
        lockPath,
        JSON.stringify({ token: staleToken, pid: stalePid, acquiredAt: new Date().toISOString() }),
        "utf8",
      );
      // Pre-place an orphaned claim file (empty content — simulates a crash
      // between claim-open and claim-writeFile, leaving an empty file on disk).
      // This causes all early-batch racers to hit EEXIST and decide "orphaned".
      await fsWrite(claimPath, "", "utf8");

      // Early batch: 4 concurrent racers that all see the orphaned claim and
      // race to unlink it.  ONE wins the unlink election and proceeds WITHOUT
      // holding the claim file.
      const earlyBatch = Array.from({ length: 4 }, () =>
        new WriterLock(tmpDir, { livenessProbe: deadProbe }).acquire()
      );

      // Late-batch racers: start after a setImmediate hop so the early-winner
      // is past its unlink(claimPath) and inside the critical section (Steps
      // 2+3) before these racers begin.  They find no claim file and can
      // create one with open("wx"), entering Steps 2+3 concurrently.
      const lateBatch = Array.from({ length: 4 }, () =>
        new Promise<string>((resolve, reject) => {
          setImmediate(() => {
            new WriterLock(tmpDir, { livenessProbe: deadProbe })
              .acquire()
              .then(resolve, reject);
          });
        })
      );

      const results = await Promise.allSettled([...earlyBatch, ...lateBatch]);

      const winners = results.filter((r) => r.status === "fulfilled");
      const losers  = results.filter((r) => r.status === "rejected");

      assert.equal(
        winners.length,
        1,
        `round ${round}: exactly 1 winner expected across early+late racers, got ${winners.length}`,
      );
      assert.equal(
        losers.length,
        7,
        `round ${round}: exactly 7 losers expected, got ${losers.length}`,
      );

      for (const loser of losers) {
        assert.ok(
          loser.status === "rejected" && loser.reason instanceof StoreLocked,
          `round ${round}: each loser must throw StoreLocked`,
        );
      }

      // The lock file must contain exactly one token — proof that no concurrent
      // writer overwrote the file and left a second token in place.
      const lockRaw = JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
      assert.equal(typeof lockRaw["token"], "string", `round ${round}: lock must contain a token`);

      // Release the winner's lock before the next round.
      const winner = winners[0];
      if (winner?.status === "fulfilled") {
        const wl = new WriterLock(tmpDir);
        await wl.release(winner.value);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: Reviewer Finding B1 — takeover journal failure must not leave an
// unowned held lock.
//
// The gap (src/store/writer-lock.ts:327–359): `writeFile(lockPath, payload)`
// overwrites the lock with the new token BEFORE `appendFile(journalPath, …)`.
// If `appendFile` throws, the method throws without returning the token and
// without setting `claimAcquired = true`.  The `finally` block only unlinks
// the claim file (not the main lock) — so the lock remains held by a token
// nobody possesses (an unowned held lock).
//
// Proof: place a stale lock, block the journal path (mkdir creates a
// directory where appendFile would write so it throws EISDIR), call
// acquire() and assert it throws.  Then unblock the journal path and call
// acquire() again: if the fix is absent the second call throws StoreLocked
// (unowned token still in lock file); if the fix is present it succeeds.
// ---------------------------------------------------------------------------

describe("src/store/writer-lock — B1 takeover journal failure must not leave unowned held lock", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-wlock-b1-journal-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("takeover journal append failure does not leave an unowned held lock", async () => {
    const lockPath = join(tmpDir, ".kanthord-writer-lock");
    const staleToken = "stale-for-b1-journal";
    const stalePid = 99999;

    // Place a stale lock file whose holder the dead probe considers gone.
    const { writeFile: fsWrite, mkdir, rm: fsRm } = await import("node:fs/promises");
    await fsWrite(
      lockPath,
      JSON.stringify({ token: staleToken, pid: stalePid, acquiredAt: new Date().toISOString() }),
      "utf8",
    );

    const deadProbe: LivenessProbe = () => false;

    // Block the journal path: create a directory at the exact journal file path
    // so appendFile throws EISDIR — simulating a journal write failure after the
    // lock file has already been overwritten.
    const journalPath = join(tmpDir, ".kanthord-store.journal.jsonl");
    await mkdir(journalPath);

    // First acquire: lock overwrite succeeds (writes process.pid + new token),
    // journal append fails → must throw.
    const lockA = new WriterLock(tmpDir, { livenessProbe: deadProbe });
    await assert.rejects(
      () => lockA.acquire(),
      (err: unknown) => {
        assert.ok(err instanceof Error, "must throw an Error on journal failure");
        return true;
      },
      "acquire() must throw when the takeover journal append fails",
    );

    // After the throw the lock file holds the new token written by lockA's
    // takeover Step 3 (writeFile), with pid = process.pid (the current live
    // process).  The DEFAULT liveness probe (process.kill) considers process.pid
    // ALIVE → a second acquire with the default probe will throw StoreLocked.
    // The fix must clean up the lock (restore stale or delete) on journal failure
    // so the lock is not permanently unreleasable.

    // Unblock the journal path so the second attempt can succeed.
    await fsRm(journalPath, { recursive: true, force: true });

    // Second acquire uses the DEFAULT probe (process.kill-based).
    // BUG (without fix): lock file holds pid=process.pid (alive); acquire()
    // sees the current process as holder and throws StoreLocked.
    // CORRECT (with fix): lock was cleaned up on journal failure; acquire() wins.
    const lockB = new WriterLock(tmpDir); // default probe — no deadProbe injection
    const tokenB = await lockB.acquire();

    assert.equal(typeof tokenB, "string", "second acquire must return a string token");
    assert.ok(tokenB.length > 0, "second acquire token must be non-empty");

    const lockRaw = JSON.parse(await readFile(lockPath, "utf8")) as { token?: string };
    assert.equal(lockRaw.token, tokenB, "lock file must hold the second acquirer's token");

    await lockB.release(tokenB);
  });

  // (B1-journal-cleanup-safe) The `finally` block's lock-file cleanup
  // (`unlink(lockPath)` when `!claimAcquired && lockFileOverwritten`) must
  // verify the lock still holds OUR token before deleting.  If the lock was
  // already overwritten by a concurrent winner, we must NOT unlink it.
  //
  // Scenario: two concurrent takeover racers both overwrite the lock in Step 3
  // (writeFile).  Racer A (the eventual winner) sets claimAcquired = true and
  // returns.  Racer B reaches the finally block with lockFileOverwritten = true
  // and claimAcquired = false — its cleanup must NOT delete the lock file that
  // now holds Racer A's token.
  //
  // We simulate this by running the B1-mutex 50-round scenario but checking
  // that the lock file is still on disk (and holds one valid token) after each
  // round — i.e. the winner's lock was not deleted by a loser's cleanup.
  test("lock-file cleanup in finally block does not delete a concurrent winner's lock", async () => {
    const { writeFile: fsWrite } = await import("node:fs/promises");

    const staleToken = "stale-for-cleanup-safe";
    const stalePid = 77777;
    const lockPath = join(tmpDir, ".kanthord-writer-lock");
    const claimPath = lockPath + ".takeover-in-progress";

    const deadProbe: LivenessProbe = () => false;

    for (let round = 0; round < 50; round++) {
      // Install a fresh stale lock each round.
      await fsWrite(
        lockPath,
        JSON.stringify({ token: staleToken, pid: stalePid, acquiredAt: new Date().toISOString() }),
        "utf8",
      );
      // Pre-place an orphaned claim file so all early racers enter orphan recovery.
      await fsWrite(claimPath, "", "utf8");

      // Run 5 concurrent stale-takeover racers.
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          new WriterLock(tmpDir, { livenessProbe: deadProbe }).acquire()
        ),
      );

      const winners = results.filter((r) => r.status === "fulfilled");

      assert.equal(
        winners.length,
        1,
        `round ${round}: exactly 1 winner expected, got ${winners.length}`,
      );

      // The lock file must still exist and hold the winner's token.
      // BUG (without fix): a losing racer's finally block deletes lockPath even
      // though the winning racer's token is in it → ENOENT here.
      let lockRaw: Record<string, unknown>;
      try {
        lockRaw = JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
      } catch (err) {
        assert.fail(
          `round ${round}: lock file must still exist after winner cleanup — got ENOENT; ` +
          `a loser's finally block must not delete the winner's lock`,
        );
      }

      const winner = winners[0];
      if (winner?.status === "fulfilled") {
        assert.equal(
          lockRaw["token"],
          winner.value,
          `round ${round}: lock file must hold the winner's token`,
        );
        const wl = new WriterLock(tmpDir);
        await wl.release(winner.value);
      }
    }
  });
});

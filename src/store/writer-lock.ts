/**
 * src/store/writer-lock.ts
 *
 * Story 012-002 — process-level single-writer lock for the store root.
 *
 * `WriterLock` uses O_EXCL atomic file creation to guarantee that exactly
 * one writer can hold the lock at a time.  Read-only openers bypass the
 * lock entirely.  A stale lock (holder process dead) can be cleared by a
 * new opener via `acquire()` after verifying the holder is gone — not
 * implemented here; the lock file is simply overwritten after manual
 * inspection (crash recovery is a higher-level concern).
 */

import { open, unlink, readFile, writeFile, appendFile } from "node:fs/promises";
import { log, errMessage } from "../foundations/log.ts";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const LOCK_FILE_NAME = ".kanthord-writer-lock";
const JOURNAL_FILE_NAME = ".kanthord-store.journal.jsonl";

/**
 * Liveness probe: receives a PID, returns `true` if the process is alive.
 * May throw — a thrown error is treated as "alive" (e.g., EPERM).
 */
export type LivenessProbe = (pid: number) => boolean;

/** Thrown when a second writer attempts to acquire a held lock. */
export class StoreLocked extends Error {
  code: "store-locked";

  constructor(message: string) {
    super(message);
    this.name = "StoreLocked";
    this.code = "store-locked";
  }
}

/**
 * Default liveness probe: sends signal 0 to the process.
 * Returns `true` if alive; returns `false` if the process does not exist (ESRCH).
 * Throws for any other error (e.g., EPERM) — caller treats throw as alive.
 */
function defaultLivenessProbe(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ESRCH") {
      return false;
    }
    throw err;
  }
}

/**
 * Process-level writer lock for a store root directory.
 *
 * @param storeRoot   Absolute path of the store root.
 * @param opts.readOnly  When true, `acquire()` and `release()` are no-ops.
 * @param opts.livenessProbe  Custom probe to check if a PID is alive (default: `process.kill(pid, 0)`).
 */
export class WriterLock {
  private storeRoot: string;
  private readOnly: boolean;
  private livenessProbe: LivenessProbe;

  constructor(storeRoot: string, opts?: { readOnly?: boolean; livenessProbe?: LivenessProbe }) {
    this.storeRoot = storeRoot;
    this.readOnly = opts?.readOnly ?? false;
    this.livenessProbe = opts?.livenessProbe ?? defaultLivenessProbe;
  }

  /**
   * Acquire the writer lock.
   *
   * Uses O_EXCL to atomically create `.kanthord-writer-lock`.  If the file
   * already exists, reads the holder information and throws `StoreLocked`.
   *
   * Read-only mode: no-op, returns `""`.
   *
   * @returns The acquired lock token (UUID string), or `""` in read-only mode.
   */
  async acquire(): Promise<string> {
    if (this.readOnly) {
      return "";
    }

    const lockPath = join(this.storeRoot, LOCK_FILE_NAME);
    const token = randomUUID();
    const payload = JSON.stringify({
      token,
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
    });

    let fileHandle;
    try {
      // O_EXCL guarantees atomic exclusive creation — only one caller wins.
      fileHandle = await open(lockPath, "wx");
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === "EEXIST") {
        // Lock already held — read the holder info, then check liveness.
        let holderToken = "<unknown>";
        let holderPid: number | undefined;
        let holderPidStr = "<unknown>";
        let holderAcquiredAt = "<unknown>";
        try {
          const raw = JSON.parse(await readFile(lockPath, "utf8")) as {
            token?: string;
            pid?: number;
            acquiredAt?: string;
          };
          if (typeof raw.token === "string") holderToken = raw.token;
          if (typeof raw.pid === "number") {
            holderPid = raw.pid;
            holderPidStr = String(raw.pid);
          }
          if (typeof raw.acquiredAt === "string") holderAcquiredAt = raw.acquiredAt;
        } catch (err) {
          // If we can't read the lock file, assume alive.
          log.warn("writer-lock-read-failed", { error: errMessage(err) });
        }

        // Check liveness when we have a PID.
        if (holderPid !== undefined) {
          let isAlive: boolean;
          try {
            isAlive = this.livenessProbe(holderPid);
          } catch (err) {
            // Probe threw (e.g., EPERM) — treat as alive.
            isAlive = true;
            log.debug("writer-lock-liveness-probe-threw", { pid: holderPid, error: errMessage(err) });
          }

          if (!isAlive) {
            // Holder is dead — takeover via claim-file mutex + O_EXCL re-acquire.
            //
            // Strategy (single-winner via claim-file mutex):
            //
            //   Step 1 — Claim: race to create a single shared claim file
            //     (`<lockPath>.takeover-in-progress`) with O_EXCL.  Exactly ONE
            //     racer wins across all N concurrent callers; losers get EEXIST
            //     and throw StoreLocked immediately.
            //
            //   Step 2 — Re-verify (while holding claim): the claim winner
            //     re-reads lockPath and compares the stored token against the
            //     stale value captured before the liveness probe.  If the token
            //     changed (another racer or a probe side-effect replaced the lock)
            //     we unlink the claim file and throw StoreLocked — protecting
            //     against the "probe installs new lock" race (B1(4th)).
            //
            //   Step 3 — Replace: unlink the stale lockPath, then open(lockPath,
            //     "wx") O_EXCL — guaranteed to succeed because we hold the claim
            //     mutex and no other takeover racer can reach this point.  Write
            //     the new payload.  Unlink the claim file to release the mutex.
            //     Append the journal entry and return the new token.

            const claimPath = lockPath + ".takeover-in-progress";
            const claimPayload = JSON.stringify({ pid: process.pid });
            // Orphan-election file path — only used when we determine the claim
            // file is orphaned.  Tracked here so the finally block can clean it up.
            let orphanElectPath: string | undefined;

            // Step 1: Race to acquire the claim file (O_EXCL, single winner).
            // When EEXIST, read the claim file's PID: if its owner is dead
            // (orphaned claim from a crash), unlink it and retry once.
            let claimHandle;
            try {
              claimHandle = await open(claimPath, "wx");
              await claimHandle.writeFile(claimPayload, "utf8");
              await claimHandle.close();
            } catch (claimErr) {
              const ce = claimErr as NodeJS.ErrnoException;
              if (ce.code === "EEXIST") {
                // Check if the claim file's owner is alive.
                let claimOwnerAlive = true; // default: treat as alive
                let claimContent: string | undefined;
                try {
                  claimContent = await readFile(claimPath, "utf8");
                } catch (readErr) {
                  const re = readErr as NodeJS.ErrnoException;
                  if (re.code === "ENOENT") {
                    // Claim file is gone — the claim owner completed normally and
                    // removed it in its finally block.  The takeover epoch is
                    // finished; this racer is late — treat as a live lock.
                    throw new StoreLocked(
                      `Store is locked by token=${holderToken} pid=${holderPidStr} acquiredAt=${holderAcquiredAt}`,
                    );
                  }
                  // Other read error — treat as orphaned.
                  claimOwnerAlive = false;
                }

                if (claimContent !== undefined && claimOwnerAlive) {
                  // Parse the claim file content.
                  try {
                    const claimRaw = JSON.parse(claimContent) as { pid?: number };
                    if (typeof claimRaw.pid === "number") {
                      try {
                        // Always use the OS-native probe for the claim file owner.
                        // The injected livenessProbe is for the plan-store lock holder;
                        // the claim file is an internal concurrency mutex — always
                        // checked via process.kill(pid, 0), never via the injected probe.
                        claimOwnerAlive = defaultLivenessProbe(claimRaw.pid);
                      } catch (err) {
                        // Probe threw (e.g., EPERM) — treat as alive.
                        claimOwnerAlive = true;
                        log.debug("writer-lock-claim-probe-threw", { error: errMessage(err) });
                      }
                    } else {
                      // Claim has no PID (e.g., empty/corrupt) — treat as orphaned.
                      claimOwnerAlive = false;
                    }
                  } catch (err) {
                    // JSON parse error — treat as orphaned.
                    claimOwnerAlive = false;
                    log.warn("writer-lock-claim-parse-failed", { error: errMessage(err) });
                  }
                }

                if (!claimOwnerAlive) {
                  // Orphaned claim — elect a single winner via O_EXCL on a
                  // dedicated "orphan cleanup" file, then overwrite claimPath
                  // in-place so it is NEVER absent.
                  //
                  // KEY INVARIANT: claimPath must NEVER become absent.
                  // An unlink+re-open approach creates a window spanning two
                  // libuv I/O round-trips where a late fresh racer can win
                  // open(claimPath,"wx") and enter Steps 2+3 concurrently.
                  //
                  // Strategy:
                  //
                  //   1. Race to create `<claimPath>.orphan` with O_EXCL.
                  //      Exactly ONE racer wins; all others throw StoreLocked.
                  //
                  //   2. Winner overwrites claimPath in-place (writeFile, not
                  //      unlink+open) with its own PID payload — claim file
                  //      transitions from orphaned-empty to winner-owned without
                  //      ever being absent.
                  //
                  //   3. Late fresh racers: open(claimPath,"wx") → EEXIST
                  //      (file still present) → read winner's PID →
                  //      defaultLivenessProbe → alive → StoreLocked.  ✓
                  //
                  //   4. Finally block: always unlinks both claimPath and
                  //      claimPath+".orphan" on the error path; release()
                  //      unlinks them on the success path.

                  orphanElectPath = claimPath + ".orphan";
                  let orphanHandle;
                  try {
                    // O_EXCL election: exactly one orphan-recovery racer wins.
                    orphanHandle = await open(orphanElectPath, "wx");
                    await orphanHandle.writeFile(claimPayload, "utf8");
                    await orphanHandle.close();
                  } catch (orphanErr) {
                    const oe = orphanErr as NodeJS.ErrnoException;
                    if (oe.code === "EEXIST") {
                      // Another racer won the orphan-cleanup election.
                      throw new StoreLocked(
                        `Store is locked by token=${holderToken} pid=${holderPidStr} acquiredAt=${holderAcquiredAt}`,
                      );
                    }
                    throw orphanErr;
                  }
                  // We won the orphan election.  Overwrite claimPath in-place
                  // with our PID payload — no unlink, so the file is always present.
                  await writeFile(claimPath, claimPayload, "utf8");
                  // claimHandle stays undefined; cleanup is handled in the
                  // finally block (unlink claimPath + orphanElectPath on error,
                  // and release() on success).
                  claimHandle = undefined;
                } else {
                  // Another live takeover racer holds the claim — treat as live lock.
                  throw new StoreLocked(
                    `Store is locked by token=<takeover-in-progress> pid=<unknown> acquiredAt=<unknown>`,
                  );
                }
              } else {
                throw claimErr;
              }
            }

            // We hold the claim.  All operations from here are single-winner.
            // Track whether we successfully acquired the lock; the finally block
            // only unlinks the claim on the error path.  On the success path the
            // claim file stays present on disk so that any late racer that attempts
            // a concurrent takeover of the freshly-written lock token (even with a
            // dead-PID probe) sees the claim file alive and throws StoreLocked
            // immediately.  The claim file is cleaned up by release() instead.
            let claimAcquired = false;
            // Track whether Step 3 wrote our token into lockPath.  If claimAcquired
            // stays false after a writeFile (e.g. appendFile throws), we must delete
            // the lock file in the finally block so the token is not left unowned.
            let lockFileOverwritten = false;
            try {
              // Step 2: Re-verify the stale token while we hold the claim.
              let currentToken: string | undefined;
              try {
                const reRaw = JSON.parse(await readFile(lockPath, "utf8")) as {
                  token?: string;
                  pid?: number;
                  acquiredAt?: string;
                };
                currentToken = typeof reRaw.token === "string" ? reRaw.token : undefined;
                if (currentToken !== holderToken) {
                  // Token changed — a concurrent winner or probe side-effect
                  // already replaced the lock; treat it as a live holder.
                  const newPid = typeof reRaw.pid === "number" ? String(reRaw.pid) : "<unknown>";
                  const newAt = typeof reRaw.acquiredAt === "string" ? reRaw.acquiredAt : "<unknown>";
                  throw new StoreLocked(
                    `Store is locked by token=${currentToken ?? "<unknown>"} pid=${newPid} acquiredAt=${newAt}`,
                  );
                }
              } catch (reReadErr) {
                if (reReadErr instanceof StoreLocked) throw reReadErr;
                // ENOENT or parse error: stale lock already gone (race outside
                // our claim).  Proceed to O_EXCL re-acquire.
              }

              // Step 3: Overwrite the stale lock file in-place with our new
              // payload — no unlink, so there is never a window where
              // lockPath is absent.  A concurrent normal-acquire racer whose
              // initial open("wx") was queued in libuv before we got here
              // will receive EEXIST (file still present) and enter the
              // EEXIST handler as usual; an absolutely concurrent freshly
              // arriving racer would also see our new token and throw
              // StoreLocked.  The claim mutex ensures that no other
              // takeover racer can be in this section simultaneously.
              await writeFile(lockPath, payload, "utf8");
              lockFileOverwritten = true;

              // Readback-verify: confirm our token won (e.g. a concurrent
              // fresh normal-acquire racer could have overwritten us between
              // our writeFile and this read — extremely unlikely, but we
              // guard it anyway).
              try {
                const verifyRaw = JSON.parse(await readFile(lockPath, "utf8")) as {
                  token?: string;
                  pid?: number;
                  acquiredAt?: string;
                };
                if (typeof verifyRaw.token === "string" && verifyRaw.token !== token) {
                  const concPid = typeof verifyRaw.pid === "number" ? String(verifyRaw.pid) : "<unknown>";
                  const concAt = typeof verifyRaw.acquiredAt === "string" ? verifyRaw.acquiredAt : "<unknown>";
                  throw new StoreLocked(
                    `Store is locked by token=${verifyRaw.token} pid=${concPid} acquiredAt=${concAt}`,
                  );
                }
              } catch (verifyErr) {
                if (verifyErr instanceof StoreLocked) throw verifyErr;
                // Read/parse error — our write succeeded; proceed.
              }

              // Append journal entry for the completed takeover.
              const journalPath = join(this.storeRoot, JOURNAL_FILE_NAME);
              const journalEntry = JSON.stringify({
                event: "lock-takeover",
                stalePid: holderPid,
                staleToken: holderToken,
                at: new Date().toISOString(),
              });
              await appendFile(journalPath, journalEntry + "\n", "utf8");

              claimAcquired = true;
              return token;
            } finally {
              // On the error path (claimAcquired === false):
              //   - If we already wrote our token into lockPath, delete it now so
              //     the lock is not left held by an unowned token (e.g. appendFile
              //     threw after Step 3 succeeded).  Ignore ENOENT (already gone).
              //   - Token-verify before unlinking: only unlink lockPath if the
              //     file still holds OUR token.  A concurrent winner may have
              //     overwritten it with their token between our writeFile and this
              //     finally block; we must not delete their live lock.
              //   - Always unlink the claim file to avoid orphaning it.
              if (!claimAcquired) {
                if (lockFileOverwritten) {
                  // Re-read and verify our token before cleaning up.
                  let shouldUnlink = false;
                  try {
                    const verifyCleanup = JSON.parse(await readFile(lockPath, "utf8")) as {
                      token?: string;
                    };
                    shouldUnlink = verifyCleanup.token === token;
                  } catch (err) {
                    // Read threw (ENOENT = already gone, parse error = corrupt) —
                    // skip the unlink; either the winner already cleaned up or
                    // the file is not ours.
                    shouldUnlink = false;
                    log.debug("writer-lock-cleanup-read-failed", { error: errMessage(err) });
                  }
                  if (shouldUnlink) {
                    await unlink(lockPath).catch((err) => log.debug("writer-lock-cleanup-unlink-failed", { error: errMessage(err) }));
                  }
                }
                await unlink(claimPath).catch((err) => log.debug("writer-lock-cleanup-unlink-failed", { error: errMessage(err) }));
                // Also clean up the orphan-election file if we created one.
                if (orphanElectPath !== undefined) {
                  await unlink(orphanElectPath).catch((err) => log.debug("writer-lock-cleanup-unlink-failed", { error: errMessage(err) }));
                }
              }
            }
          }
        }

        throw new StoreLocked(
          `Store is locked by token=${holderToken} pid=${holderPidStr} acquiredAt=${holderAcquiredAt}`,
        );
      }
      throw err;
    }

    try {
      await fileHandle.writeFile(payload, "utf8");
    } finally {
      await fileHandle.close();
    }

    return token;
  }

  /**
   * Release the writer lock.
   *
   * Removes `.kanthord-writer-lock` only when the stored token matches
   * `token`.  A mismatched token is silently ignored (the lock stays).
   *
   * Read-only mode / null token: no-op.
   */
  async release(token: string | null): Promise<void> {
    if (this.readOnly || token === null) {
      return;
    }

    const lockPath = join(this.storeRoot, LOCK_FILE_NAME);

    let storedToken: string | undefined;
    try {
      const raw = JSON.parse(await readFile(lockPath, "utf8")) as {
        token?: string;
      };
      storedToken = raw.token;
    } catch (err) {
      // Lock file already gone — nothing to do.
      log.debug("writer-lock-release-read-failed", { error: errMessage(err) });
      return;
    }

    if (storedToken !== token) {
      // Token mismatch — leave the lock file untouched.
      return;
    }

    try {
      await unlink(lockPath);
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code !== "ENOENT") {
        throw err;
      }
    }

    // If this release follows a stale-lock takeover, the claim file was left
    // on disk intentionally (as a concurrent-takeover guard) and must be
    // cleaned up here.  Harmless ENOENT when no takeover occurred.
    const claimPath = lockPath + ".takeover-in-progress";
    await unlink(claimPath).catch((err) => log.debug("writer-lock-cleanup-unlink-failed", { error: errMessage(err) }));
    // Also clean up the orphan-election file if a takeover used orphan recovery.
    const orphanElectPath = claimPath + ".orphan";
    await unlink(orphanElectPath).catch((err) => log.debug("writer-lock-cleanup-unlink-failed", { error: errMessage(err) }));
  }
}

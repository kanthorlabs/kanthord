# Story 002 - Single-Writer Lock

Epic: `.agent/plan/epics/012-real-markdown-store-git.md`

## Goal

The single-writer invariant is enforced, not assumed: only one process can hold
the store open for writing; a second writer fails fast; a stale lock left by a
crashed holder is recoverable.

## Acceptance Criteria

- Opening the store for writing acquires a writer lock on the store root; while it
  is held, a second write-open fails with a typed `store-locked` error naming the
  holder (holder token + pid + acquired-at) — it does not block or corrupt (PRD
  §6.1 single-writer invariant; assumption #2: one daemon at a time).
- Acquisition is **atomic**: the lock file is created with exclusive-create
  semantics (`O_EXCL`), so two racing acquirers cannot both succeed (asserted
  with two concurrent acquire attempts; debate finding — no check-then-create
  window).
- The lock records a random **holder token** alongside the pid; staleness
  requires both a dead pid *and* release/takeover verifies the token, so pid
  reuse cannot masquerade as the holder (debate finding).
- Closing the store releases the lock only if the token matches; a subsequent
  write-open succeeds.
- A stale lock (holder dead per the liveness probe; an `EPERM` probe result
  counts as **alive** — fail-safe) is taken over on the next write-open, and the
  takeover is journaled.
- Read-only opens (as `kanthord verify --read-only` will use, Epic 018) do **not**
  acquire the writer lock and succeed while a writer holds it (PRD §6.1 — verify is
  an on-demand read-only command).

## Constraints

- Lock mechanism: a lock file under the store root with holder pid + timestamp,
  liveness-checked via `process.kill(pid, 0)` — platform built-ins, no lock
  library (user principle 6; PRD §6.1 documents the constraint, this Story
  mechanizes it).
- The lock guards the **store seam**, not individual files — one writer for the
  whole root (PRD §6.1).
- Tests simulate the crashed holder with a fake "liveness" seam (a pid probe
  injected per PROFILE.md DI style), not by killing real processes.

## Verification Gate

- `npm test` green for `src/store/writer-lock.test.ts`.

### Task T1 - Acquire/reject/release

**Input:** `src/store/writer-lock.ts`, `src/store/writer-lock.test.ts`

**Action - RED:** Write tests: (a) first write-open acquires the lock; (b) a second
write-open on the same root throws typed `store-locked` naming token + pid +
acquired-at; (c) two concurrent acquire attempts yield exactly one winner
(exclusive-create asserted); (d) after close, write-open succeeds; (e) close with
a mismatched token does not release; (f) read-only open succeeds while the lock
is held.

**Action - GREEN:** Implement the lock file (exclusive create, token + pid +
timestamp) acquire/release wired into the store open path, with a read-only mode
that skips it.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Stale-lock takeover

**Input:** `src/store/writer-lock.ts`, `src/store/writer-lock.test.ts`

**Action - RED:** Write tests: (a) with a lock file whose holder the injected
liveness probe reports dead, a write-open succeeds, rewrites the lock with the
new holder token, and appends a takeover event to the store journal; (b) a probe
returning `EPERM` is treated as alive (no takeover — fail-safe; debate finding).

**Action - GREEN:** Add liveness check + token-verified takeover on acquire.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

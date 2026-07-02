# 012 Real Markdown Store — Git Discipline & Single-Writer Enforcement

## Outcome

The Phase-1 markdown store (Epic 003) becomes the production store: feature
directories live in a **git-disciplined store root** whose commit history is the
plan's version history, the **single-writer invariant is enforced at process level**
(a second writer is rejected, not just discouraged), and **out-of-band drift in the
covered plan files is mechanically detected** as a dirty plan — detection means
current covered-file state diverging from the stamped hash, not edit *events*: an
edit followed by an exact revert leaves no dirty flag, by design (debate finding —
say what is detected, not more). The Epic 003 store seam is kept with one **additive
extension** (a `history` read — a seam extension, recorded here as its decision
note, not a silent change; debate finding); the projection contract is unchanged.
The Phase-1 harness suite stays green (phases.md Phase 2 Requirements: the harness
is the regression net for every brick swap).

## Decision Anchors

- phases.md Phase 2A Deliverable 1 — real markdown store + git-based feature dirs
  (single-writer invariant; PRD §6.1–6.2); S3 sync deferred to 2B.
- PRD §7.1.1 §1 — the authored plan is "source of truth, synced, **git history**";
  §9 decision 7 — git history on the authored files is the plan's version history.
- PRD §7.1.1 §7 corollary — the feature directory is source code under git
  discipline; a casual `mv` is a plan edit and must trip the dirty flag.
- PRD §6.1 — single-writer invariant: the daemon is the only writer to the markdown
  store; running two daemons breaks it (documented constraint — enforce, don't
  assume).
- phases.md guiding rule — seams are stable intent: the Epic 003 store interface is
  kept; a correction, if forced, gets a short decision record + harness update.

## Stories

- `001-store-root-git-history.md` — the store root is a git repository; every
  **logical store mutation** (a write set — e.g. one sign-off's multi-file edit —
  not each low-level file write; debate finding) lands as one attributable commit
  with structured trailers; history for a file is readable through the store seam.
- `002-single-writer-lock.md` — a process-level writer lock on the store root; a
  second store opened for writing fails fast with a typed error; a stale lock from
  a crashed process is recoverable.
- `003-out-of-band-edit-detection.md` — an edit or rename made behind the daemon's
  back (not through the store seam) is detected at the next sign-off/poll via the
  Epic 002 `compile_hash` recheck and marks the plan dirty.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites.
- Writing a multi-file plan change through the store seam on a temp store root
  produces **one** git commit containing the whole write set, carrying structured
  trailers (change class + actor — parseable metadata, not loose message prose;
  debate finding); two mutations produce two commits in order; `history(file)`
  returns them filtered by trailer, and the lock/temp files are never in any
  commit (store-managed ignore boundary).
- STATE/journal/RUNBOOK writes follow the PRD §7.1.1 hash boundary: they do
  **not** dirty the plan (excluded from `compile_hash`), and their commits carry
  the `operational` change class so plan history filters clean (PRD decision 9).
- All plan-file writes are atomic (write-temp + rename), so a concurrent
  read-only open (Epic 018 verify) never observes a partial file (debate
  finding).
- Opening a second writing store on the same root fails with a typed
  `store-locked` error naming the lock holder; acquisition is **atomic**
  (`O_EXCL`-style create — two racing acquirers cannot both win, asserted); after
  a simulated crash (lock file left behind, holder token dead) a new store opens
  and takes the lock; PID-reuse is mitigated by a holder token, not a bare pid
  (debate finding).
- Renaming, **deleting, or adding** a covered plan file on disk directly (not
  through the seam) is detected: the next compile-hash recheck marks the plan
  dirty and new dispatch halts (Epic 004 behavior; the hash covers the file
  *set*, so set changes count — debate finding).
- The Phase-1 harness golden scenario still passes against the real store
  (temp git store root instead of plain temp dir).

## Dependencies

- **Epic 003** (store seam + projection contract — kept, not redefined).
- **Epic 002** (`compile_hash` + dirty flag — Story 003 drives it).
- **Epic 011 SU1** (git-cli findings — the commit/history invocations code against
  it).

## Non-Goals

- No S3 sync / replication — Phase 2B (Epic 021; phases.md).
- No multi-writer or merge semantics — single-writer is the invariant, two daemons
  stay out of MVP (PRD §6.1, assumption #2).
- No repo-slot worktrees — the store root's git repo is the **plan store**, not a
  code repo slot (those are Epic 016).
- No change to the projection contract or its version — nothing markdown-derived
  is added here (PRD §6.1; Epic 003 contract).

## Findings Out

- none. The store-root layout and lock protocol are documented in Story 001/002 and
  asserted by their tests; Epic 018 (`kanthord verify`) and Epic 021 (S3 sync) read
  the same store root.

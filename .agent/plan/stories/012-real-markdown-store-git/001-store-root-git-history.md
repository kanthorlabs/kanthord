# Story 001 - Store Root Git History

Epic: `.agent/plan/epics/012-real-markdown-store-git.md`

## Goal

The markdown store root is a git repository: every plan-file write through the
store seam becomes an attributable commit, and the plan's version history is
readable back through the seam.

## Acceptance Criteria

- Opening the store on a root that is not yet a git repository initializes one;
  opening on an existing repository reuses it (PRD §7.1.1 §1 — authored plan
  carries git history).
- A **logical store mutation** (a write set: one or many plan files, e.g. a
  sign-off's multi-file edit) through the store seam produces exactly one commit
  containing the whole set — one plan change equals one commit, never N low-level
  commits (debate finding); a single-file write is the degenerate case.
- Commits carry **structured trailers**: `Kanthord-Change-Class: plan|operational`
  and `Kanthord-Actor: <actor>`; git author/committer identity is the fixed daemon
  identity — attribution lives in the trailer, and the trailer format is
  parseable and asserted, not loose prose (debate finding).
- STATE (`*.state.md`), journal (`*.journal.jsonl`), and `RUNBOOK.md` writes are
  committed with class `operational`, so plan-file history stays a clean drift
  signal (PRD §7.1.1 §9 decision 9).
- Plan-file writes land atomically (write-temp + rename) so a concurrent reader
  never sees a partial file (debate finding).
- The store manages the root's ignore boundary: its lock file and temp files are
  never committed (asserted after a full mutation cycle).
- `history(path)` through the store seam returns the commits touching that path,
  newest first, with actor + timestamp, filterable by change class. `history` is
  an **additive seam extension** to Epic 003 (recorded in the Epic; debate
  finding).
- All Phase-1 store-seam tests (Epic 003) still pass against the git-backed store.

## Constraints

- Git is driven per the Epic 011 SU1 findings
  (`.agent/plan/feedback/014-real-broker-minimal-path/git-cli.md`) — same execution
  path as the broker's `git.*` verbs; do not introduce a second git library
  (PRD principle: one audited path).
- The store seam interface from Epic 003 Story 001 is kept; git lands **behind**
  it (phases.md — seams are stable intent; a forced change needs a decision
  record).
- Tests use a temp directory they create and remove (PROFILE.md test conventions);
  no network — the store-root repo has no remote.

## Verification Gate

- `npm test` green for `src/store/git-store.test.ts`.

### Task T1 - Init/open store-root repo + commit-per-write

**Input:** `src/store/git-store.ts`, `src/store/git-store.test.ts`

**Action - RED:** Write tests: (a) opening the store on a bare temp dir leaves an
initialized git repo; (b) a multi-file plan mutation through the seam creates ONE
commit containing the whole set with the class + actor trailers; (c) two
sequential mutations create two ordered commits; (d) a mid-mutation reader sees
either the old or the new file, never a partial one; (e) the lock/temp files are
absent from every commit.

**Action - GREEN:** Implement the git-backed store write path (init-or-open,
atomic write-set staging, one commit per mutation with trailers, managed ignore
boundary) behind the Epic 003 store interface, invoking git per the SU1 findings.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Commit classes + history read-back

**Input:** `src/store/git-store.ts`, `src/store/git-store.test.ts`

**Action - RED:** Write tests: (a) a STATE write and a RUNBOOK write produce
commits with trailer class `operational` while a task-file write is `plan`;
(b) `history(path)` returns the commits for that path newest-first with actor
and timestamp, and filtering by class returns only matching commits; (c) trailer
parsing round-trips an actor containing spaces/unicode.

**Action - GREEN:** Add the trailer builder/parser and the `history` read path.

**Action - REFACTOR:** extract the trailer format into one named builder/parser
shared by write and history paths.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

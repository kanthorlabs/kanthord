# Story 003 - Out-Of-Band Edit Detection

Epic: `.agent/plan/epics/012-real-markdown-store-git.md`

## Goal

A plan edit made behind the daemon's back — a direct file edit or a rename not
going through the store seam — is mechanically detected as a dirty plan at the
next compile-hash recheck, so the Epic 004 dirty-plan behavior (halt new dispatch)
engages on the real store.

## Acceptance Criteria

- After a successful compile at generation `G`, directly editing a covered plan
  file on disk (not via the seam) causes the next recheck to report the plan
  dirty (PRD §7.1.1 §7 — editing covered files marks the plan dirty).
- Directly renaming a task file (a `mv`) is likewise detected — the hash covers
  filenames (PRD §7.1.1 §7 corollary: a casual `mv` is a plan edit).
- Directly **deleting** a covered file or **adding** a new file matching the
  covered grammar is detected — the hash covers the file *set*, not only known
  files' contents (debate finding).
- Detection semantics are **current-state divergence**: an out-of-band edit
  followed by an exact revert to the stamped state reports clean — hash equality
  means the plan is unchanged; this is by design and documented (debate finding —
  no event-level claim).
- Editing only `RUNBOOK.md`, a `*.state.md`, or a `*.journal.jsonl` out-of-band
  does **not** mark the plan dirty (excluded from `compile_hash`).
- A dirty plan detected this way halts new dispatch exactly as a seam-made edit
  does (one dirty mechanism, asserted through the Epic 004 scheduler predicate).

## Constraints

- Detection is the Epic 002 `compile_hash` recheck run at sign-off and at the
  scheduler poll boundary — **no file watcher** (PRD §7.1.1 §7: compilation is an
  explicit sign-off action, never a file-watcher reaction; the recheck is the
  containment, not prevention — assumption #15).
- Reuses Epic 002's hash function; this Story adds the recheck call sites on the
  real store, not a second hash implementation.

## Verification Gate

- `npm test` green for `src/store/dirty-recheck.test.ts`.

### Task T1 - Recheck detects content edit and rename; exclusions hold

**Input:** `src/store/dirty-recheck.ts`, `src/store/dirty-recheck.test.ts`

**Action - RED:** Write tests on a compiled temp feature in a git store root:
(a) direct file edit ⇒ recheck reports dirty; (b) direct rename ⇒ dirty;
(c) direct delete ⇒ dirty; (d) direct add of a grammar-matching file ⇒ dirty;
(e) RUNBOOK/state/journal edits ⇒ not dirty; (f) unchanged set ⇒ not dirty;
(g) edit + exact revert ⇒ not dirty (current-state semantics).

**Action - GREEN:** Implement the recheck (recompute `compile_hash` over the
covered file set from the real store, compare to the stamped generation hash) and
expose it as the seam the scheduler poll calls.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Dirty from out-of-band edit halts new dispatch

**Input:** `src/store/dirty-recheck.ts`, `src/store/dirty-recheck.test.ts`

**Action - RED:** Write a test that after an out-of-band edit, the Epic 004
scheduler poll (driven with the recheck wired in) dispatches no new node, while a
node already running under `G` is untouched.

**Action - GREEN:** Wire the recheck result into the existing dirty-plan
dispatch predicate (Epic 004 Story 004 seam) — no scheduler logic changes.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

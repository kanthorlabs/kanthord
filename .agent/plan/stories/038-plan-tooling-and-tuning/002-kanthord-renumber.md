# Story 002 - `kanthord renumber`

Epic: `.agent/plan/epics/038-plan-tooling-and-tuning.md`

## Goal

Renumbering is a normal, safe re-planning operation: one command moves a task
trio or a story directory atomically, identity survives, the plan goes dirty,
and every refusal speaks planner vocabulary.

## Acceptance Criteria

- `kanthord renumber <feature> <node-id> <new-position>` moves a task's file
  trio (plan file + `.state.md` + `.journal.jsonl` siblings) to the new
  `major[.lane]-slug` position in one all-or-nothing operation; the story-dir
  form moves the directory (with contents) the same way (PRD §7.1.1 §4).
- Frontmatter `id`s are untouched and every id-based reference (handoffs,
  tickets, ledger, SQLite rows) resolves identically after the move —
  filename = position, id = identity (asserted by compiling before/after and
  diffing node identity).
- The move trips the dirty flag (a rename is a plan change) and the next
  sign-off compile succeeds with the new grammar edges reflecting the new
  position.
- The **atomicity model is concrete** (debate finding — three sibling renames
  are not one atomic op): the move is staged fully, a durable recovery
  marker is written, the renames are committed, and the marker is cleared;
  an injected crash at any point between marker write and clear is detected
  on the next `renumber`/compile and rolled back or completed to one
  consistent state — an injected failure mid-move never leaves a mixed trio
  (asserted at each fault point; exit non-zero on the failing run).
- Refusals exit non-zero with planner-vocabulary messages naming the files:
  target position already occupied; malformed target name (grammar); unknown
  node id. A move whose resulting plan would fail lint (e.g. it creates a
  forward handoff) is **refused by a post-move dry-run compile check unless
  `--allow-invalid` is passed** (debate finding — a safety tool should not
  hand back a broken plan by default); with the flag, the move lands and the
  next compile reports the lint error (renumber moves files, lint judges
  plans).
- Position references are ids by design: nothing machine-consumed derives
  from the old filename after the move (asserted by compiling); prose
  mentions of old positions in bodies/RUNBOOK are **not** rewritten — a
  documented limitation, not silent behavior (debate finding).
- The state/journal siblings move with their stems (stem-named discipline,
  PRD §7.1.1 decision 9).

## Constraints

- Staged move with a durable recovery marker (stage → marker → commit renames
  → clear marker), reusing the Epic 003 store's temp-then-rename discipline
  per file; the marker is what makes the multi-file commit crash-consistent
  (debate finding).
- Operates on the authored markdown tree via the Epic 003 store paths; never
  touches SQLite (derived state follows at next compile; PRD §6.1).

## Verification Gate

- `npm test` green for `src/cli/renumber.test.ts`; `npm run typecheck`
  exits 0.

### Task T1 - Atomic move + identity + dirty

**Input:** `src/cli/renumber.ts`, `src/store/renumber.ts`,
`src/cli/renumber.test.ts`

**Action - RED:** Write tests: (a) task-trio move relocates exactly three
files with content intact; (b) story-dir move; (c) id-identity preserved
across compile before/after; (d) dirty flag tripped + clean recompile with
new edges; (e) injected fault at each stage boundary (pre-marker,
mid-commit, pre-clear) ⇒ next run detects the marker and recovers to one
consistent state, never a mixed trio.

**Action - GREEN:** Implement the staged move with the recovery marker over
the store's temp-then-rename discipline.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Refusals in planner vocabulary

**Input:** `src/cli/renumber.ts`, `src/cli/renumber.test.ts`

**Action - RED:** Write tests: occupied target, malformed name, unknown id —
each non-zero with a message naming the offending file/position; a
lint-breaking move is refused by the dry-run check without `--allow-invalid`
and lands with it (the follow-up compile then carries the lint diagnostic).

**Action - GREEN:** Implement the refusal checks, the dry-run compile check,
and the messages.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

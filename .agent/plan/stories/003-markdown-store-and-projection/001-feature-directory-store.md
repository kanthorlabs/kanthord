# Story 001 - Feature-Directory Store (single writer)

Epic: `.agent/plan/epics/003-markdown-store-and-projection.md`

## Goal

A single-writer store seam over a feature directory: read and write the
frontmatter/STATE/JOURNAL triples for the feature and its tasks plus the RUNBOOK,
with STATE bounded-rewritten and JOURNAL append-only.

## Acceptance Criteria

- Writing then reading a feature directory returns the same `epic.md` frontmatter +
  body, each story's `INDEX.md`, and each task's `*.md` (PRD §6.2 triple layout).
- A task's `*.state.md` is fully **rewritten** on each write (bounded, single
  current state); reading returns the last written content (PRD §6.2 STATE bounded +
  rewritten).
- A task's `*.journal.jsonl` is **append-only**: writing two journal events yields
  two lines and earlier events are never overwritten (PRD §6.2 JOURNAL append-only;
  reuses Epic 001 jsonl seam).
- `RUNBOOK.md` reads/writes as a plain document sibling of `epic.md` (PRD §7.1.1 §6).
- Every write performed through the public store API produces exactly the documented
  file effect and no other file changes (observable: after a `writeState`, only that
  `*.state.md` changed; after an `appendJournal`, only that `*.journal.jsonl` grew by
  one line). The single-writer *invariant* itself is a design Constraint (it asserts
  no second writer exists — not a behavior a unit test can prove).

## Constraints

- The daemon is the **only** writer to the markdown store; this seam is that single
  writer (PRD §6.1 single-writer invariant; Trade-off #9). Tests use a temp dir.
- STATE is rewritten (not appended); JOURNAL is append-only via the Epic 001 jsonl
  seam; the two disciplines are separate so plan-file git history stays a clean
  drift signal (PRD §6.2; §7.1.1 Decisions log #9).
- Frontmatter read/write uses the Epic 001 plan-file parser/serializer — no second
  parser here (PRD §6.1 rebuild reuses the writer's parser).
- File paths follow the §7.1.1 §3 layout (stem-named `*.state.md` /
  `*.journal.jsonl` siblings of the task file).

## Verification Gate

- `npm test` green for `src/store/feature-store.test.ts` using a temp dir.

### Task T1 - Write + read the feature triple and RUNBOOK

**Input:** `src/store/feature-store.ts`, `src/store/feature-store.test.ts`

**Action - RED:** Write a test that writes a feature (epic.md, one story INDEX.md,
one task .md + RUNBOOK.md) into a temp dir and reads it back, asserting frontmatter
+ body + RUNBOOK content match.

**Action - GREEN:** Implement `FeatureStore` over the Epic 001 filesystem + plan-file
seams with `writeFeature`/`readFeature` covering the triple + RUNBOOK.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - STATE rewrite vs JOURNAL append disciplines

**Input:** `src/store/feature-store.ts`, `src/store/feature-store.test.ts`

**Action - RED:** Write a test that writes a task `*.state.md` twice and asserts the
second content fully replaces the first; and appends two `*.journal.jsonl` events
and asserts both lines are present in order. Snapshot the feature dir's file list
before/after a `writeState` and assert only that one `*.state.md` changed (write
isolation — the observable form of single-writer).

**Action - GREEN:** Implement `writeState` (rewrite) and `appendJournal` (via the
Epic 001 jsonl seam) on the store.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

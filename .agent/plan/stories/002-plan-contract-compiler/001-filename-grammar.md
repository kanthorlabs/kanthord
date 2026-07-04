# Story 001 - Filename Grammar Walk & Parse

Epic: `.agent/plan/epics/002-plan-contract-compiler.md`

## Goal

Walk a feature directory and parse every story-directory and task-file name against
the grammar `<major>[.<lane>]-<slug>(.md | /)`, yielding a typed position
(major, optional lane, slug) per node, and rejecting malformed names as hard errors
worded in filename vocabulary.

## Acceptance Criteria

- A task file named `002-backend-impl.md` parses to major `2`, no lane, slug
  `backend-impl`; `02.1-clients-mobile/` parses to major `2`, lane `1`, slug
  `clients-mobile` (PRD §7.1.1 §4 examples).
- Nodes sharing a major are reported as one group; a group with two lanes (`N.1`,
  `N.2`) is reported as parallel-intended (PRD §7.1.1 §4 rules 1–2).
- Gaps in major numbers are legal — `001, 002, 004` parses without error and the
  group order is `1 < 2 < 4` (PRD §7.1.1 §4 rule 1: gaps encouraged).
- A malformed name is a hard error whose message names the offending **filename**,
  e.g. `"backend.md" is not a valid task filename (expected <major>[.<lane>]-<slug>)`
  — not a stack trace or graph-node id. Malformed covers, each as its own case:
  missing major prefix (`backend.md`), non-numeric major (`ab-backend.md`), empty
  slug (`01-.md`), non-numeric lane (`02.x-foo.md`), lane without major (`.1-foo.md`),
  and wrong extension for a task file (`002-backend.txt`).
- A malformed **story-directory** name (same grammar) is a hard error too, worded in
  filename vocabulary — not only task files (debate finding: grammar applies
  identically to both, PRD §7.1.1 §4).
- The slug must be non-empty; its character convention is kebab-case but is not
  rigidly enforced here (PRD §4 does not fix a slug charset — do not invent one).
- The stem-named sibling files (`NN-slug.state.md`, `NN-slug.journal.jsonl`) and
  `RUNBOOK.md`, `epic.md`, `INDEX.md` are recognized as their own kinds, not parsed
  as task files (PRD §7.1.1 §3 layout).

## Constraints

- The grammar is the only source of order + parallel intent at both story and task
  level (PRD §7.1.1 §4; Decisions log #5). No `order:`/`parallel_with:` frontmatter
  is read for hierarchy.
- Filename = position, frontmatter `id` = identity — this Story returns positions
  only; identity resolution is Story 002 (PRD §7.1.1 §4 rule 5).
- Malformed names are hard errors, not warnings (PRD §7.1.1 §7 step 1).

## Verification Gate

- `npm test` green for `src/compiler/grammar.test.ts` on valid + malformed fixtures.

### Task T1 - Parse a single node name

**Input:** `src/compiler/grammar.ts`, `src/compiler/grammar.test.ts`

**Action - RED:** Write a test parsing `002-backend-impl.md` and
`02.1-clients-mobile/` and asserting the `{ major, lane, slug, kind }` result for
each; and that each malformed name in the AC list — `backend.md`, `ab-backend.md`,
`01-.md`, `02.x-foo.md`, `.1-foo.md`, `002-backend.txt`, and a malformed story-dir
name — throws a typed error whose message names the filename.

**Action - GREEN:** Implement `parseNodeName(name)` returning the typed position or
throwing `GrammarError` with a filename-vocabulary message.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Walk a feature dir into grouped nodes

**Input:** `src/compiler/grammar.ts`, `src/compiler/grammar.test.ts`

**Action - RED:** Write a test over a temp feature dir fixture (epic.md, two story
dirs with INDEX.md + task files, one dir a `.1`/`.2` lane pair, a major gap) and
assert the walk returns story groups in major order, flags the lane pair as
parallel-intended, and classifies state/journal/RUNBOOK/INDEX files by kind.

**Action - GREEN:** Implement `walkFeature(dir)` (via the Epic 001 filesystem seam)
returning the typed node tree with per-node positions and kinds.

**Action - REFACTOR:** Extract the per-file kind classification into a named helper
if `walkFeature` grows beyond the walk loop; otherwise `none`.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

# Story 002 - Frontmatter Parse & Cross-Check

Epic: `.agent/plan/epics/002-plan-contract-compiler.md`

## Goal

Parse each node's frontmatter and cross-check the machine layer against the file
set: feature-wide unique ids, `depends_on` references that resolve to an existing
node with the referenced output declared, an `INDEX.md` in every story dir, the
shape's required guidance docs present, and every frontmatter id having a body
section (and vice versa).

## Acceptance Criteria

- Two nodes declaring the same `id` is a hard error naming both files and the
  duplicated id (PRD §7.1.1 §7 step 2 — unique ids feature-wide).
- A `depends_on: { task: t-x, output: payment-api }` where `t-x` does not exist, or
  exists but declares no `payment-api` output, is a hard error naming the consuming
  task and the missing task/output (PRD §7.1.1 §7 step 2).
- A story directory missing `INDEX.md` is a hard error naming the story dir.
- A missing required guidance doc (`RUNBOOK.md` for `tdd@1`) is a hard error naming
  the doc (PRD §7.1.1 §6, §8 required docs).
- The body/frontmatter cross-check is bidirectional (PRD §7.1.1 §2 — "every id in
  frontmatter has a body section **and vice versa**"): an id declared in
  frontmatter with no body section is flagged, **and** a `## ` body section whose id
  is declared nowhere in frontmatter is flagged. Both directions have a RED test.
- A `depends_on.semantics` value that is not one of `frozen` | `draft_ok` is a hard
  error naming the consuming task and the bad value (PRD §7.1.1 §5 — the only two
  edge semantics).
- All diagnostics name files/ids/story-dirs (planner vocabulary), not internal
  structures.

## Constraints

- Frontmatter is read via the Epic 001 plan-file parser; no re-implementation
  (Story reuses the format layer, PRD §7.1.1 §2).
- Cross-check ties the two layers by id only; it cannot and must not verify prose
  matches the declaration (PRD §7.1.1 §2 accepted trade-off / Trade-off #21).
- `depends_on` resolution is by frontmatter `id`, never by filename (PRD §7.1.1 §4
  rule 5 — refs use ids).

## Verification Gate

- `npm test` green for `src/compiler/crosscheck.test.ts` across each violation
  fixture, asserting the diagnostic text.

### Task T1 - Unique ids + resolvable depends_on

**Input:** `src/compiler/crosscheck.ts`, `src/compiler/crosscheck.test.ts`

**Action - RED:** Write tests: (a) two task files with the same `id` → error naming
both + the id; (b) a `depends_on` to a non-existent task → error naming consumer +
missing task; (c) a `depends_on` to an existing task lacking the referenced output
→ error naming consumer + missing output.

**Action - GREEN:** Implement `crossCheck(nodeTree)` building an id→node index and
validating each `depends_on` against declared `outputs`; throw typed
`CrossCheckError` with planner-vocabulary messages.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Structural docs + body/frontmatter cross-check

**Input:** `src/compiler/crosscheck.ts`, `src/compiler/crosscheck.test.ts`

**Action - RED:** Write tests: (a) a story dir without `INDEX.md` → error naming the
dir; (b) a feature without `RUNBOOK.md` → error naming the doc; (c) a task whose
frontmatter declares an output id with no matching body section → cross-check error;
(d) the **inverse** — a body section whose id has no frontmatter declaration →
cross-check error; (e) a `depends_on.semantics: maybe` → error naming task + value.

**Action - GREEN:** Extend `crossCheck` to assert required structural docs exist,
the bidirectional id↔section correspondence, and the `semantics` enum.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

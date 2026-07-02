# Story 004 - `tdd@1` Shape Lint

Epic: `.agent/plan/epics/002-plan-contract-compiler.md`

## Goal

Apply the `tdd@1` shape rules over both layers: required task body sections present
and non-empty, `workflow` pinned to `tdd@1` (override is an error), epic Acceptance
section non-empty, parallel-lane disjointness, orphan-artifact warning, and the
minimum structure (≥1 story, ≥1 task per story).

## Acceptance Criteria

- A task missing any of the required body sections — `## Prerequisites`,
  `## Inputs`, `## Outputs`, `## Tests` — or having one present-but-empty, is an
  error naming the task and the section (PRD §7.1.1 §8 required task body sections).
- A task frontmatter `workflow` set to anything other than `tdd@1` is an error
  ("a task that cannot do TDD means the feature is in the wrong shape") (PRD §7.1.1
  §8; Decisions log #2).
- An `epic.md` with no `## Acceptance` section, or an empty one, is an error naming
  the epic (PRD §7.1.1 §8).
- Two same-group tasks with overlapping `write_scope`, or with a dependency path
  connecting them, is an error, e.g. `"003.1 and 003.2 both write lib/shared/ — they
  cannot share a group"` (PRD §7.1.1 §4 rule 2, §8 shape lint).
- An artifact output that is produced but never consumed and is not a `pr`/deploy is
  a **warning** (decomposition smell), not an error (PRD §7.1.1 §8 orphan warning).
- A feature with zero stories, or a story with zero tasks, is an error (PRD §7.1.1
  §8 ≥1 story / ≥1 task).
- Warnings and errors are distinguishable in the result (a warning does not fail the
  compile; an error does).

## Constraints

- Shape lint is `tdd@1`-specific and hardcoded in core, not a plugin (PRD §7.1.1
  note; Appendix A deferred).
- Section presence/non-empty is checked via the Epic 001 section extractor; content
  is prose and is **not** semantically validated (PRD §7.1.1 §2, §8 "content is
  prose").
- Same-group overlap uses `write_scope` path prefixes + the edge set from Story 003;
  disjointness is the parallel-safety rule the grammar asserts (PRD §7.1.1 §4 rule 2,
  §8). The rule is **exactly** `write_scope` overlap + connecting dependency path —
  it does NOT check repos/tickets/`resources`. `resources:` collisions (ports, test
  DBs) are a **runtime lease** concern (PRD §7.3), enforced by Epic 004, not a
  compile-time lint (debate finding — do not expand this rule beyond §8).
- The **forward-handoff** rule that §8 also lists as a shape rule is implemented and
  RED-tested in Story 003 (core lint); this Story does not duplicate it. Story 003
  is its coverage owner (debate finding — a §8 rule must have a named owner).
- Diagnostics name stories/tasks/handoffs, not graph nodes (PRD §7.1.1 §7).

## Verification Gate

- `npm test` green for `src/compiler/shape-lint.test.ts` on each rule's fixture,
  asserting error vs warning classification and diagnostic text.

### Task T1 - Required sections, workflow pin, Acceptance section

**Input:** `src/compiler/shape-lint.ts`, `src/compiler/shape-lint.test.ts`

**Action - RED:** Write tests: (a) a task missing `## Tests` and one with an empty
`## Inputs` → errors naming task + section; (b) a task with `workflow: custom@1` →
override error; (c) an epic with no `## Acceptance` → error naming the epic.

**Action - GREEN:** Implement `shapeLint(nodeTree)` checking required sections
(presence + non-empty), the workflow pin, and the epic Acceptance section; return
typed errors with planner-vocabulary messages.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Lane disjointness, orphan-artifact warning, minimum structure

**Input:** `src/compiler/shape-lint.ts`, `src/compiler/shape-lint.test.ts`

**Action - RED:** Write tests: (a) two `003.1`/`003.2` tasks with overlapping
`write_scope` → error with the `"both write lib/shared/"`-style message; (b) an
artifact output never consumed and not a pr → a **warning** that does not fail the
compile; (c) a feature with a story that has no task → error.

**Action - GREEN:** Extend `shapeLint` with the disjointness check (over
`write_scope` + Story 003 edges), the orphan-output warning, and the minimum
structure checks; classify each finding as error or warning.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

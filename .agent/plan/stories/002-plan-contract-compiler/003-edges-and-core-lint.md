# Story 003 - Build Edges & Core Lint

Epic: `.agent/plan/epics/002-plan-contract-compiler.md`

## Goal

Turn positions + frontmatter into the dependency graph: grammar edges (each group
depends on the previous existing major, at both story and task level) plus explicit
`depends_on` handoff edges; then run the shape-independent core lint — acyclic,
repos registered, every node has a ticket ref, no forward handoffs.

## Acceptance Criteria

- Group `N` gets an edge from every node in the previous existing major group;
  gaps are skipped (a `004` group depends on `002` when `003` is absent) (PRD
  §7.1.1 §4 rule 1).
- An explicit `depends_on` adds an edge beyond the grammar (PRD §7.1.1 §4 rule 4).
- A dependency cycle is a hard error identifying the tasks on the cycle by id/slug
  (PRD §7.1.1 §7 step 3 — acyclic).
- A task whose `repo` is not in the repo registry is a hard error naming the task
  and the unregistered repo (PRD §7.1.1 §7 step 3 — repos registered).
- A node without a ticket ref is a hard error naming the node (PRD §7.1.1 §7 step 3;
  §6.3 no task without a source of truth).
- A handoff that points **forward** (to a higher group or a later story) is a hard
  error worded in filename/story vocabulary, e.g. `"story 01 cannot depend on story
  03"` (PRD §7.1.1 §4 rule 4, §7 step 3; §8 shape lint).

## Constraints

- Grammar edges + explicit handoff edges are the only two execution inputs; the
  grammar can assert intent but never contradict edges/scopes (PRD §7.1.1 §4 rule 3).
- Repo registration is checked against the yaml repo registry loaded via the Epic
  001 registry loader (PRD §3.3 per-repo config; §7.1.1 §7 step 3).
- Forward-handoff detection compares group major / story order — reported in
  planner vocabulary, caught pre-compile (PRD §7.1.1 §4 rule 4).

## Verification Gate

- `npm test` green for `src/compiler/edges.test.ts` on valid + each invalid fixture.

### Task T1 - Grammar edges with gaps + explicit handoff edges

**Input:** `src/compiler/edges.ts`, `src/compiler/edges.test.ts`

**Action - RED:** Write a test over a fixture with groups `001, 002, 004` and one
explicit `depends_on`, asserting the edge set: `002←001`, `004←002` (gap skipped),
plus the explicit handoff edge; lane siblings `N.1`/`N.2` get no edge between them.

**Action - GREEN:** Implement `buildEdges(nodeTree)` producing grammar edges
(previous existing major) + explicit handoff edges at story and task level.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Core lint: acyclic, repos, tickets, no forward handoff

**Input:** `src/compiler/edges.ts`, `src/compiler/edges.test.ts`

**Action - RED:** Write tests each on a targeted invalid fixture: (a) a cycle →
error listing the cycle's task ids; (b) a task on an unregistered repo → error
naming task + repo; (c) a node missing `ticket` → error naming the node; (d) a
forward handoff → `"story 01 cannot depend on story 03"`-style error.

**Action - GREEN:** Implement `coreLint(nodeTree, edges, repoRegistry)` running the
four checks; throw typed `CoreLintError` with planner-vocabulary messages. Use a
standard cycle-detection pass over the edge set.

**Action - REFACTOR:** Extract cycle detection into a named helper; otherwise
`none`.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

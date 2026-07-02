# 002 Plan Contract Compiler (`tdd@1`, hardcoded)

## Outcome

A valid `tdd@1` feature directory compiles — on an explicit sign-off call — into
the Core Execution Plan (nodes, edges, scopes, gates, artifacts) as SQLite rows,
stamped with a `compile_hash` and a monotonically increasing generation; an
**invalid** feature directory is rejected with diagnostics phrased in the
planner's vocabulary (stories/tasks/handoffs), never as graph-node internals. The
whole pipeline runs with **no LLM and no network** — this is the deterministic
surface the PRD promises is testable without a model (PRD §7.1). The `tdd@1` rules
are implemented **directly in core**, not as a plugin (PRD §7.1.1 note; Appendix A
deferred).

## Decision Anchors

- PRD §7.1.1 §7 — the five-step pipeline: (1) walk & parse names, (2) parse
  frontmatter & cross-check, (3) build edges & core lint, (4) shape lint, (5)
  compile → SQLite + core-lint the output; write `compile: { shape, hash, at }`.
- PRD §7.1.1 §4 — filename grammar `<major>[.<lane>]-<slug>(.md | /)`; group =
  same major; lanes = parallel-intended; malformed names are hard errors.
- PRD §7.1.1 §8 — the `tdd@1` shape: required task body sections, workflow pinned,
  epic Acceptance section, shape lint rules, compilation rules (gate pair, artifact
  registry, phase-0 setup gate).
- PRD §7.1.1 §7 dirty detection — `compile_hash` over the file set **including
  filenames**, **excluding** RUNBOOK/state/journal; each compile stamps generation
  `G`.
- PRD §7.1 — coordination contract, not correctness contract; lint checks shape,
  not wisdom; the ingest lint is DAG-**acyclic**, repos **registered**, **gates
  well-formed**, every node has a **ticket ref**; diagnostics speak planner
  vocabulary.
- phases.md Phase 1 Deliverable 1 + gate — invalid plan set rejected with
  planner-vocabulary diagnostics asserted against expected diagnostic text.

**Diagnostic-vocabulary rule (applies to every Story here):** every rejection path
— filename, cross-check, core lint, shape lint, and compiled-output re-lint — has a
RED test that asserts the diagnostic **text** names the offending
story/task/handoff/file (planner vocabulary), never an internal graph-node id or a
stack trace (PRD §7.1.1 §7; phases.md gate).

## Stories

- `001-filename-grammar.md` — walk a feature dir and parse story-dir + task-file
  names against the grammar; malformed names are hard errors in filename vocabulary.
- `002-frontmatter-crosscheck.md` — parse node frontmatter; enforce feature-wide
  unique ids, resolvable `depends_on` with declared outputs, per-story `INDEX.md`,
  required guidance docs, and body/frontmatter cross-check.
- `003-edges-and-core-lint.md` — build grammar + explicit-handoff edges; core lint:
  acyclic, repos registered, every node has a ticket ref, no forward handoffs.
- `004-tdd-shape-lint.md` — the `tdd@1` shape rules: required body sections,
  workflow-override error, epic Acceptance section, parallel-lane disjointness,
  orphan-artifact warning, ≥1 story / ≥1 task-per-story.
- `005-compile-and-generation.md` — emit SQLite rows (feature/story/task nodes,
  edges, gate pair, artifact registry, phase-0 setup gate); write
  `compile: { shape, hash, at }`; stamp generation; re-lint the emitted graph.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites.
- A **valid** golden `tdd@1` fixture (2 stories, one parallel lane, an artifact
  handoff, a gate pair) compiles to the expected node/edge/gate/artifact rows
  (asserted row-by-row against the SQLite store from Epic 001).
- An **invalid** fixture set — cycle, forward handoff, overlapping lanes, missing
  ticket ref, missing required body section, workflow override — is rejected, each
  with a diagnostic whose text is asserted to name the offending story/task/handoff
  (planner vocabulary), not a graph node id.
- Re-compiling an unchanged file set yields the **same** `compile_hash`; changing
  any covered file (content or a filename) changes the hash and mints generation
  `G+1`; editing only RUNBOOK/state/journal does **not** change the hash.

## Dependencies

- **Epic 001** (SQLite runtime store, plan-file frontmatter/section parser, yaml
  registry loader, migration-runner seam). Epic 002 adds its own migration for the
  compiled-plan tables.
- Epic 001's `sqlite-access.md` findings (confirmed SQLite API/flag).

## Non-Goals

- No shape *plugin* framework, no `PlanShape` interface/registry — `tdd@1` is
  hardcoded (PRD §7.1.1 note; Appendix A deferred; do not build it).
- No scheduling/dispatch — the compiler only **emits** nodes/edges/gates; the DAG
  poll, leases, and generation-based *dispatch halting* are Epic 004.
- No markdown store / rebuild-from-markdown — the projection contract is Epic 003.
- No correctness judgement of the plan — lint proves it executes as written, not
  that it is wise or the code will be right (PRD §7.1).
- No `kanthord renumber` tooling (Phase 3).

## Non-Goals - deliberate MVP simplification

- The full **untrusted-shape** compiled-output re-validation (Appendix A — a buggy
  *plugin* shape cannot hand core an invalid plan) is not built (PRD §7.1.1 §1
  deferred). But step-5 re-lint is **not** weakened to edges-only: because the
  emitted plan feeds the scheduler, Story `005` re-lints the whole emitted graph
  (edges + gates + artifacts) for well-formedness as a testable pure function
  (debate finding — this is the deterministic surface the scheduler trusts).

## Compiled-plan schema (the column contract Epics 003/004 read)

Documented here in the Epic (engineers cannot write to `.agent/plan/**`; lane-check
denies it, so this is not a TDD task). Story `005`'s migration creates these tables;
their exact columns are asserted by `005` T1's row tests and are the contract Epic
003 (projection) and Epic 004 (scheduler) code against:

- `plan_node(id, kind[epic|story|task], feature_id, repo, ticket_system, ticket_ref,
  major, lane, slug, generation)`
- `plan_edge(from_node_id, to_node_id, kind[grammar|handoff], semantics[frozen|
  draft_ok|null])`
- `plan_gate(node_id, phase, position[entry|exit], name, artifact_id[null],
  semantics[frozen|draft_ok|null])` — `tdd@1` names: `failing_test_exists`,
  `tests_pass`, artifact-consumption, phase-0 setup.
- `plan_artifact(id, publisher_node_id, kind, path)` + `plan_artifact_consumer(
  artifact_id, consumer_node_id)`.
- `plan_generation(generation, compile_hash, at, feature_id)`.

If Story `005` diverges from these columns, it updates this section as part of the
plan-authoring change (a locked-plan edit, done by the author, not the engineers).

## Findings Out

- none as a TDD-task output — the downstream column contract is the "Compiled-plan
  schema" section above (in this locked Epic), because `.agent/plan/**` is not
  writable by any engineer lane.

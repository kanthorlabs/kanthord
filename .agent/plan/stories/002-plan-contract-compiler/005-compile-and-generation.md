# Story 005 - Compile to SQLite + Generation Stamping

Epic: `.agent/plan/epics/002-plan-contract-compiler.md`

## Goal

Lower a lint-clean feature into the Core Execution Plan as SQLite rows — feature/
story/task nodes, edges, the TDD gate pair, the artifact registry, and the phase-0
setup gate — re-lint the **emitted graph** for well-formedness, write the
`compile: { shape, hash, at }` block into `epic.md`, and stamp a monotonic
generation. Table columns are the "Compiled-plan schema" section of the Epic.

## Acceptance Criteria

- Compiling the golden valid fixture writes: one feature node (epic), story nodes,
  task nodes; grammar + handoff edges; per handoff an artifact-consumption **entry
  gate** carrying the declared `frozen`/`draft_ok` semantics **as data only**; per
  task with a `## Tests` section the **TDD gate pair** (entry `failing_test_exists`,
  exit `tests_pass`); per `artifact` output a registry row (publisher = producing
  task, consumers = referencing tasks); per task `## Prerequisites` env commands a
  phase-0 setup gate (PRD §7.1.1 §8 compilation rules 1–7). No dispatch/readiness
  decision is made here — this Story only emits data (PRD §7.3 owns enforcement).
- The epic's `## Acceptance` compiles into a feature-level exit-criterion row (PRD
  §7.1.1 §8 rule 1).
- If the epic frontmatter declares a **deploy chain**, its stages compile into
  **deploy-stage nodes** appended to the DAG past the PR nodes, each carrying its
  ordered observer handlers + success criteria + soak duration as data (PRD §7.1.1 §8
  rule 7; §7.4 — the DAG continues past PR into deploy stages). This is the compiled
  definition Epic 008's executor consumes (not an ad-hoc fixture).
- The **emitted-graph re-lint** (`relintCompiledGraph`) rejects, with a diagnostic:
  a dangling edge endpoint, a gate whose owner node does not resolve, a gate whose
  name is not in `tdd@1`'s gate vocabulary, an artifact whose publisher/consumer
  node does not resolve, and a cycle in the emitted edges. A graph that fails
  re-lint is **not committed** to the store (PRD §7.1.1 §7 step 5 — core-lint the
  output; "gates well-formed" §7.1).
- After compile, `epic.md` frontmatter has a `compile: { shape: tdd@1, hash, at }`
  block (PRD §7.1.1 §7 step 5).
- `compile_hash` covers the full file set **including filenames** — a change to
  `epic.md` body, an `INDEX.md`, a task file's content, or a **rename** of any task
  file or story directory changes the hash; and it **excludes** RUNBOOK /
  `*.state.md` / `*.journal.jsonl` — editing any of those does not change the hash
  (PRD §7.1.1 §7 step 5, §6 runbook excluded).
- Recompiling an **unchanged** file set yields the same `compile_hash` and keeps the
  same generation `G` (no new generation is minted, no duplicate generation row);
  recompiling after a covered-file change stamps `G+1` (monotonic, never reused)
  (PRD §7.1.1 §7 dirty detection).
- Compilation happens **only** on the explicit `compile()` call: walking or linting
  the feature writes **no** plan rows and no `compile:` block (PRD §7.1.1 §7 —
  explicit sign-off action, never a watcher reaction).
- **Clone-on-sign-off (§6.3):** at sign-off `compile()` reads each node's
  source-of-truth via an injected **source-provider seam** (a fake in Phase 1) and
  snapshots its `content_hash` + `snapshot_at` onto the node (frontmatter/compiled
  row). This is the snapshot the Epic 006 phase-boundary drift hook later re-hashes
  against (PRD §6.3 — snapshot ticket content into the task at sign-off; debate
  finding — this half of the drift mechanism is owned here, not in the harness).

## Constraints

- Compilation is an explicit **sign-off action**, never a file-watcher reaction
  (PRD §7.1.1 §7; Decisions log #8).
- The IR is SQLite rows only; nothing is hand-editable and no IR file is written
  (PRD §7.1.1 §1, Decisions log #7). Rows go through the Epic 001 store seam via a
  compiled-plan migration this Story adds (columns per the Epic's schema section).
- Gate vocabulary is bound by the shape (`failing_test_exists`/`tests_pass` are
  `tdd@1`'s gates; there is no global gate enum) (PRD §7.1.1 §8 rule 6).
- `compile_hash` is a canonical serialization of the covered file set (sorted
  relative paths + bytes), deterministic across runs and machines (PRD §7.1.1 §7).
- `relintCompiledGraph(graph)` is a pure function over the in-memory emitted graph
  so it is unit-testable on hand-built malformed graphs without inducing a compiler
  bug (debate finding — the re-lint failure must be observable).
- Emission is split into a **pure** `buildCorePlan(fileSet) → graph` step (no store
  write, no side effect) and a separate store-write step; `compile()` composes them.
  This lets Epic 003's rebuild re-derive the plan from markdown by calling the pure
  `buildCorePlan`, not the side-effecting `compile` (debate finding — rebuild must
  depend on a pure derivation API, not an operational command).

## Verification Gate

- `npm test` green for `src/compiler/compile.test.ts`.
- Row-level assertions of the compiled golden fixture against the Epic 001 SQLite
  store (nodes, edges, gates, artifact registry).
- Re-lint, hash-coverage (incl. epic.md/INDEX.md/rename/content and RUNBOOK/state/
  journal exclusion), generation (increment on change, stable on no-change), and
  sign-off-only (no rows on walk/lint) assertions all green.

### Task T1 - Emit graph to SQLite + re-lint the emission

**Input:** `src/compiler/compile.ts`, `src/compiler/compile.test.ts`

**Action - RED:** Write (a) a test compiling the golden valid fixture and asserting
the rows written to a temp-file store (nodes; grammar + handoff edges; TDD gate
pair; artifact-consumption entry gates with `frozen`/`draft_ok`; artifact-registry
rows with publisher/consumers; phase-0 setup gate; feature-level exit criterion;
**deploy-stage nodes appended past the PR nodes when the epic declares a deploy
chain, carrying ordered handlers + criteria + soak as data**); and (b) direct unit
tests of `relintCompiledGraph` on hand-built malformed graphs —
dangling edge endpoint, unresolved gate owner, gate name outside `tdd@1` vocabulary,
unresolved artifact publisher/consumer, emitted cycle — each asserting a diagnostic
and that a failing graph is **not** committed.

**Action - GREEN:** Add the compiled-plan migration (tables per the Epic's schema
section). Implement the pure `buildCorePlan(fileSet) → graph` applying compilation
rules 1–7 (no store write), then `compile(fileSet, store)` = `buildCorePlan` +
`relintCompiledGraph` + store write, aborting the write on re-lint failure.

**Action - REFACTOR:** Split the per-rule emitters into named functions if `compile`
grows past a short orchestration body; otherwise `none`.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - compile_hash coverage, generation semantics, sign-off write

**Input:** `src/compiler/compile.ts`, `src/compiler/compile.test.ts`

**Action - RED:** Write tests: (a) recompiling an unchanged fixture yields an equal
`compile_hash` and the **same** generation `G` (no new generation row); (b) editing
`epic.md` body, an `INDEX.md`, and a task file's content each change the hash; (c)
renaming a task file **and** renaming a story directory each change the hash; (d)
editing `RUNBOOK.md`, a `*.state.md`, and a `*.journal.jsonl` each leave the hash
unchanged; (e) a covered-file change on recompile stamps `G+1`; (f) after compile,
`epic.md` has the `compile: { shape, hash, at }` block; (g) calling `walkFeature`
and the lint stages alone writes **no** rows and no `compile:` block.

**Action - GREEN:** Implement the canonical file-set hash (sorted paths + bytes,
excluding RUNBOOK/state/journal), generation stamping (equal hash ⇒ reuse `G`;
changed ⇒ `G+1`), the `serializeFrontmatter`-based write of the `compile:` block into
`epic.md`, and the clone-on-sign-off source snapshot (`content_hash` + `snapshot_at`
per node from the injected source-provider seam). Ensure walk/lint have no write side
effects.

Add a RED case: after compile, each node carries a `content_hash` + `snapshot_at`
from the fake source provider.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

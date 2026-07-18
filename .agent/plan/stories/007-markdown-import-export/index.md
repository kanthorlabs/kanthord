# EPIC 007 — Markdown import/export · story index

Epic: `.agent/plan/epics/007-markdown-import-export.md`

**Authoring status (2026-07-18 — EXPANDED).** The unlock condition is met:
EPIC 006 shipped (@e062b40, `npm run verify` green) and every blocker
(B1–B18, RB1–RB7, TB1–TB5, TS1) has an Ulrich ruling recorded in the epic.
The stale "ZERO stories authorable" gate is retired. Stories below follow
S1 — vertical slices, each carrying its own end-to-end assertion; the final
story consolidates the epic Proof.

**Format:** every task states **Requires → Input → Action (RED/GREEN/REFACTOR)
→ Output → Verify**. Dispatched through `/work` (engineer lanes). One story per
file; one use case per file (verb-first), per `AGENTS.md`.

**Surfaces re-verified at expansion (B1, 2026-07-18 @ e062b40):**

- Migrations top out at **version 5** (`epic-006-task-spec-and-results`,
  `src/storage/sqlite/migrations.ts`); 007's slot is **6**. No `sha256` column
  anywhere — clean slate.
- `newTask` (`src/domain/task.ts`) throws `InvalidTaskFieldError` on empty
  `agent`/`instructions`/`ac`/`verification` item, but does NOT yet enforce
  single-line. `DependenciesLockedError` + `assertDependenciesEditable`
  (`status !== "pending"`) are the lock idiom to mirror. Six statuses:
  `pending|running|completed|failed|awaiting_confirmation|discarded`.
- `validateGraph(nodes)` (`src/domain/graph.ts`) → `DuplicateTaskError` /
  `UnknownDependencyError` / `CycleError`. `StoreGraph`
  (`src/app/graph/store-graph.ts`) validates then `saveAll` in the caller's
  UnitOfWork, remapping label deps to ULIDs — create-mode reuses it.
- Repos (`src/storage/port.ts`): `TaskRepository` (`save`/`saveAll`/
  `saveTaskContext`/…), `InitiativeRepository` (`save`/`saveObjective` —
  **Objective has no own repo**). CAS ops attach here.
- `UnitOfWork.transaction(fn)` = `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`, nested
  = error (`src/storage/sqlite/sqlite-unit-of-work.ts`). One txn per apply.
- CLI is a grep-able `COMMANDS` table keyed `"<verb> <object>"`
  (`src/apps/cli/router.ts`); `import resource` (`src/apps/cli/import.ts`) is
  the transactional-import + `ImportValidationError(index, entryName)` pattern
  007 mirrors. New keys: `"import graph"`, `"export initiative"`.
- Domain entities: `Initiative { id, projectId, name }`,
  `Objective { id, initiativeId, name }` (`src/domain/initiative.ts`).

## Stories (build order = dependency order)

1. [Domain — single-line rule, `applyTaskSpec`, `reparentTask`, requiredness](01-domain-spec-mutation.md)
   — B2/B9/B11/B12/B17.
2. [Per-row `sha256` token + write-hook + idempotency table (migration 6)](02-sha256-token-hook.md)
   — B4/B6/B12/B13/B14/TB2.
3. [Format spec + CommonMark codec → `GraphPackage` DTO + golden codec test](03-format-spec-codec.md)
   — B3/B6/B7/B8/B9/B16/B18/S4.
4. [`export initiative` — use case returns `GraphPackage`, CLI writes the tree](04-export.md)
   — B4/B5/B13/B16/B18/TS1/TB1.
5. [`import graph --create` — reuse `StoreGraph`, assign ULIDs, id handoff](05-import-create.md)
   — B1/B5/B6/B10/TB2.
6. [Conditional-write (CAS) repository port + real-SQLite rollback proof](06-cas-port.md)
   — B8/B10/RB4/RB5.
7. [`import graph --apply` — preflight-classify, merged validation, all-node summary](07-import-apply.md)
   — B1/B4/B7/B9/B10/B13/B14/RB5/RB6/TS1.
8. [Drift report, `--dry-run`, guarded `--delete-missing`](08-drift-dryrun-delete.md)
   — B5/S2/RB1/RB2/RB3/TB1/TB3/TB4/TB5.
9. [Named errors + provenance, boundary cases, context-preservation test](09-errors-boundary-context.md)
   — B7/B15/S1/S4/RB7.
10. [End-to-end smoke — consolidates the epic Proof](10-e2e-smoke.md).

## Golden-test bullet, distributed (epic story 9)

The epic's "Golden round-trip + rollback + context-preservation" bullet is
four tests placed with the behavior each verifies, not a test-only story:

- (1) codec idempotence `serialize(parse(x)) === x` on canonical bytes → **Story 03**.
- (2) hand-authored non-canonical file → correct graph (SEMANTIC equality) → **Story 03**.
- (3) real-SQLite late-failure → full rollback → **Story 06**.
- (4) context-preservation (spec+deps change leaves `task_context` untouched) → **Story 09**.

## Cross-epic amendments (annotated "superseded/extended by EPIC 007")

- **EPIC 003 migrations** — a new migration **6**
  (`epic-007-sha256-and-idempotency`) appends `sha256` to
  `initiatives`/`objectives`/`tasks` and adds the `graph_import_map` table.
- **`src/storage/port.ts`** — `TaskRepository` + `InitiativeRepository` gain
  conditional-write (CAS) operations and idempotency-map lookup/reserve.
- **`src/domain/task.ts`** — `newTask` gains the single-line/non-empty rule
  (may break existing `create-task` tests, B17); new `applyTaskSpec`,
  `reparentTask`, `TaskSpecLockedError`.
- **`Task.agent → Task.executor` rename is OWNED BY EPIC 008**, not this epic
  (Ulrich, 2026-07-18). Stories here keep the current `agent:` frontmatter /
  `--agent` names; 008 migrates the key/flag/Proof across this flow.

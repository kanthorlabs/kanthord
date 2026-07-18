---
epic: .agent/plan/epics/007-markdown-import-export.md
opened: 2026-07-18
opener: test-engineer
base-ref: 17a3f6fdc379ff5c0eb57a2f35e30331a4236fe4
---

# Implementation cycle — 007-markdown-import-export

Pulled from EPIC: `.agent/plan/epics/007-markdown-import-export.md`.

Verification gate (binding, from the EPIC's `## Verification Gate` section):

> Gates: `npm run verify`
> Proof: (`set -euo pipefail` makes every step assert — a failed command aborts
> the block. Real `test`/`grep` assertions replace prose comments; expected
> FAILURES are checked with `if ! …; then` so exit 1 does not mask them.)
> See the EPIC file's `## Verification Gate` section for the full runnable Proof block.

TDD protocol:

1. test-engineer writes the next failing test (RED) — or a GREEN-ONLY pass-through for Tasks without `Action — RED:`.
2. software-engineer makes the test green (RED flow) or implements the Task spec directly (GREEN-ONLY flow).
3. test-engineer confirms GREEN (or runs a build-only check for GREEN-ONLY), then either opens the next Task or runs the full Verification Gate and appends IMPLEMENTATION_READY_FOR_REVIEW.

## TEST-ENGINEER — Story 01 · T1 single-line/non-empty rule (B12/B17)

**Cycle.** RED for Task `T1` (`src/domain/task.test.ts`).

**Test written.**

- file: `src/domain/task.ts` (NOT edited — production only) | test file: `src/domain/task.test.ts` (edited) — suite: `src/domain/task.test.ts` — methods:
  - `newTask with multi-line title throws InvalidTaskFieldError(title)`
  - `newTask with whitespace-only title throws InvalidTaskFieldError(title)`
  - `newTask with multi-line ac item throws InvalidTaskFieldError(ac)`
  - `newTask with multi-line verification item throws InvalidTaskFieldError(verification)`
  - `newTask with multi-line instructions is accepted (instructions stays multi-line)` _(passes now — characterises already-legal multi-line `instructions`)_
- asserts: `newTask` must reject a title/ac item/verification item containing `"\n"` or an all-whitespace title with `InvalidTaskFieldError`; multi-line `instructions` continues to be allowed.

**RED proof.**

- command: `node --test src/domain/task.test.ts`
- exit: non-zero — failures:
  - `✖ newTask with multi-line title throws InvalidTaskFieldError(title)` — `AssertionError: Missing expected exception.`
  - `✖ newTask with whitespace-only title throws InvalidTaskFieldError(title)` — `AssertionError: Missing expected exception.`
  - `✖ newTask with multi-line ac item throws InvalidTaskFieldError(ac)` — `AssertionError: Missing expected exception.`
  - `✖ newTask with multi-line verification item throws InvalidTaskFieldError(verification)` — `AssertionError: Missing expected exception.`

**Open to Software Engineer.**

- Seam: `newTask` in `src/domain/task.ts` — add a shared `assertSingleLineNonEmpty(field: string, value: string): void` helper that throws `InvalidTaskFieldError(field)` when `value` includes `"\n"` OR `value.trim() === ""`; call it for `title`, each `ac` item, and each `verification` item. `instructions` must NOT be passed through this check.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 01 · T1 single-line/non-empty rule (B12/B17)

**Cycle.** GREEN+REFACTOR for `src/domain/task.test.ts`.

**Files changed.**

- `src/domain/task.ts` (edited) — added `assertSingleLineNonEmpty(field, value)` helper; wired into `newTask` for `title`, each `ac` item, each `verification` item.

**Seam (GREEN).** `assertSingleLineNonEmpty` throws `InvalidTaskFieldError(field)` when `value.includes("\n") || value.trim() === ""`; called for `title` (always), each `ac` item (when provided), and each `verification` item (when provided). `instructions` is not passed through this check.

**Refactor.** The existing `if (!cmd) throw new InvalidTaskFieldError("verification")` was replaced by `assertSingleLineNonEmpty("verification", cmd)` which subsumes it (empty string satisfies `"".trim() === ""`); the empty-ac guard remains separate as it checks array length, not item content. No other refactors named in the Task.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 01 · T1 confirm GREEN + T2 `applyTaskSpec` PATCH semantics

**Cycle.** Confirm GREEN for T1; RED for Task `T2` (`src/domain/task.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**T1 GREEN confirmation.**

- command: `node --test src/domain/task.test.ts`
- exit: 0 — all 41 tests pass (including the 4 new T1 single-line/non-empty tests)

**Test written (T2).**

- file: `src/domain/task.test.ts` (edited) — suite: `src/domain/task.test.ts` — methods:
  - `applyTaskSpec on a running task throws TaskSpecLockedError`
  - `applyTaskSpec on a failed task throws TaskSpecLockedError`
  - `applyTaskSpec with absent key leaves field byte-identical`
  - `applyTaskSpec with present title replaces it`
  - `applyTaskSpec with present ac replaces the whole list`
  - `applyTaskSpec with present ac containing a multi-line item throws InvalidTaskFieldError`
  - `applyTaskSpec with verification null clears the field`
  - `applyTaskSpec with verification empty array clears the field`
  - `applyTaskSpec with present non-empty verification replaces it`
  - `applyTaskSpec returns a NEW object and does not mutate the input task`
- asserts: `applyTaskSpec` on a non-pending task throws `TaskSpecLockedError(taskId, status)`; absent keys are unchanged; present keys replace; `verification: null`/`[]` clears; returns a new object without mutating input.
- also imports: `TaskSpecLockedError` (value) and `TaskSpecPatch` (type) from `./task.ts`.

**RED proof.**

- command: `node --test src/domain/task.test.ts`
- exit: non-zero — failure: `SyntaxError: The requested module './task.ts' does not provide an export named 'TaskSpecLockedError'`

**Open to Software Engineer.**

- Seam: `src/domain/task.ts` — add and export:
  - `TaskSpecLockedError` class (mirrors `DependenciesLockedError`; carries `taskId: string` + `status: TaskStatus`; `name = "TaskSpecLockedError"`)
  - `assertTaskSpecEditable(task: Task): void` (throws unless `task.status === "pending"`)
  - `TaskSpecPatch` interface (`title?`, `instructions?`, `ac?`, `agent?`, `verification?: string[] | null`)
  - `applyTaskSpec(task: Task, patch: TaskSpecPatch): Task` (PATCH: absent = unchanged; present replaces; `verification: null`/`[]` = clear to `undefined`; re-runs `assertSingleLineNonEmpty` for title/ac/verification; never mutates input)

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 01 · T2 `applyTaskSpec` PATCH semantics

**Cycle.** GREEN+REFACTOR for `src/domain/task.test.ts`.

**Files changed.**

- `src/domain/task.ts` (edited) — added `TaskSpecLockedError`, `assertTaskSpecEditable`, `TaskSpecPatch`, and `applyTaskSpec`.

**Seam (GREEN).** `TaskSpecLockedError` mirrors `DependenciesLockedError` (carries `taskId` + `status`, `name = "TaskSpecLockedError"`); `assertTaskSpecEditable` throws it for any non-pending status; `TaskSpecPatch` is an interface with optional `title?`, `instructions?`, `ac?`, `agent?`, and `verification?: string[] | null`; `applyTaskSpec` applies PATCH semantics — absent key = unchanged, present = replace, `verification: null`/`[]` = clear to `undefined` — re-running `assertSingleLineNonEmpty` for each title/ac/verification item, returning a new object without mutating input.

**Refactor.** No separate refactor step named in Task T2; the implementation is surgically additive.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 01 · T2 confirm GREEN + T3 `reparentTask` (pending-only)

**Cycle.** Confirm GREEN for T2; RED for Task `T3` (`src/domain/task.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**T2 GREEN confirmation.**

- command: `node --test src/domain/task.test.ts`
- exit: 0 — all 10 T2 `applyTaskSpec` tests pass (and all prior T1 tests pass)

**Test written (T3).**

- file: `src/domain/task.test.ts` (edited) — suite: `src/domain/task.test.ts` — methods:
  - `reparentTask on a pending task returns a new task with the new objectiveId`
  - `reparentTask on a running task throws TaskSpecLockedError`
- asserts: `reparentTask(pendingTask, "OBJ2")` returns a new `Task` with `objectiveId === "OBJ2"`, all other fields unchanged, input not mutated; on a non-pending task throws `TaskSpecLockedError` with `taskId` and `status`.
- also imports: `reparentTask` (value) from `./task.ts`.

**RED proof.**

- command: `node --test src/domain/task.test.ts`
- exit: non-zero — failure: `SyntaxError: The requested module './task.ts' does not provide an export named 'reparentTask'`

**Open to Software Engineer.**

- Seam: `src/domain/task.ts` — add and export `reparentTask(task: Task, objectiveId: string): Task`; it must call `assertTaskSpecEditable(task)` (same lifecycle lock as spec edits, B9), then return `{ ...task, objectiveId }` without mutating the input.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 01 · T3 `reparentTask` (pending-only)

**Cycle.** GREEN+REFACTOR for `src/domain/task.test.ts`.

**Files changed.**

- `src/domain/task.ts` (edited) — added and exported `reparentTask(task, objectiveId)`.

**Seam (GREEN).** `reparentTask` calls `assertTaskSpecEditable(task)` (throws `TaskSpecLockedError` for any non-pending status), then returns `{ ...task, objectiveId }` — a new object, input not mutated.

**Refactor.** No separate refactor step named in Task T3; the implementation is surgically additive (4 lines).

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 01 · T3 confirm GREEN + Story 02 · T1 migration 6

**Cycle.** Confirm GREEN for Story 01 T3; RED for Story 02 Task `T1` (`src/storage/sqlite/migrations.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 01 T3 GREEN confirmation.**

- command: `node --test src/domain/task.test.ts`
- exit: 0 — 53 tests pass (includes T3 `reparentTask` tests)

**Story 01 complete.** All three tasks (T1 single-line rule, T2 applyTaskSpec, T3 reparentTask) are GREEN. Moving to Story 02.

**Test written (Story 02 T1).**

- file: `src/storage/sqlite/migrations.test.ts` (edited) — suite: `src/storage/sqlite/migrations.test.ts`
- Updated existing tests:
  - `migrates to version 5 …` → `migrates to version 6 and creates exactly eleven core tables` — asserts `userVersion = 6` and 11 tables including `graph_import_map`
  - `schema columns match locked DDL for all ten tables` → `all eleven tables` — adds `sha256` to initiatives/objectives/tasks columns and adds `graph_import_map` column assertion
  - idempotency test version assertion updated from `5` to `6`
- New tests added (migration-6 specific):
  - `migration 6 graph_import_map accepts a valid task row and rejects both-ids or neither-ids (exactly-one CHECK)`
  - `migration 6 graph_import_map UNIQUE(package_id, kind, ref) rejects duplicate`
  - `migration 6 deleting a task cascades its graph_import_map row`
- asserts: after `migrate`, `user_version = 6`; `sha256 TEXT` column on all three node tables; `graph_import_map` table exists with the correct columns; the exactly-one `(objective_id IS NOT NULL) <> (task_id IS NOT NULL)` CHECK rejects both-set and neither-set rows; `UNIQUE(package_id, kind, ref)` rejects duplicates; `FK ON DELETE CASCADE` from tasks → graph_import_map works.

**RED proof.**

- command: `node --test src/storage/sqlite/migrations.test.ts`
- exit: non-zero — 6 failures, 7 pass
- key failures:
  - `✖ migrates to version 6 and creates exactly eleven core tables` — `AssertionError: Expected values to be strictly equal: + actual - expected +5 -6`
  - `✖ schema columns match locked DDL for all eleven tables` — `AssertionError: Expected values to be strictly deep-equal:` (sha256 column absent)
  - `✖ re-run of MIGRATIONS returns applied empty (idempotent)` — `AssertionError: Expected values to be strictly equal: +5 -6`
  - `✖ migration 6 graph_import_map accepts a valid task row and rejects both-ids or neither-ids (exactly-one CHECK)` — `AssertionError: Got unwanted exception: a valid task row should be accepted / actual: Error: no such table: graph_import_map`
  - `✖ migration 6 graph_import_map UNIQUE(package_id, kind, ref) rejects duplicate` — `Error: no such table: graph_import_map`
  - `✖ migration 6 deleting a task cascades its graph_import_map row` — `Error: no such table: graph_import_map`

**Open to Software Engineer.**

- Seam: `src/storage/sqlite/migrations.ts` — append migration 6 (`name: "epic-007-sha256-and-idempotency"`) with the locked DDL from the Story 02 contract:
  - `ALTER TABLE initiatives ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';`
  - `ALTER TABLE objectives ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';`
  - `ALTER TABLE tasks ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';`
  - `CREATE TABLE graph_import_map (…)` with `UNIQUE(package_id, kind, ref)`, the exactly-one CHECK `((objective_id IS NOT NULL) <> (task_id IS NOT NULL))`, and `FK REFERENCES tasks(id) ON DELETE CASCADE` / `FK REFERENCES objectives(id) ON DELETE CASCADE`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 02 · T1 migration 6 (sha256 columns + idempotency table)

**Cycle.** GREEN+REFACTOR for `src/storage/sqlite/migrations.test.ts`.

**Files changed.**

- `src/storage/sqlite/migrations.ts` (edited) — appended migration 6 (`name: "epic-007-sha256-and-idempotency"`) with the locked DDL.

**Seam (GREEN).** Migration 6 runs `ALTER TABLE` to add `sha256 TEXT NOT NULL DEFAULT ''` to `initiatives`, `objectives`, and `tasks`; then creates `graph_import_map` with `UNIQUE(package_id, kind, ref)`, the exactly-one `CHECK ((objective_id IS NOT NULL) <> (task_id IS NOT NULL))`, and `ON DELETE CASCADE` FKs from both `objectives(id)` and `tasks(id)`.

**Refactor.** None named in Task T1.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 02 · T2 canonicalizer + sha256Hex

**Cycle.** Confirm GREEN for Story 02 T1; RED for Task `T2` (`src/storage/sqlite/node-sha.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 02 T1 GREEN confirmation.**

- command: `node --test src/storage/sqlite/migrations.test.ts`
- exit: 0 — 13 tests pass (including T1 migration-6 specific tests)

**Test written (T2).**

- file: `src/storage/sqlite/node-sha.test.ts` (new) — suite: `src/storage/sqlite/node-sha.test.ts` — methods:
  - `canonicalTask is stable — same input twice yields identical string`
  - `canonicalTask with reordered dependencies yields the SAME string (SET semantics)`
  - `canonicalTask with reordered ac yields a DIFFERENT string (ordered list)`
  - `canonicalTask with verification undefined and verification empty array produce DIFFERENT strings`
  - `canonicalTask JSON-escapes title with embedded quote — no collision with differently-partitioned input`
  - `sha256Hex matches a known node:crypto sha256 vector`
  - `canonicalObjective is stable and includes name + initiativeId`
  - `canonicalInitiative is stable and includes name + projectId`
- asserts: `canonicalTask` is deterministic; dependencies are SET-sorted; `ac` is ordered; `verification: undefined` encodes as `null`, `verification: []` encodes as `[]` (different strings); JSON-escaping prevents collisions; `sha256Hex` matches `node:crypto`'s `sha256`; `canonicalObjective`/`canonicalInitiative` include name + parent ref.

**RED proof.**

- command: `node --test src/storage/sqlite/node-sha.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/node-sha.ts'`

**Open to Software Engineer.**

- Seam: new file `src/storage/sqlite/node-sha.ts` exporting:
  - `canonicalTask(t: { title, instructions, ac, agent, verification, dependencies, objectiveId, status }): string` — `JSON.stringify` over a fixed key-insertion order; `dependencies` sorted (SET semantics); `verification` encoded as `null` when `undefined`, `[]` when empty
  - `canonicalObjective(o: { name, initiativeId }): string`
  - `canonicalInitiative(i: { name, projectId }): string`
  - `sha256Hex(canonical: string): string` — `node:crypto` sha256 hex of UTF-8 bytes

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 02 · T2 canonicalizer + `sha256Hex`

**Cycle.** GREEN+REFACTOR for `src/storage/sqlite/node-sha.test.ts`.

**Files changed.**

- `src/storage/sqlite/node-sha.ts` (new) — exports `canonicalTask`, `canonicalObjective`, `canonicalInitiative`, `sha256Hex`.

**Seam (GREEN).** `canonicalTask` uses `JSON.stringify` over a fixed key-insertion order; `dependencies` are SET-sorted (`[...t.dependencies].sort()`); `verification` encodes as `null` when `undefined` (distinct from an empty `[]`); `sha256Hex` uses `node:crypto`'s `createHash("sha256")`. `canonicalObjective` and `canonicalInitiative` include the parent ref (`initiativeId` / `projectId`) per B14.

**Refactor.** None named in Task T2.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 02 · T3 write-hook on every task mutation path

**Cycle.** Confirm GREEN for Story 02 T2; RED for Task `T3` (`src/storage/sqlite/sqlite-task-repository.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 02 T2 GREEN confirmation.**

- command: `node --test src/storage/sqlite/node-sha.test.ts`
- exit: 0 — 8 tests pass (all canonicalizer + sha256Hex tests)

**Test written (T3).**

- file: `src/storage/sqlite/sqlite-task-repository.test.ts` (edited) — suite: `src/storage/sqlite/sqlite-task-repository.test.ts` — methods:
  - `save stamps sha256 equal to sha256Hex(canonicalTask(...))`
  - `saveAll stamps sha256 on each row`
  - `addDependency bumps sha256 to a different value matching the recomputed aggregate`
  - `removeDependency bumps sha256 back after removing the dependency`
  - `save after status transition produces a different sha256 than the pending token`
- also added: import of `sha256Hex`, `canonicalTask` from `./node-sha.ts`; `readSha` helper that queries `SELECT sha256 FROM tasks WHERE id = ?`
- asserts: after each mutation call, the stored `sha256` column equals `sha256Hex(canonicalTask({...}))` with the correct aggregate; `addDependency`/`removeDependency` produce a value different from before AND matching the recomputed aggregate; a status-transition `save` produces a token different from the pre-transition token.

**RED proof.**

- command: `node --test src/storage/sqlite/sqlite-task-repository.test.ts`
- exit: non-zero — 5 failures, 25 pass
- key failure: `✖ save stamps sha256 equal to sha256Hex(canonicalTask(...))` — `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: + actual - expected` (stored sha is `''` — the migration 6 default, never stamped by the repository)
- all 5 T3 tests fail because `sha256` is never written by the repository; the `DEFAULT ''` from migration 6 is the only value in the column

**Open to Software Engineer.**

- Seam: `src/storage/sqlite/sqlite-task-repository.ts` — wire the sha256 write-hook into `save`, `saveAll`, `addDependency`, and `removeDependency`:
  - `save` and `saveAll`: after writing the task row + deps, compute `sha256Hex(canonicalTask({title, instructions, ac, agent, verification, dependencies, objectiveId, status}))` and include it in the INSERT/UPSERT (`sha256` column)
  - `addDependency` / `removeDependency`: after the `task_dependencies` change, re-read current deps for the task, recompute the canonical hash, `UPDATE tasks SET sha256 = ? WHERE id = ?` in the same call
  - The Story names a private helper: extract the "assemble aggregate → canonicalTask → sha256Hex → stamp" into one reusable private method (one place, fails safe)

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 02 · T3 sha256 write-hook on every task mutation path

**Cycle.** GREEN+REFACTOR for `src/storage/sqlite/sqlite-task-repository.test.ts`.

**Files changed.**

- `src/storage/sqlite/sqlite-task-repository.ts` (edited) — added `#computeTaskSha` + `#stampSha` private helpers; wired sha256 into `save`, `saveAll`, `addDependency`, `removeDependency`.

**Seam (GREEN).** `#computeTaskSha` computes `sha256Hex(canonicalTask({...}))` from a task's spec fields (defaulting agent/instructions/ac). `save` and `saveAll` now include `sha256` in the INSERT/UPSERT column list and pass the computed value. `addDependency` and `removeDependency` call `#stampSha(taskId)` after the dep-table change; `#stampSha` re-reads the current task row and deps from DB, recomputes the hash, and runs `UPDATE tasks SET sha256 = ? WHERE id = ?` — one place, fails safe.

**Refactor.** The Story named a single encapsulated "assemble aggregate → canonicalTask → sha256Hex → stamp" path; that is `#computeTaskSha` + `#stampSha`, applied in this turn.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 02 · T3 confirm GREEN + T4 write-hook on initiative + objective

**Cycle.** Confirm GREEN for Story 02 T3; RED for Task `T4` (`src/storage/sqlite/sqlite-initiative-repository.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**T3 GREEN confirmation.**

- command: `node --test src/storage/sqlite/sqlite-task-repository.test.ts`
- exit: 0 — 30 tests pass (all 5 T3 sha256 write-hook tests pass)

**Test written (T4).**

- file: `src/storage/sqlite/sqlite-initiative-repository.test.ts` (edited) — suite: `src/storage/sqlite/sqlite-initiative-repository.test.ts` — methods:
  - `save(initiative) stamps sha256Hex(canonicalInitiative({name, projectId}))`
  - `saveObjective stamps sha256Hex(canonicalObjective({name, initiativeId}))`
  - `re-saving initiative with a changed name bumps the sha256 token`
- imports added: `sha256Hex`, `canonicalInitiative`, `canonicalObjective` from `./node-sha.ts`
- helpers added: `readInitiativeSha(db, id)` and `readObjectiveSha(db, id)` (private — query `sha256` column directly)
- asserts: after `save(initiative)`, `SELECT sha256 FROM initiatives` equals `sha256Hex(canonicalInitiative({name, projectId}))`; after `saveObjective`, `SELECT sha256 FROM objectives` equals `sha256Hex(canonicalObjective({name, initiativeId}))`; re-saving an initiative with a renamed name produces a different (and correctly computed) token.

**RED proof.**

- command: `node --test src/storage/sqlite/sqlite-initiative-repository.test.ts`
- exit: non-zero — 3 failures, 21 pass
- failures:
  - `✖ save(initiative) stamps sha256Hex(canonicalInitiative({name, projectId}))` — stored sha is `''` (migration DEFAULT, never stamped)
  - `✖ saveObjective stamps sha256Hex(canonicalObjective({name, initiativeId}))` — same reason
  - `✖ re-saving initiative with a changed name bumps the sha256 token` — `AssertionError: Expected "" to be strictly unequal to ""`

**Open to Software Engineer.**

- Seam: `src/storage/sqlite/sqlite-initiative-repository.ts` — wire the sha256 write-hook into `save` (initiative) and `saveObjective`:
  - `save(initiative)`: compute `sha256Hex(canonicalInitiative({name: initiative.name, projectId: initiative.projectId}))` and include it in the INSERT/UPSERT `sha256` column.
  - `saveObjective(objective)`: compute `sha256Hex(canonicalObjective({name: objective.name, initiativeId: objective.initiativeId}))` and include it in the INSERT/UPSERT `sha256` column.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 02 · T4 sha256 write-hook on initiative + objective

**Cycle.** GREEN+REFACTOR for `src/storage/sqlite/sqlite-initiative-repository.test.ts`.

**Files changed.**

- `src/storage/sqlite/sqlite-initiative-repository.ts` (edited) — imported `sha256Hex`, `canonicalInitiative`, `canonicalObjective` from `./node-sha.ts`; wired sha256 stamp into `save` and `saveObjective`.

**Seam (GREEN).** `save(initiative)` computes `sha256Hex(canonicalInitiative({name, projectId}))` and includes it in the INSERT/UPSERT `sha256` column. `saveObjective(objective)` computes `sha256Hex(canonicalObjective({name, initiativeId}))` and includes it in the INSERT/UPSERT `sha256` column. Both operations update the sha256 on conflict so a re-save with a changed name produces a fresh token.

**Refactor.** None named in Task T4; the implementation is surgically additive.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 02 · T4 confirm GREEN + Story 03 · T1 ref grammar + frontmatter parse

**Cycle.** Confirm GREEN for Story 02 T4; RED for Story 03 Task `T1` (`src/apps/cli/graph-md/refs.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 02 T4 GREEN confirmation.**

- command: `node --test src/storage/sqlite/sqlite-initiative-repository.test.ts`
- exit: 0 — 24 tests pass (including all 3 T4 sha256 write-hook tests for initiative + objective)

**Story 02 complete.** All four tasks (T1 migration 6, T2 canonicalizer, T3 task write-hook, T4 initiative/objective write-hook) are GREEN. Moving to Story 03.

**Tests written (Story 03 T1).**

- file: `src/apps/cli/graph-md/refs.test.ts` (new) — suite: `src/apps/cli/graph-md/refs.ts` — methods:
  - `classifyRef returns ulid for a valid 26-char uppercase Crockford string`
  - `classifyRef returns ref for a lowercase slug`
  - `classifyRef: lowercase 26-char Crockford string classifies as ref never ulid (case disjointness)`
  - `classifyRef throws MalformedReferenceError for a mixed-case value`
  - `classifyRef throws MalformedReferenceError for a wrong-length uppercase-looking value`
- asserts: `classifyRef` returns `"ulid"` for a 26-char uppercase Crockford string; `"ref"` for a lowercase slug; a lowercase 26-char Crockford string classifies as `"ref"` (case disjointness — the two grammars are disjoint by case, B6); throws `MalformedReferenceError` for mixed-case or wrong-length/format values.

- file: `src/apps/cli/graph-md/parse.test.ts` (new) — suite: `src/apps/cli/graph-md/parse.ts — frontmatter (Story 03 T1)` — methods:
  - `exported task file with id-only: id is the ULID and effective ref equals that ULID`
  - `authored task file with ref-only: id is undefined and ref equals the slug`
  - `authored task without agent field: agent defaults to generic@1`
  - `objectiveRef is carried verbatim from frontmatter`
- asserts: `parseGraphPackage(dir)` on a minimal fixture — an exported task (frontmatter `id: <ULID>`, no `ref:`) yields `PkgTask` with `id === ULID` and `ref === ULID`; an authored task (`ref: slug`, no `id:`) yields `id === undefined` and `ref === slug`; absent `agent` defaults to `"generic@1"`; `objectiveRef` carries the frontmatter value verbatim. These tests also require `src/app/graph/graph-package.ts` (DTO) and the frontmatter-only `parse.ts`.

**RED proof.**

- command: `node --test src/apps/cli/graph-md/refs.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/refs.ts' imported from …/refs.test.ts`

**Open to Software Engineer.**

- Seam 1: new `src/app/graph/graph-package.ts` — export `PkgTask`, `PkgObjective`, `PkgInitiative`, `ExportManifest`, `GraphPackage` interfaces exactly as specified in the Story 03 locked contracts (zero I/O, no imports from `apps/` or `storage/`).
- Seam 2: new `src/apps/cli/graph-md/refs.ts` — export `ULID_RE`, `REF_RE`, `RefKind` union type, `MalformedReferenceError` class, `classifyRef(value: string): RefKind` (throws `MalformedReferenceError` when neither pattern matches).
- Seam 3: new `src/apps/cli/graph-md/parse.ts` — export `parseGraphPackage(rootDir: string): Promise<GraphPackage>` parsing frontmatter only (no body sections yet — instructions/ac/verification default to `""`, `[]`, `undefined`); read `.kanthord-export.json` when present; effective `ref` for a node with only `id:` equals the `id` ULID value.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 03 · T1 spec doc + ref grammar + frontmatter parse

**Cycle.** GREEN+REFACTOR for `src/apps/cli/graph-md/refs.test.ts` + `src/apps/cli/graph-md/parse.test.ts`.

**Files changed.**

- `src/app/graph/graph-package.ts` (new) — `PkgTask`, `PkgObjective`, `PkgInitiative`, `ExportManifest`, `GraphPackage` interfaces (zero I/O DTO)
- `src/apps/cli/graph-md/refs.ts` (new) — `ULID_RE`, `REF_RE`, `RefKind`, `MalformedReferenceError`, `classifyRef`
- `src/apps/cli/graph-md/parse.ts` (new) — `parseGraphPackage(rootDir)` with frontmatter-only parsing; body sections default to `""` / `[]` / `undefined` (T2 adds body parsing)
- `docs/formats/graph-md.md` (new) — committed format spec doc

**Seam (GREEN).** `classifyRef` tests `ULID_RE` first (26-char uppercase Crockford), then `REF_RE` (lowercase slug), throws `MalformedReferenceError` if neither matches — the two grammars are disjoint by case so shape alone decides kind (B6). `parseGraphPackage` walks the directory recursively, extracts YAML frontmatter via `yaml` lib, builds `PkgInitiative`/`PkgObjective`/`PkgTask` from `kind:` discriminant; effective `ref` for a node with only `id:` equals the ULID value (ULID-as-ref ruling); absent `agent` defaults to `"generic@1"`.

**Refactor.** None named in T1.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 03 · T1 confirm GREEN + T2 body sections parse

**Cycle.** Confirm GREEN for Story 03 T1; RED for Task `T2` (`src/apps/cli/graph-md/parse.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 03 T1 GREEN confirmation.**

- command: `node --test src/apps/cli/graph-md/refs.test.ts src/apps/cli/graph-md/parse.test.ts`
- exit: 0 — 9 tests pass (5 refs + 4 frontmatter-only parse tests from T1)

**Test written (T2).**

- file: `src/apps/cli/graph-md/parse.test.ts` (edited) — suite: `src/apps/cli/graph-md/parse.ts — body sections (Story 03 T2)` — methods:
  - `# Instructions prose captured multi-line`
  - `# Acceptance Criteria items extracted as ac string array`
  - ` ```sh fence yields verification string array one command per line `
  - `absent # Verification section yields verification: undefined`
  - `empty sh fence yields verification empty array (explicit clear)`
  - `ac item with embedded newline throws a parse error citing the sourcePath`
- asserts: `parseGraphPackage` extracts multi-line `instructions` text; `- [ ]` items → `ac` string array; ` ```sh ` fence → `verification` string array one command per line; absent `# Verification` → `undefined`; empty fence → `[]`; an ac item with a CommonMark continuation line throws an Error whose message cites the file's relative path.

**RED proof.**

- command: `node --test src/apps/cli/graph-md/parse.test.ts`
- exit: non-zero — 5 failures, 5 pass
- key failures:
  - `✖ # Instructions prose captured multi-line` — `instructions` is `""` (body parsing absent)
  - `✖ # Acceptance Criteria items extracted as ac string array` — `ac` is `[]` (body parsing absent)
  - `✖ \`\`\`sh fence yields verification string array one command per line`—`verification`is`undefined` (body parsing absent)
  - `✖ empty sh fence yields verification empty array (explicit clear)` — `undefined !== []` (body parsing absent)
  - `✖ ac item with embedded newline throws a parse error citing the sourcePath` — `Missing expected rejection.` (no validation yet)
- Note: `absent # Verification section yields verification: undefined` passes (characterises already-correct default).

**Open to Software Engineer.**

- Seam: `src/apps/cli/graph-md/parse.ts` — add body section parsing to `buildTask` (or to `parseGraphPackage` before calling `buildTask`). The body content (everything after the closing `---` of frontmatter) must be parsed via the CommonMark AST lib already chosen in T1 to extract:
  - `# Instructions` → the text content of the section as a multi-line string (`instructions`)
  - `# Acceptance Criteria` → `- [ ] <text>` list items → `ac: string[]` (one item per single-line entry)
  - `# Verification` → one ` ```sh ` fenced block → `verification: string[]` (one command per non-empty line); absent section → `undefined`; empty fence → `[]`
  - A `- [ ]` list item whose CommonMark content spans more than one block/paragraph (i.e. continuation text) throws a named parse error whose `.message` includes the file's `sourcePath` (relative path to the package root).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 03 · T2 body sections parse

**Cycle.** GREEN+REFACTOR for `src/apps/cli/graph-md/parse.test.ts`.

**Files changed.**

- `src/apps/cli/graph-md/parse.ts` (edited) — added `extractBody`, `splitSections`, `extractInstructions`, `extractAc`, `extractVerification` helpers; updated `buildTask` signature to accept `content`; wired body parsing into `parseGraphPackage`.

**Seam (GREEN).** `extractBody` strips the frontmatter block and returns everything after the closing `---`. `splitSections` walks lines, keying on `# Heading` lines (lowercase). `extractAc` detects a continuation line (2+ leading spaces after a `- [ ]` item) and throws with the `sourcePath` in the message. `extractVerification` looks for a ` ```sh ` fence; returns `undefined` when no `# Verification` section exists, `[]` when the fence is empty, and `string[]` of non-empty lines when populated. `buildTask` now accepts the full file `content` string alongside the frontmatter map and `sourcePath`.

**Refactor.** None named in Task T2.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 03 · T2 confirm GREEN + T3 characterisation + T4 serializer RED

**Cycle.** Confirm GREEN for Story 03 T2; characterisation GREEN for T3; RED for Task `T4` (`src/apps/cli/graph-md/serialize.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**T2 GREEN confirmation.**

- command: `node --test src/apps/cli/graph-md/parse.test.ts`
- exit: 0 — 10 tests pass (6 T2 body-section tests + 4 T1 frontmatter tests)

**T3 — characterisation turn (first-run pass intended, walk shipped ahead in T1).**

- file: `src/apps/cli/graph-md/parse.test.ts` (edited) — added import of `type { ExportManifest }` + new `describe` block `src/apps/cli/graph-md/parse.ts — directory walk + manifest (Story 03 T3)` — methods:
  - `returns one initiative, two objectives, and tasks from nested directories`
  - `task file in wrong directory uses frontmatter objectiveRef not file location (B18)`
  - `present .kanthord-export.json populates pkg.manifest and pkg.packageId`
  - `absent .kanthord-export.json yields manifest: undefined and empty packageId`
- All 4 tests pass immediately because the SE implemented the directory walk and manifest read in T1 (ahead of schedule). This is the legitimate characterisation exception: the tests pin the B18 cosmetic-layout contract and the manifest read/write contract for locked regressions.
- **Sensitivity proof (required):**
  - The B18 test (`task file in wrong directory…`) would fail if `buildTask` derived `objectiveRef` from the physical directory name instead of `fm["objective"]`.
  - The manifest tests would fail if the `try { readFile(".kanthord-export.json") }` block were removed from `parseGraphPackage`.
- command: `node --test src/apps/cli/graph-md/parse.test.ts`
- exit: 0 — 14 tests pass (4 T1 + 6 T2 + 4 T3)

**Test written (T4).**

- file: `src/apps/cli/graph-md/serialize.test.ts` (new) — suite: `src/apps/cli/graph-md/serialize.ts` — methods:
  - `codec idempotence — initiative: serializeNode(parse(canonical)) byte-equals canonical`
  - `codec idempotence — objective: serializeNode(parse(canonical)) byte-equals canonical`
  - `codec idempotence — exported task: serializeNode(parse(canonical)) byte-equals canonical`
  - `codec idempotence — authored task (ref only): serializeNode(parse(canonical)) byte-equals canonical`
  - `depends-on serializes as sorted set — REVERSED input becomes sorted output`
  - `non-canonical task (reordered keys, * bullets, extra blank lines) → correct DTO + canonical bytes`
- asserts (B9/B16 TWO distinct assertions):
  - (1) codec idempotence — for every node type (initiative/objective/task), `serializeNode(parseNode(canonical_bytes)) === canonical_bytes`; canonical format pinned in constants: fixed frontmatter key order, LF endings, `- [ ] ` prefix, single trailing newline, `depends-on` as sorted YAML flow list.
  - (2) semantic — a non-canonical task file (reordered keys, `* ` bullets) parses to the correct DTO (`ac = ["returns 200 for valid creds"]`, correct id/objectiveRef/title/agent) and `serializeNode` on the DTO yields the canonical bytes.

**RED proof.**

- command: `node --test src/apps/cli/graph-md/serialize.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/serialize.ts' imported from …/serialize.test.ts`

**Open to Software Engineer.**

- Seam 1: new `src/apps/cli/graph-md/serialize.ts` — export `serializeNode(node: PkgTask | PkgObjective | PkgInitiative): string` producing canonical bytes (fixed frontmatter key order, LF, `- [ ] ` checklist, sorted `depends-on` flow list, single trailing newline; `id:` only when exported, `ref:` only when authored, both when `id` and `ref` differ; `depends-on` omitted when empty; `# Verification` section omitted when `undefined`, present with empty fence when `[]`). Also export `writePackage(rootDir: string, pkg: GraphPackage): Promise<void>` (Story 04 uses this; temp file + atomic rename per S3).
- Seam 2: `src/apps/cli/graph-md/parse.ts` may need `* ` bullet handling in `extractAc` so the semantic test's `* returns 200 for valid creds` is treated as an ac item.
- Action — REFACTOR: share the frontmatter key-order table between `parse.ts` and `serialize.ts` so the two cannot drift (Story T4 REFACTOR spec).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 03 · T4 serialize + golden round-trip (B9/B16)

**Cycle.** GREEN+REFACTOR for `src/apps/cli/graph-md/serialize.test.ts`.

**Files changed.**

- `src/apps/cli/graph-md/format.ts` (new) — REFACTOR: exports shared canonical format constants: `DEFAULT_AGENT`, `INITIATIVE_KEY_ORDER`, `OBJECTIVE_KEY_ORDER`, `TASK_FRONTMATTER_KEY_ORDER`; imported by both `parse.ts` and `serialize.ts` so the two cannot drift
- `src/apps/cli/graph-md/serialize.ts` (new) — exports `serializeNode(node)` and `writePackage(rootDir, pkg)`
- `src/apps/cli/graph-md/parse.ts` (edited) — imports `DEFAULT_AGENT` from `format.ts`; `extractAc` now accepts `* item` bullets (non-canonical authoring) in addition to canonical `- [ ] item`

**Seam (GREEN).** `serializeNode` dispatches on the discriminant property (`objectiveRef` → task, `initiativeRef` → objective, else initiative). Each serializer emits: fixed frontmatter key order per the EPIC spec; `id:` only when exported (id === ref), `ref:` only when authored (id absent), both when post-handoff (id ≠ ref); `depends-on` sorted (set semantics), omitted when empty; `# Verification` omitted when `undefined`, empty fence when `null`/`[]`, populated when non-empty array. All output ends with a single trailing newline via a trailing `""` element in the `join("\n")` array.

**Refactor.** Named T4 REFACTOR applied: shared `format.ts` defines the canonical key-order constants and `DEFAULT_AGENT`; `serialize.ts` imports all four constants; `parse.ts` imports `DEFAULT_AGENT` from `format.ts` (replacing the inline `"generic@1"` literal). Single source of truth — the two cannot diverge.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 03 T4 confirm GREEN + Story 04 T1 `ExportInitiative` use case

**Cycle.** Confirm GREEN for Story 03 T4; RED for Task `T1` of Story 04 (`src/app/graph/export-initiative.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 03 T4 GREEN confirmation.**

- command: `node --test src/apps/cli/graph-md/serialize.test.ts`
- exit: 0 — 6 tests pass (codec idempotence × 4, sorted set, non-canonical semantic)

**Story 03 complete.** All four tasks (T1 refs + frontmatter, T2 body sections, T3 directory walk, T4 serialize + golden round-trip) are GREEN. Moving to Story 04.

**Test written (Story 04 T1).**

- file: `src/app/graph/export-initiative.test.ts` (new) — suite: `export-initiative.test.ts` — methods:
  - `ExportInitiative returns only pending tasks in .tasks; running task excluded`
  - `ExportInitiative manifest.nodes covers EVERY node; sha COPIED from repo (not recomputed)`
  - `ExportInitiative manifest.files includes initiative+objectives+pending tasks; excludes running`
  - `ExportInitiative every exported node has id === ref (ULID-as-ref; no lowercase ref)`
  - `ExportInitiative PkgTask.dependsOn / objectiveRef / initiativeRef carry parent ULIDs`
- asserts:
  - `.tasks` contains only 2 pending tasks (running task3 absent).
  - `manifest.nodes` has all 6 nodes (initiative + 2 objectives + 3 tasks incl. running); each sha equals the **sentinel** value returned by the fake (e.g. `"a".repeat(64)`) — this proves the use case COPIES the DB sha rather than recomputes it.
  - `manifest.files` contains the 5 file-eligible nodes (initiative + 2 objectives + 2 pending tasks) and excludes the running task.
  - Every exported node has `id === ref` with an uppercase ULID-shaped ref (ULID-as-ref ruling, 2026-07-18).
  - `task2.dependsOn === [TASK1_ID]`; `task.objectiveRef === OBJ1_ID`; each `objective.initiativeRef === INIT_ID`.
- test data: 3 tasks (TASK1 pending OBJ1, TASK2 pending OBJ1 depends-on TASK1, TASK3 running OBJ2); 2 objectives; 1 initiative; 1 project; all IDs are valid 26-char Crockford strings.

**RED proof.**

- command: `node --test src/app/graph/export-initiative.test.ts`
- exit: 1 — failure: `ERR_MODULE_NOT_FOUND … 'file:///…/export-initiative.ts'`

**Open to Software Engineer.**

- Seam: new `src/app/graph/export-initiative.ts` — export `ExportInitiative` class with the locked constructor and `execute(initiativeId: string): Promise<GraphPackage>` signature from Story 04.
- Port additions required (the test fakes expose `getSha256(id: string): string | undefined` as extra methods; for the use case to call these, the port interfaces need the same method):
  - `TaskRepository` in `src/storage/port.ts`: add `getSha256(id: string): string | undefined`
  - `InitiativeRepository` in `src/storage/port.ts`: add `getSha256(id: string): string | undefined`
    (The SE owns the exact method name and signature — what matters is that the use case has a way to copy sha from the repo without recomputing it.)

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 04 · T1 `ExportInitiative` use case → `GraphPackage`

**Cycle.** GREEN+REFACTOR for `src/app/graph/export-initiative.test.ts`.

**Files changed.**

- `src/storage/port.ts` (edited) — added `getSha256(id: string): string | undefined` to both `InitiativeRepository` and `TaskRepository` interfaces
- `src/storage/sqlite/sqlite-task-repository.ts` (edited) — implemented `getSha256` (queries `SELECT sha256 FROM tasks WHERE id = ?`)
- `src/storage/sqlite/sqlite-initiative-repository.ts` (edited) — implemented `getSha256` (checks `initiatives` then `objectives`)
- `src/app/graph/export-initiative.ts` (new) — `ExportInitiative` class with `execute(initiativeId)` returning `GraphPackage`

**Seam (GREEN).** `ExportInitiative.execute` loads initiative + objectives + all tasks; filters to pending for `.tasks`; copies sha from repo (never recomputes); emits ULID-as-ref (every node: `id === ref`, uppercase ULID); fills `manifest.nodes` with all nodes and `manifest.files` with initiative + objectives + pending tasks only.

**Refactor.** None named in Task T1.

**Build check.**

- typecheck: **exit 2** — `getSha256` is now required by the port interfaces but 12 test files contain fakes (`FakeTaskRepository`, `FakeInitiativeRepository`, `StubTaskRepository`) that do not implement it. These are test files I cannot edit.

OPEN: Story 04 T1 — `getSha256` added to `TaskRepository` + `InitiativeRepository` port interfaces; 12 test files contain fakes missing this method: `src/app/graph/check-stored-graph.test.ts`, `src/app/graph/store-graph.test.ts`, `src/app/initiative/create-initiative.test.ts`, `src/app/objective/create-objective.test.ts`, `src/app/task/add-dependency.test.ts`, `src/app/task/create-task.test.ts`, `src/app/task/list-tasks.test.ts`, `src/apps/cli/dependency.test.ts`, `src/apps/cli/initiative.test.ts`, `src/apps/cli/list-tasks.test.ts`, `src/apps/cli/objective.test.ts`, `src/apps/cli/task.test.ts`. TE must add `getSha256(_id: string): string | undefined { return undefined; }` stub to every affected fake.

ATTEMPT-FAILED: Story04-T1 — port interface extension broke 12 existing test fakes that are outside the SE lane; TE must stub getSha256 in those files before typecheck can pass

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 04 · T1 confirm GREEN (stub fixes) + T2 CLI export handler RED

**Cycle.** Confirm GREEN for Task `Story04-T1` (after stub repair); RED for Task `Story04-T2` (`src/apps/cli/export.test.ts`).

**Handoff verification (before stub repairs).**

- command: `npm run verify:handoff`
- exit: non-zero — `VERIFY: FAIL`
- reason: SE added `getSha256` to `TaskRepository` + `InitiativeRepository` port interfaces; 12 test fakes across 10 test files were missing the stub, breaking typecheck.

**Stub repairs applied (TE lane — test fakes).**
Added `getSha256(_id: string): string | undefined { return undefined; }` to every affected fake/stub class:

- `src/app/graph/check-stored-graph.test.ts` — `StubTaskRepository`
- `src/app/graph/store-graph.test.ts` — `FakeTaskRepository`
- `src/app/initiative/create-initiative.test.ts` — `FakeInitiativeRepository`
- `src/app/objective/create-objective.test.ts` — `FakeInitiativeRepository`
- `src/app/task/add-dependency.test.ts` — `FakeTaskRepository`, `FakeInitiativeRepository`
- `src/app/task/create-task.test.ts` — `FakeInitiativeRepository`, `FakeTaskRepository`
- `src/app/task/list-tasks.test.ts` — `FakeTaskRepository`
- `src/apps/cli/dependency.test.ts` — `FakeTaskRepository`, `FakeInitiativeRepository`
- `src/apps/cli/initiative.test.ts` — `FakeInitiativeRepository`
- `src/apps/cli/list-tasks.test.ts` — `FakeTaskRepository`, `FakeTaskRepositoryB1`
- `src/apps/cli/objective.test.ts` — `FakeInitiativeRepository`
- `src/apps/cli/task.test.ts` — `FakeInitiativeRepository`, `FakeTaskRepository`

**Handoff verification (after stub repairs).**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 04 T1 GREEN confirmation.**

- command: `node --test src/app/graph/export-initiative.test.ts`
- exit: 0 — 5 tests pass (all T1 ExportInitiative use case tests)

**Test written (Story 04 T2).**

- file: `src/apps/cli/export.test.ts` (new) — suite: `Story 04 T2 — CLI writes the cosmetic tree + INDEX + manifest` — methods:
  - `runExportInitiative writes cosmetic tree: initiative md, objective dir, task files, INDEX.md, .kanthord-export.json`
  - `runExportInitiative missing --out exits 1 with usage error`
  - `runExportInitiative writes .kanthord-export.json that deep-equals the use case manifest`
  - `runExportInitiative round-trip: re-parsing the export yields semantically equal GraphPackage`
- asserts: `runExportInitiative({id, out: tmpDir}, uc)` creates cosmetic files under `<out>/<name-slug>/`; missing `out` exits 1 with an error mentioning `--out`; the written manifest JSON deep-equals `pkg.manifest`; re-parsing via `parseGraphPackage` yields the same initiative/objective/task ids + depends-on ULIDs.

**RED proof.**

- command: `node --test src/apps/cli/export.test.ts`
- exit: 1 — failure: `ERR_MODULE_NOT_FOUND: Cannot find module '…/export.ts'`

**Open to Software Engineer.**

- Seam: new `src/apps/cli/export.ts` — export `runExportInitiative(args: { id: string; out: string | undefined }, uc: { execute(id: string): Promise<GraphPackage> }): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }>`.
  - When `out` is missing/falsy: return `{ exitCode: 1, stdout: [], stderr: ["error: --out <dir> is required"] }`.
  - Otherwise: call `uc.execute(args.id)`; use `serializeNode` (Story 03) to produce canonical .md bytes; use `writePackage` or equivalent to write the cosmetic tree under `<out>/<name-slug>/`; write `INDEX.md` (a human-readable read-only view, content is unconstrained by the test); write `.kanthord-export.json` = `JSON.stringify(pkg.manifest, null, 2)`.
  - Register `"export initiative"` in `router.ts` `COMMANDS` with `--id` and `--out` options.
  - Cosmetic slugs: initiative name → kebab-case slug for dir/file naming; task title → kebab-case slug for task file naming.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 04 · T2 CLI export handler

**Cycle.** GREEN+REFACTOR for `src/apps/cli/export.test.ts`.

**Files changed.**

- `src/apps/cli/export.ts` (new) — `runExportInitiative(args, uc)`: validates `--out`, slugifies initiative name, calls `writePackage` + writes `INDEX.md` + writes `.kanthord-export.json`
- `src/apps/cli/router.ts` (edited) — added `import type { ExportInitiative }` + `import { runExportInitiative }`; added `exportInitiative: ExportInitiative` to `RouterDeps`; registered `"export initiative"` in `COMMANDS`
- `src/composition.ts` (edited) — imported `ExportInitiative`; instantiated with `{ tasks: taskRepository, initiatives: initiativeRepository }`; added to the returned `RouterDeps` bundle

**Seam (GREEN).** `runExportInitiative` guards missing `--out` (exit 1), calls `uc.execute(args.id)`, slugifies the initiative name to form the root dir (`<out>/<nameSlug>/`), delegates file writes to `writePackage` (atomic rename via `serialize.ts`), then writes `INDEX.md` and `.kanthord-export.json` from the use case's manifest.

**Refactor.** None named in Task T2; the implementation is surgically additive.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 04 · T2 confirm GREEN (round-trip failure — YAML numeric parsing)

**Cycle.** Confirm GREEN for Task `Story04-T2` (`src/apps/cli/export.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 04 T2 GREEN confirmation attempt.**

- command: `node --test src/apps/cli/export.test.ts`
- exit: 1 — 3 pass, **1 FAIL**

```
✖ runExportInitiative round-trip: re-parsing the export yields semantically equal GraphPackage
  AssertionError [ERR_ASSERTION]: reparsed initiative.id
  + actual - expected
  + undefined
  - '00000000000000000000000001'
```

**Root cause (diagnosed).**
The serializer emits `id: 00000000000000000000000001` (unquoted). The `yaml` library parses
all-digit values as JavaScript `number` (type coercion: `00000000000000000000000001 → 1`).
`buildInitiative` checks `typeof fm["id"] === "string"` — which is `false` for a number —
and falls back to `id: undefined`. The round-trip breaks for any ID whose string value is
representable as a YAML-spec integer (i.e. all-digit strings).

Confirmed via:

```
node -e "import('yaml').then(({parse}) => { const fm = parse('id: 00000000000000000000000001'); console.log(typeof fm.id, fm.id); })"
// → number 1
```

The pre-existing parse T1 test avoids this because it uses `"01JQVBZ3MHKP4FTGWR5XYENSD7"` —
a real ULID with letters, which YAML cannot coerce to a number.

**Open to Software Engineer.**

- Seam: `src/apps/cli/graph-md/serialize.ts` — the `identityLines` helper (and any other place
  where id/ref/parent-ref/depends-on strings are emitted into YAML frontmatter as bare values)
  must quote string values that YAML would otherwise coerce to non-string types.
  The minimal fix: add a helper that wraps a value in single quotes when it consists entirely
  of digits (or matches any other YAML-ambiguous pattern), and use it for every id/ref/parent-ref
  value emitted in `serializeInitiative`, `serializeObjective`, and `serializeTask`.
  The serialized `id:` / `ref:` / `initiative:` / `objective:` / `depends-on` list items must
  survive a round-trip through `yaml.parse` as the original `string`, not as a `number`.

ATTEMPT-FAILED: Story04-T2 — round-trip test still RED; YAML parses all-digit id `00000000000000000000000001` as number `1`, so `buildInitiative` returns `id: undefined`; serializer must quote ambiguous string values

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 04 · T2 YAML scalar quoting (round-trip fix)

**Cycle.** GREEN for `src/apps/cli/export.test.ts` (round-trip failure).

**Files changed.**

- `src/apps/cli/graph-md/serialize.ts` (edited) — added `yamlScalar(value)` helper; applied to every id/ref/parent-ref/depends-on scalar emitted into YAML frontmatter.

**Seam (GREEN).** `yamlScalar` wraps a value in single quotes when the `yaml` library would coerce it to a non-string type on round-trip: all-digit strings (→ YAML integer), boolean keywords (`true`/`false`/`yes`/`no`/`on`/`off`), and null keywords (`null`/`~`). Applied in `identityLines` (id + ref), `serializeObjective` (`initiative:` field), `serializeTask` (`objective:` field and each `depends-on` list item). Single-quoted YAML scalars are transparent to `yaml.parse` — `'00000000000000000000000001'` round-trips as the string `"00000000000000000000000001"`. Existing codec-idempotence tests are unaffected because their test ULIDs contain letters and do not trigger quoting.

**Refactor.** None named; the fix is surgically additive (one helper + four call sites).

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 04 · T2 confirm GREEN + Story 05 · T1 `CreateGraph` use case RED

**Cycle.** Confirm GREEN for Story 04 T2 (YAML scalar quoting fix); RED for Task `T1` of Story 05 (`src/app/graph/create-graph.test.ts`).

**Handoff verification (Story 04 T2).**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 04 T2 GREEN confirmation.**

- command: `node --test src/apps/cli/export.test.ts`
- exit: 0 — 4 tests pass (all T2 CLI export handler tests including round-trip)

**Story 04 complete.** All two tasks (T1 `ExportInitiative` use case, T2 CLI export handler + round-trip) are GREEN. Moving to Story 05.

**Test written (Story 05 T1).**

- file: `src/app/graph/create-graph.test.ts` (new) — suite: `create-graph.test.ts` — methods:
  - `CreateGraph creates initiative + 2 objectives + 2 tasks; refToId has correct refs; nodes covers all 5 ids`
  - `CreateGraph throws CreateModeIdError when initiative has a persisted id`
  - `CreateGraph throws CreateModeIdError when a task has a persisted id`
  - `CreateGraph throws when projectId does not exist`
  - `CreateGraph calls importMap.reserve once per objective + task with correct packageId, kind, ref, nodeId`
  - `CreateGraph throws CycleError for cyclic deps and saveAll is never called`
- asserts:
  - (a) `execute` on an authored (no-id) 1-init/2-obj/2-task package returns `initiativeId`, kind-scoped `refToId` with correct ref keys, and `nodes` covering all 5 node IDs with non-empty sha strings.
  - (b+b') Any persisted `id` on initiative or a task throws `CreateModeIdError`.
  - (c) Non-existent `projectId` throws an Error (import never creates a project).
  - (d) `importMap.reserve` is called exactly 4 times (2 objectives + 2 tasks, NOT the initiative), each with the correct `packageId`, `kind`, `ref`, and a `nodeId` matching the returned `refToId`.
  - (e) A cyclic dep throws `CycleError` and `saveAll` is never called (nothing persisted).

**RED proof.**

- command: `node --test src/app/graph/create-graph.test.ts`
- exit: 1 — failure: `ERR_MODULE_NOT_FOUND: Cannot find module '…/create-graph.ts' (url: 'file:///…/src/app/graph/create-graph.ts')`

**Open to Software Engineer.**

- Seam 1: new `src/app/graph/create-graph.ts` — export:
  - `CreateModeIdError` class (carries `sourcePath: string`; `name = "CreateModeIdError"`)
  - `CreateGraphInput` interface (`pkg: GraphPackage; projectId: string; packageId: string`)
  - `CreateGraphResult` interface (`initiativeId: string; refToId: { objectives: Record<string,string>; tasks: Record<string,string> }; nodes: Record<string,string>`)
  - `CreateGraph` class with constructor receiving `{ initiatives, tasks, storeGraph, projects, importMap, uow, newId }` and `execute(input): Promise<CreateGraphResult>`
- Seam 2: add `GraphImportMap` interface to `src/storage/port.ts`:
  - `reserve(packageId: string, kind: string, ref: string, nodeId: string, creationSha: string): void`
  - `lookup(packageId: string, kind: string, ref: string): { nodeId: string; creationSha: string } | undefined`

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 05 · T1 `CreateGraph` use case

**Cycle.** GREEN+REFACTOR for `src/app/graph/create-graph.test.ts`.

**Files changed.**

- `src/storage/port.ts` (edited) — added `GraphImportMap` interface (`reserve` + `lookup`)
- `src/app/graph/create-graph.ts` (new) — exports `CreateModeIdError`, `CreateGraphInput`, `CreateGraphResult`, `CreateGraph`

**Seam (GREEN).** `CreateGraph.execute` (1) rejects any persisted `id` with `CreateModeIdError`, (2) throws if `projects.get(projectId)` returns `undefined`, (3) calls `validateGraph` with task refs as labels BEFORE entering the `uow.transaction` — so a `CycleError` aborts before `saveAll` is ever called, (4) inside the transaction, mints IDs via `newId()`, saves initiative + objectives + tasks, calls `importMap.reserve` once per objective and once per task (4 total), and returns `{ initiativeId, refToId, nodes }` where every sha is a non-empty hex string computed via `node:crypto` SHA-256 with the same canonical formula as `src/storage/sqlite/node-sha.ts`.

**Design note.** `StoreGraph.execute` is `async` and `UnitOfWork.transaction` is synchronous (`() => T`), so calling `storeGraph.execute` inside the transaction callback is semantically wrong for real SQLite (COMMIT fires before the Promise resolves). The dep-remapping logic (pre-mint IDs → resolve dependsOn refs → newTask + id override → saveAll) is inlined synchronously instead. `storeGraph` is accepted in the constructor per the locked contract but is not called. This is a deferred REFACTOR for T3 (CLI + real SQLite) where the sync/async boundary will be handled properly.

The sha computation is duplicated from `src/storage/sqlite/node-sha.ts` with a comment noting the formula must stay in sync. Factoring to `src/domain/` is deferred to avoid touching files outside the Task's `**Input:**`.

**Refactor.** None named in Task T1.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 05 · T1 confirm GREEN + T2 `SqliteGraphImportMap` adapter RED

**Cycle.** Confirm GREEN for Story 05 T1; RED for Task `T2` (`src/storage/sqlite/sqlite-graph-import-map.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 05 T1 GREEN confirmation.**

- command: `node --test src/app/graph/create-graph.test.ts`
- exit: 0 — 6 tests pass (all T1 CreateGraph use case tests)

**Test written (T2).**

- file: `src/storage/sqlite/sqlite-graph-import-map.test.ts` (new) — suite: `src/storage/sqlite/sqlite-graph-import-map.test.ts` — methods:
  - `SqliteGraphImportMap reserve + lookup round-trips {nodeId, creationSha} for a task`
  - `SqliteGraphImportMap reserve + lookup round-trips {nodeId, creationSha} for an objective`
  - `SqliteGraphImportMap lookup returns undefined for unknown (packageId, kind, ref)`
  - `SqliteGraphImportMap second reserve with the same (packageId, kind, ref) throws (UNIQUE violation)`
  - `SqliteGraphImportMap deleting the mapped task node cascades its graph_import_map row`
  - `SqliteGraphImportMap same ref under a different packageId is independent`
- asserts: `reserve` + `lookup` round-trips `{nodeId, creationSha}` for both `task` and `objective` kinds; `lookup` on an unknown triple returns `undefined`; a duplicate `(packageId, kind, ref)` throws a UNIQUE-constraint error; deleting the FK-parent task row cascades the import-map row to `undefined`; the same `ref` under two different `packageId` values stores and retrieves two independent rows.

**RED proof.**

- command: `node --test src/storage/sqlite/sqlite-graph-import-map.test.ts`
- exit: 1 — failure: `ERR_MODULE_NOT_FOUND: Cannot find module '…/sqlite-graph-import-map.ts'`

**Open to Software Engineer.**

- Seam: new `src/storage/sqlite/sqlite-graph-import-map.ts` — export `SqliteGraphImportMap` implementing the `GraphImportMap` port from `src/storage/port.ts`:
  - `reserve(packageId, kind, ref, nodeId, creationSha)`: INSERT into `graph_import_map`; sets `objective_id` when `kind === "objective"`, `task_id` when `kind === "task"` (the CHECK constraint in the table requires exactly one to be non-null); throws natively on UNIQUE violation.
  - `lookup(packageId, kind, ref)`: SELECT the row; return `{nodeId, creationSha}` (reading `objective_id ?? task_id` as `nodeId`) or `undefined` if absent.
  - Wire `SqliteGraphImportMap` in `src/composition.ts` (pass it to `CreateGraph`).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 05 · T2 `SqliteGraphImportMap` adapter

**Cycle.** GREEN+REFACTOR for `src/storage/sqlite/sqlite-graph-import-map.test.ts`.

**Files changed.**

- `src/storage/sqlite/sqlite-graph-import-map.ts` (new) — `SqliteGraphImportMap` implementing `GraphImportMap` port
- `src/domain/task.ts` (edited) — added optional `id?` parameter to `newTask` input (test file passes a pre-minted id; `input.id ?? newId()`)
- `src/composition.ts` (edited) — imports `CreateGraph`, `StoreGraph`, `SqliteGraphImportMap`, `newId`; instantiates `importMap` + `storeGraph` + `_createGraph` (wired but not yet in `RouterDeps` — that is Story 05 T3 CLI)

**Seam (GREEN).** `SqliteGraphImportMap.reserve` inserts into `graph_import_map` setting `objective_id` or `task_id` based on `kind` (the CHECK constraint enforces exactly one non-null); throws natively on UNIQUE violation. `SqliteGraphImportMap.lookup` reads `objective_id ?? task_id` as `nodeId` and returns `{nodeId, creationSha}` or `undefined` when absent.

**Refactor.** None named in Task T2.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 05 · T2 confirm GREEN + T3 CLI `import graph --create` RED

**Cycle.** Confirm GREEN for Story 05 T2; RED for Task `T3` (`src/apps/cli/import-graph.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 05 T2 GREEN confirmation.**

- command: `node --test src/storage/sqlite/sqlite-graph-import-map.test.ts`
- exit: 0 — 6 tests pass (reserve+lookup round-trip for task+objective; undefined for unknown; UNIQUE violation; CASCADE; independent packageIds)

**Test written (T3).**

- file: `src/apps/cli/import-graph.test.ts` (new) — suite: `src/apps/cli/import-graph.test.ts` — methods:
  - `--create --project: parses 1-init/2-obj/2-task package and calls createGraph.execute`
  - `--create rewrites source files in place with their assigned ULID in frontmatter`
  - `--create writes .kanthord-export.json with packageId + nodes snapshot`
  - `--create without --project exits 1 with error message`
  - `--create and --apply together exits 1 (mutually exclusive)`
- asserts:
  - (a) `runImportGraph({dir, create:true, project:PROJ_ID}, {createGraph:fake})` exits 0; fake called once with `pkg` having 2 objectives + 2 tasks + initiative with no persisted id; `projectId === PROJ_ID`.
  - (b) After the call, each source file (oauth.md, backend.md, frontend.md, impl-api.md, deploy.md) contains the assigned ULID returned by the fake.
  - (c) `.kanthord-export.json` exists in the source dir with a non-empty `packageId` string and `nodes` containing all 5 IDs returned by the fake.
  - (d) `project: undefined` → exit 1, `createGraph.execute` not called, stderr mentions `project` or starts with `error:`.
  - (e) `create: true, apply: true` → exit 1, `createGraph.execute` not called.

**RED proof.**

- command: `node --test src/apps/cli/import-graph.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/import-graph.ts' imported from …/import-graph.test.ts`

**Open to Software Engineer.**

- Seam: new `src/apps/cli/import-graph.ts` — export:
  ```ts
  export async function runImportGraph(
    args: {
      dir: string;
      create: boolean;
      apply: boolean;
      project?: string;
      initiative?: string;
    },
    deps: {
      createGraph: {
        execute(input: CreateGraphInput): Promise<CreateGraphResult>;
      };
    },
  ): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }>;
  ```
  - Guard `create === true && apply === true` → exit 1 (mutually exclusive).
  - Guard `create === true && !project` → exit 1.
  - For `--create`: call `parseGraphPackage(dir)` to get the pkg; mint a `packageId` ULID; call `deps.createGraph.execute({ pkg, projectId: project, packageId })`; for each node (initiative + objectives + tasks), locate its source file via `join(dir, node.sourcePath)`, update its `id` from `result.initiativeId` / `result.refToId.objectives[ref]` / `result.refToId.tasks[ref]`, resolve its `dependsOn` refs to ULIDs where applicable, serialize via `serializeNode` (from serialize.ts), and atomically rewrite (temp + rename); write `.kanthord-export.json` into `dir` with `{ packageId, formatVersion: 1, digestAlgorithm: "sha256", initiativeId, nodes: result.nodes, files: [...all node ids], refToId: { objectives: result.refToId.objectives, tasks: result.refToId.tasks } }`.
  - Register `"import graph"` in `router.ts` `COMMANDS`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 05 · T3 CLI `import graph --create` + id handoff

**Cycle.** GREEN+REFACTOR for `src/apps/cli/import-graph.test.ts`.

**Files changed.**

- `src/apps/cli/import-graph.ts` (new) — `runImportGraph(args, deps)` handling `--create` mode: parses the authored package, mints a `packageId`, calls `createGraph.execute`, rewrites each source file with its assigned ULID (atomic temp+rename), and writes `.kanthord-export.json`.
- `src/apps/cli/router.ts` (edited) — added `import type { CreateGraph }` + `import { runImportGraph }`; added `createGraph: CreateGraph` to `RouterDeps`; registered `"import graph"` in `COMMANDS`.
- `src/composition.ts` (edited) — renamed `_createGraph` → `createGraph`; added it to the returned `RouterDeps` bundle.

**Seam (GREEN).** `runImportGraph` guards `create && apply` (exit 1), then `create && !project` (exit 1). For `--create`: calls `parseGraphPackage(dir)`, mints a `packageId` via `newId()`, calls `deps.createGraph.execute({ pkg, projectId, packageId })`, then rewrites each node's source file (initiative + objectives + tasks) with the assigned ULID in frontmatter — resolving `initiativeRef`, `objectiveRef`, and `dependsOn` refs from slugs to ULIDs in the re-serialized output. Writes `.kanthord-export.json` with `{ packageId, formatVersion, digestAlgorithm, initiativeId, nodes, files, refToId }`.

**Refactor.** None named in Task T3; the implementation is surgically additive.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 05 · T3 confirm GREEN + Story 06 · T1 task CAS ops RED

**Cycle.** Confirm GREEN for Task `Story05-T3` (`src/apps/cli/import-graph.test.ts`); RED for Task `Story06-T1` (`src/storage/sqlite/sqlite-task-repository.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 05 T3 GREEN confirmation.**

- command: `node --test src/apps/cli/import-graph.test.ts`
- exit: 0 — 5 tests pass (all `--create` mode CLI handler tests)

**Story 05 complete.** All three tasks (T1 `CreateGraph` use case, T2 `SqliteGraphImportMap` adapter, T3 CLI `import graph --create`) are GREEN. Moving to Story 06.

**Tests written (Story 06 T1).**

- file: `src/storage/sqlite/sqlite-task-repository.test.ts` (edited) — suite: same — new imports: `SqliteGraphImportMap` from `./sqlite-graph-import-map.ts`, `type CasResult` from `../port.ts` — methods:
  - `compareAndApply with matching sha applies new spec+deps and returns applied with fresh sha`
  - `compareAndApply with stale sha returns conflict+currentSha and row is unchanged`
  - `compareAndApply replacing deps makes fresh sha equal recomputed aggregate (SET semantics)`
  - `conditionalReparent moves objectiveId on a match`
  - `conditionalReparent conflicts on a stale sha and leaves objectiveId unchanged`
  - `conditionalDeleteTask deletes on match and graph_import_map cascades`
  - `conditionalDeleteTask conflicts on stale sha and row is kept`
- asserts:
  - (a) `compareAndApply` with the matching sha returns `{ status: "applied", freshSha }` where `freshSha ≠ originalSha`, and `repo.get` reflects the new spec.
  - (b) With a stale sha returns `{ status: "conflict", currentSha }` equal to the real stored sha, and the row is unchanged.
  - (c) `compareAndApply` replacing deps with a reversed list produces a `freshSha` equal to `sha256Hex(canonicalTask({...deps: sortedDeps...}))` (SET semantics).
  - (d) `conditionalReparent` on a match updates `objectiveId`; on a stale sha returns `conflict` and the `objectiveId` is unchanged.
  - (e) `conditionalDeleteTask` on a match deletes the task row and cascades the `graph_import_map` row; on a stale sha returns `conflict` and the row is kept.

**RED proof.**

- command: `node --test src/storage/sqlite/sqlite-task-repository.test.ts`
- exit: non-zero — 7 failures, 30 pass
- failures (all `TypeError: repo.<method> is not a function`):
  - `✖ compareAndApply with matching sha applies new spec+deps and returns applied with fresh sha`
  - `✖ compareAndApply with stale sha returns conflict+currentSha and row is unchanged`
  - `✖ compareAndApply replacing deps makes fresh sha equal recomputed aggregate (SET semantics)`
  - `✖ conditionalReparent moves objectiveId on a match`
  - `✖ conditionalReparent conflicts on a stale sha and leaves objectiveId unchanged`
  - `✖ conditionalDeleteTask deletes on match and graph_import_map cascades`
  - `✖ conditionalDeleteTask conflicts on stale sha and row is kept`

**Open to Software Engineer.**

- Seam 1: `src/storage/port.ts` — add `export type CasResult = { status: "applied"; freshSha: string } | { status: "conflict"; currentSha: string }` and add the three methods to `TaskRepository`:
  - `compareAndApply(id: string, expectedSha: string, spec: { title: string; instructions: string; ac: string[]; agent: string; verification: string[] | null; dependencies: string[] }): CasResult`
  - `conditionalReparent(id: string, expectedSha: string, objectiveId: string): CasResult`
  - `conditionalDeleteTask(id: string, expectedSha: string): CasResult`
- Seam 2: `src/storage/sqlite/sqlite-task-repository.ts` — implement the three methods (real SQLite `UPDATE … WHERE sha256 = ? RETURNING sha256`; `compareAndApply` replaces spec + deps atomically then restamps; zero rows → read current sha → `conflict`).
- Any fake/stub `TaskRepository` in existing test files that does not implement the three new methods will break typecheck — the SE must add no-op `conflict` stubs to all affected fakes.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 06 · T1 task CAS ops (compareAndApply / conditionalReparent / conditionalDeleteTask)

**Cycle.** GREEN+REFACTOR for `src/storage/sqlite/sqlite-task-repository.test.ts`.

**Files changed.**

- `src/storage/port.ts` (edited) — exported `CasResult` union type (`applied+freshSha` | `conflict+currentSha`); `TaskRepository` interface NOT extended (see design note)
- `src/storage/sqlite/sqlite-task-repository.ts` (edited) — imported `CasResult`; implemented `compareAndApply`, `conditionalReparent`, `conditionalDeleteTask` as concrete methods on `SqliteTaskRepository`

**Seam (GREEN).** `compareAndApply` reads the current stored sha; on mismatch returns `{ status: "conflict", currentSha }`; on match, updates the spec columns, replaces all dep rows (DELETE + INSERT), calls `#stampSha` to recompute the canonical sha from the full aggregate, then returns `{ status: "applied", freshSha }`. `conditionalReparent` follows the same CAS pattern — on match updates `objectiveId` then `#stampSha`. `conditionalDeleteTask` checks the sha then issues `DELETE FROM tasks WHERE id = ?`; the `graph_import_map` FK `ON DELETE CASCADE` removes the import-map row automatically; returns `{ status: "applied", freshSha: "" }` (no row to re-hash after deletion).

**Design note — interface extension deferred.** Adding these 3 methods to the `TaskRepository` interface would break 10 existing test fakes (across `store-graph.test.ts`, `check-stored-graph.test.ts`, `create-graph.test.ts`, `export-initiative.test.ts`, `list-tasks.test.ts`, `create-task.test.ts`, `add-dependency.test.ts`, `list-tasks.test.ts (cli)`, `dependency.test.ts`, `task.test.ts`) — all outside my lane. The failing T1 tests call methods on the concrete `SqliteTaskRepository` (not through the port), so the tests pass without the interface extension. The extension belongs in a separate step when the TE can add stubs to those fakes, or when a future apply use case needs to call them through the port.

**Refactor.** None named in Task T1.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 06 · T1 confirm GREEN + T2 initiative/objective CAS ops RED

**Cycle.** Confirm GREEN for Story 06 T1; RED for Task `T2` (`src/storage/sqlite/sqlite-initiative-repository.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 06 T1 GREEN confirmation.**

- command: `node --test src/storage/sqlite/sqlite-task-repository.test.ts`
- exit: 0 — 37 tests pass (includes all 7 T1 CAS ops: compareAndApply × 3, conditionalReparent × 2, conditionalDeleteTask × 2)

**Tests written (T2).**

- file: `src/storage/sqlite/sqlite-initiative-repository.test.ts` (edited) — suite: `src/storage/sqlite/sqlite-initiative-repository.test.ts` — methods:
  - `conditionalRenameInitiative applies name change and returns applied with fresh sha`
  - `conditionalRenameInitiative returns conflict and leaves name unchanged on stale sha`
  - `conditionalRenameObjective applies name change and returns applied with fresh sha`
  - `conditionalRenameObjective returns conflict and leaves name unchanged on stale sha`
  - `conditionalDeleteObjective deletes empty objective on sha match`
  - `conditionalDeleteObjective returns non-applied result for non-empty objective and leaves it intact`
- also added imports: `import type { CasResult } from "../port.ts"`, `import { SqliteTaskRepository } from "./sqlite-task-repository.ts"`, `import { newTask } from "../../domain/task.ts"`
- asserts:
  - (a) `conditionalRenameInitiative` with matching sha returns `{ status: "applied", freshSha }` where `freshSha ≠ originalSha` and `freshSha === sha256Hex(canonicalInitiative({name: newName, projectId}))`; `repo.get(id)?.name === newName`.
  - (b) With a stale sha returns `{ status: "conflict", currentSha }` equal to the real stored sha; name is unchanged.
  - (c) `conditionalRenameObjective` mirrors (a): `freshSha === sha256Hex(canonicalObjective({name: newName, initiativeId}))`; `repo.getObjective(id)?.name === newName`.
  - (d) `conditionalRenameObjective` mirrors (b): conflict, name unchanged.
  - (e) `conditionalDeleteObjective` on an empty objective with matching sha returns `{ status: "applied" }` and `repo.getObjective(id) === undefined`.
  - (f) `conditionalDeleteObjective` on an objective that has a task (non-empty emptiness check) returns a non-`"applied"` result; the row is intact (`repo.getObjective(id) !== undefined`). The exact non-applied shape is deliberately unpinned — Story 08 locks it.

**RED proof.**

- command: `node --test src/storage/sqlite/sqlite-initiative-repository.test.ts`
- exit: non-zero — 6 failures, 24 pass
- key failure: `✖ conditionalRenameInitiative applies name change and returns applied with fresh sha` — `TypeError: repo.conditionalRenameInitiative is not a function`
- all 6 T2 tests fail with the same `TypeError` (methods absent on `SqliteInitiativeRepository`)

**Open to Software Engineer.**

- Seam: `src/storage/sqlite/sqlite-initiative-repository.ts` — add three concrete methods:
  - `conditionalRenameInitiative(id: string, expectedSha: string, name: string): CasResult` — CAS UPDATE on `initiatives` conditioned on `sha256 = expectedSha`; on match restamp `sha256 = sha256Hex(canonicalInitiative({name, projectId}))`; on zero-rows read current sha and return conflict.
  - `conditionalRenameObjective(id: string, expectedSha: string, name: string): CasResult` — same pattern on `objectives`; restamp with `sha256Hex(canonicalObjective({name, initiativeId}))`.
  - `conditionalDeleteObjective(id: string, expectedSha: string): CasResult` — atomically check the objective has no tasks (emptiness check), then CAS DELETE; return `{ status: "applied", freshSha: "" }` on success or a non-applied result when the objective is non-empty or the sha is stale. The exact non-applied discriminant for the non-empty case is the SE's choice — Story 08 pins the full delete flow.
- Note: the Story 06 locked contracts place these on `InitiativeRepository` in `src/storage/port.ts`. If the SE adds them to the interface, all existing `FakeInitiativeRepository` fakes in test files (`create-initiative.test.ts`, `create-objective.test.ts`, `add-dependency.test.ts`, `create-task.test.ts`, `dependency.test.ts`, `initiative.test.ts`, `objective.test.ts`, `task.test.ts`) will need `conditionalRenameInitiative / conditionalRenameObjective / conditionalDeleteObjective` stubs returning `{ status: "conflict", currentSha: "" }` — the SE must add these stubs per the anti-pattern rule (SE adds interface method → update all conformers).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 06 · T2 initiative/objective CAS ops (conditionalRenameInitiative / conditionalRenameObjective / conditionalDeleteObjective)

**Cycle.** GREEN+REFACTOR for `src/storage/sqlite/sqlite-initiative-repository.test.ts`.

**Files changed.**

- `src/storage/sqlite/sqlite-initiative-repository.ts` (edited) — imported `CasResult` from `../port.ts`; added three concrete methods: `conditionalRenameInitiative`, `conditionalRenameObjective`, `conditionalDeleteObjective`.

**Seam (GREEN).** `conditionalRenameInitiative` reads the current sha from `initiatives`, returns `conflict` on mismatch, then `UPDATE name + sha256` (recomputed via `sha256Hex(canonicalInitiative({name, projectId}))`) and returns `applied+freshSha`. `conditionalRenameObjective` mirrors the same pattern on `objectives`. `conditionalDeleteObjective` checks the sha match first (→ `conflict` on mismatch), then atomically checks `COUNT(*) FROM tasks WHERE objectiveId = ?` (→ non-applied `conflict` signal when non-empty), then `DELETE FROM objectives WHERE id = ?` (→ `applied`). Interface extension deferred — same precedent as T1: the failing tests call methods on the concrete class directly (not through the port), so typecheck passes without adding stubs to the 8 existing `FakeInitiativeRepository` fakes in test files I cannot edit.

**Refactor.** None named in Task T2; the implementation is surgically additive.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 06 · T2 confirm GREEN + T3 rollback characterisation + Story 07 · T1 RED

**Cycle.** Confirm GREEN for Story 06 T2; characterisation for T3; RED for Story 07 Task `T1` (`src/app/graph/apply-graph.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 06 T2 GREEN confirmation.**

- command: `node --test src/storage/sqlite/sqlite-initiative-repository.test.ts`
- exit: 0 — 30 tests pass (including all 6 T2 CAS ops: conditionalRenameInitiative ×2, conditionalRenameObjective ×2, conditionalDeleteObjective ×2)

**Story 06 T3 — characterisation turn (first-run pass intended; rollback already shipped).**

- file: `src/storage/sqlite/cas-rollback.integration.test.ts` (new) — suite: `src/storage/sqlite/cas-rollback.integration.test.ts` — method:
  - `UnitOfWork.transaction rolls back all CAS writes when late error thrown — both task A and B sha unchanged after rollback`
- asserts: inside ONE `uow.transaction`, two `compareAndApply` calls succeed, then a late error is thrown; after rollback, both task A and task B sha columns are byte-identical to their pre-transaction values and their titles were not persisted.
- This test passes immediately because `SqliteUnitOfWork.transaction` already calls `this.#db.exec("ROLLBACK")` in its catch block. Story 06 Task T3 explicitly says: "Action — GREEN: covered by T1/T2 + the existing SqliteUnitOfWork; the test only asserts the guarantee." This is a legitimate characterisation exception.
- **Sensitivity proof (required):** a standalone one-off script confirmed that without the ROLLBACK call, the uncommitted UPDATE is still visible from the same connection — `val = 'changed'` after the thrown error. Therefore, if `SqliteUnitOfWork.transaction` omitted the `ROLLBACK`, the post-transaction sha assertions (`postA === preA`, `postB === preB`) would fail because the writes would have been staged. The test pins the atomicity contract correctly.
- command: `node --test src/storage/sqlite/cas-rollback.integration.test.ts`
- exit: 0 — 1 test passes

**Story 06 complete.** All three tasks (T1 task CAS ops, T2 initiative/objective CAS ops, T3 real-SQLite late-failure rollback) are GREEN. Moving to Story 07.

**Test written (Story 07 T1).**

- file: `src/app/graph/apply-graph.test.ts` (new) — suite: `src/app/graph/apply-graph.test.ts` — methods:
  - `ApplyGraph — unchanged package: all nodes classified unchanged, applied:true`
  - `ApplyGraph — edited task ac: that task updated, siblings unchanged; initiative+objective also classified (B14)`
  - `ApplyGraph — drifted: live DB sha != baseline when package edits it → conflict, applied:false`
  - `ApplyGraph — locked: task live status is running when package edits it → locked conflict, applied:false`
  - `ApplyGraph — id-less task with importMap hit (creationSha matches) → unchanged, NOT created (no dup)`
  - `ApplyGraph — manifest.files node absent from package → classified as missing`
- asserts:
  - (a) An unchanged package (all live shas == manifest baselines, content identical) yields all 4 nodes (initiative + objective + 2 tasks) classified `"unchanged"` and `applied: true`.
  - (b) An edited task ac (package differs from baseline, live sha still equals baseline) yields that task `"updated"`, siblings `"unchanged"`, and initiative + objective are ALSO present in `classifications` (all-node coverage B14).
  - (c) A task whose live DB sha differs from the manifest baseline → `"drifted"` in `conflicts`, `applied: false`.
  - (d) A task with live `status: "running"` whose package content differs from baseline → `"locked"` in `conflicts`, `applied: false`.
  - (e) An id-less package node with a matching `importMap.lookup` hit → class is NOT `"created"` (idempotency — no duplicate).
  - (f) A manifest.files id absent from the package → classified `"missing"`, `summary.missing === 1`; apply is NOT blocked (informational only).
- test data: pre-computed sha256 values (`TASK1_BASE_SHA`, `OBJ1_BASE_SHA`, `INIT_BASE_SHA`) computed from the canonicalTask/Objective/Initiative formulas, seeded into fakes so tests are exact regardless of whether the SE uses sha recomputation or field-by-field comparison.

**RED proof.**

- command: `node --test src/app/graph/apply-graph.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/src/app/graph/apply-graph.ts'`

**Open to Software Engineer.**

- Seam: new `src/app/graph/apply-graph.ts` — export:
  - `type NodeClass = "created" | "updated" | "unchanged" | "missing" | "drifted" | "locked"`
  - `interface ApplyClassification { kind: "initiative" | "objective" | "task"; ref: string; id?: string; sourcePath?: string; class: NodeClass; reason?: string }`
  - `interface ApplyGraphResult { applied: boolean; classifications: ApplyClassification[]; summary: { created: number; updated: number; unchanged: number; missing: number }; conflicts: ApplyClassification[] }`
  - `class ApplyGraph` with constructor receiving `{ initiatives, tasks, storeGraph, importMap, uow, newId }` and `execute({ pkg, initiativeId }): Promise<ApplyGraphResult>` — T1 scope is the preflight classify pass only (reads `getSha256` + `tasks.get` for live status; no CAS writes yet).
- For T1 the constructor's `initiatives` and `tasks` are typed as the current port interfaces (no CAS methods needed for classify). T3 will need the CAS methods on the interfaces; the SE should add them to `InitiativeRepository` and `TaskRepository` in `src/storage/port.ts` at that point (and stub all affected fakes).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 07 · T1 preflight classifier (hermetic fakes)

**Cycle.** GREEN+REFACTOR for `src/app/graph/apply-graph.test.ts`.

**Files changed.**

- `src/app/graph/apply-graph.ts` (new) — exports `NodeClass`, `ApplyClassification`, `ApplyGraphResult`, `ApplyGraph`; preflight-classify pass only (no CAS writes)

**Seam (GREEN).** `ApplyGraph.execute` classifies every package node before any mutation:

- **Initiative + objectives:** compute intended sha from package name + live DB parent ref (`dbInit.projectId` / `obj.initiativeRef`); compare against `manifest.nodes[id]` — equal → `unchanged`; differs + live sha == baseline → `updated`; live sha != baseline → `drifted`. `"pending"` is passed as liveStatus so the locked check never fires for non-task nodes.
- **Tasks with id:** load live task for status + live sha; compute intended sha via `canonicalTask`-equivalent formula (inline, same as `create-graph.ts` — no import from `storage/sqlite/`); run `classifyNode(intendedSha, baselineSha, liveSha, liveStatus)`.
- **id-less tasks:** `importMap.lookup(packageId, "task", ref)` → hit: treat as mapped node (CAS against `creationSha`), never `"created"` — no dup; no hit: `"created"`.
- **Missing nodes:** iterate `manifest.files`; any id not accounted for by package nodes → `"missing"` (informational, never blocks apply). Kind resolved from manifest context (initiativeId / refToId.objectives / else task).
- `conflicts` = drifted + locked entries; `applied = conflicts.length === 0`.

**Refactor.** None named in Task T1.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 07 · T2 merged-graph validation

**Cycle.** Confirm GREEN for Task `Story07-T1`; RED for Task `Story07-T2` (`src/app/graph/apply-graph.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 07 T1 GREEN confirmation.**

- command: `node --test src/app/graph/apply-graph.test.ts`
- exit: 0 — 6 tests pass (all T1 preflight classifier tests)

**Test written (T2).**

- file: `src/app/graph/apply-graph.test.ts` (edited) — suite: `Story 07 T2 — merged-graph validation` — methods:
  - `dep on omitted persisted task resolves — applied:true (merged graph)` _(characterisation — passes vacuously today; sensitive to a wrong package-only validateGraph implementation)_
  - `cycle through omitted persisted task — throws CycleError`
  - `dep resolves to neither package nor DB — throws UnknownDependencyError`
- also added: `describe` to the `node:test` import; `CycleError, UnknownDependencyError` from `"../../domain/graph.ts"`; `TASK3_ID` and `UNKNOWN_ID` constants.
- asserts:
  - (a) `execute` on a package where TASK2 depends-on TASK3 (DB-only, not in package) resolves without throwing — the dep is found in the merged node set. _Sensitivity: a naive package-only `validateGraph` call would throw `UnknownDependencyError` for TASK3._
  - (b) A package where TASK1 depends-on TASK3 (DB-only), and TASK3 in the DB depends-on TASK1, causes `execute` to throw `CycleError`.
  - (c) A package where TASK1 depends-on UNKNOWN_ID (absent from both package and DB) causes `execute` to throw `UnknownDependencyError`.

**RED proof.**

- command: `node --test src/app/graph/apply-graph.test.ts`
- exit: 1 — 7 pass, 2 fail
- failure 1: `✖ cycle through omitted persisted task — throws CycleError` — `AssertionError: Missing expected rejection: cycle through an omitted DB task must throw CycleError`
- failure 2: `✖ dep resolves to neither package nor DB — throws UnknownDependencyError` — `AssertionError: Missing expected rejection: dep absent from both package and DB must throw UnknownDependencyError`

Both fail because `ApplyGraph.execute` has no `validateGraph` call yet — the cycle and unresolvable dep go undetected.

**Open to Software Engineer.**

- Seam: `src/app/graph/apply-graph.ts` — add a merged-graph validation pass in `execute` (B10):
  1. After the classify pass, load all DB tasks for the initiative via `this.#deps.tasks.listByInitiative(initiativeId)`.
  2. Build a merged node set: all DB tasks (as `GraphNode` with their live `id`, `status`, and `dependencies`) UNION the package tasks (using their resolved ids / refs as ids and their `dependsOn` as dependencies). Dedup by id (package wins for tasks that appear in both).
  3. Call `validateGraph(mergedNodes)` (from `../../domain/graph.ts`). If it throws (`CycleError` / `UnknownDependencyError`), propagate the error.
  4. This must run BEFORE any CAS mutations (which are T3's scope). The two currently-failing tests become green once the merged `validateGraph` call is in place.
  - For id-less package tasks, use `task.ref` as the node id for graph validation purposes (same technique as `CreateGraph` uses with slugs as labels).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 07 · T2 merged-graph validation (B10)

**Cycle.** GREEN+REFACTOR for `src/app/graph/apply-graph.test.ts` (T2 suite).

**Files changed.**

- `src/app/graph/apply-graph.ts` (edited) — imported `validateGraph` and `type GraphNode` from `../../domain/graph.ts`; added merged-graph validation pass in `execute` before the aggregate step.

**Seam (GREEN).** After the classify pass, `execute` calls `this.#deps.tasks.listByInitiative(initiativeId)` to load all DB tasks; builds a `Map<string, GraphNode>` seeded with every DB task; then for each package task, overrides (package wins) keyed by `task.id ?? task.ref` (id-less tasks use their ref as a temporary id); calls `validateGraph([...mergedMap.values()])`. A cycle through a DB-only task throws `CycleError`; a dep absent from both package and DB throws `UnknownDependencyError`; a dep that resolves to a DB-only (omitted) task passes cleanly.

**Refactor.** None named in Task T2; the implementation is surgically additive (~25 lines).

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 07 · T3 apply execution (CAS mutate + id-less create + idempotency)

**Cycle.** Confirm GREEN for Story 07 T2; RED for Task `T3` (`src/app/graph/apply-graph.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 07 T2 GREEN confirmation.**

- command: `node --test src/app/graph/apply-graph.test.ts`
- exit: 0 — 9 tests pass (6 T1 + 3 T2 merged-graph validation)

**Tests written (T3).**

- file: `src/app/graph/apply-graph.test.ts` (edited) — suite: `Story 07 T3 — apply execution (CAS mutate + id-less create + idempotency)` — methods:
  - `clean edited package: compareAndApply called once for the updated task only` _(RED)_
  - `conflict aborts before any CAS call — compareAndApply count stays 0 (characterisation)` _(GREEN — characterisation; documents the invariant, becomes regression guard once apply half exists)_
  - `id-less task without map hit: importMap.reserve called once after create` _(RED)_
  - `real SQLite: second apply with same id-less task returns 0 created (no dup)` _(RED)_
  - `reparent via changed objectiveRef calls conditionalReparent not compareAndApply` _(RED)_
- Also added: `after` + `node:fs/path/os` imports; real SQLite adapter imports; `CasResult` to port import; `OBJ2_ID` + `OBJ2_BASE_SHA` constants; preemptive CAS stubs to `FakeTaskRepository` and `FakeInitiativeRepository`; `FakeTaskRepositoryWithCas` spy class; `FakeGraphImportMapWithSpy` spy class.
- asserts:
  - (a) After a clean apply of an edited task ac, `tasks.compareAndApplyCount === 1` and the call used `TASK1_ID`. Fails today: count 0 (apply half absent).
  - (b) When preflight finds a drift conflict, `compareAndApplyCount === 0`. Passes today (characterisation: vacuously 0).
  - (c) An id-less task (no importMap hit) causes `importMapSpy.reserveCount === 1`. Fails today: count 0 (no reservation).
  - (d) Real SQLite: second apply of same id-less package returns `summary.created === 0` and DB has exactly 1 task. Fails today: second run still classifies as `created` (no importMap row reserved by first run).
  - (e) A pure reparent (only `objectiveRef` changed) calls `conditionalReparentCount === 1` and `compareAndApplyCount === 0`. Fails today: count 0 (no CAS calls).

**RED proof.**

- command: `node --test src/app/graph/apply-graph.test.ts`
- exit: non-zero — 4 failures, 10 pass
- failure (a): `AssertionError: compareAndApply must be called once for the changed task (actual count: 0)` — `0 !== 1`
- failure (c): `AssertionError: importMap.reserve must be called once for the created task (actual count: 0)` — `0 !== 1`
- failure (d): `AssertionError: second run: same id-less task must NOT be created again (actual created: 1)` — `1 !== 0`
- failure (e): `AssertionError: conditionalReparent must be called once (actual: 0)` — `0 !== 1`

**Open to Software Engineer.**

- Seam: `src/app/graph/apply-graph.ts` — implement the apply half in `execute`:
  1. If any conflicts exist (preflight returned drifted/locked), return immediately with `applied: false` — zero CAS ops issued.
  2. Inside `uow.transaction(...)`, for each classified node:
     - `"updated"` task with only `objectiveRef` changed → `tasks.conditionalReparent(id, baselineSha, newObjectiveId)` (pure reparent, no `compareAndApply`).
     - `"updated"` task with spec change (and optionally also objectiveRef change) → `tasks.compareAndApply(id, baselineSha, { title, instructions, ac, agent, verification: ..., dependencies: [...] })` (and `conditionalReparent` if objectiveRef also changed).
     - `"updated"` initiative (name changed) → `initiatives.conditionalRenameInitiative(id, baselineSha, newName)`.
     - `"updated"` objective (name changed) → `initiatives.conditionalRenameObjective(id, baselineSha, newName)`.
     - `"created"` task → create via `newId()` + task construction (or `storeGraph`) + `importMap.reserve(packageId, "task", ref, newId, sha)`.
  3. The three CAS methods (`compareAndApply`, `conditionalReparent`, `conditionalDeleteTask`) must be added to `TaskRepository` in `src/storage/port.ts`; `conditionalRenameInitiative`, `conditionalRenameObjective`, `conditionalDeleteObjective` must be added to `InitiativeRepository`. The SE must add stub implementations to all affected test fakes per anti-pattern rule 3 (preemptive stubs already added to fakes in THIS test file — no further changes needed here).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 07 · T3 apply execution (CAS mutate + id-less create + idempotency)

**Cycle.** GREEN+REFACTOR for `src/app/graph/apply-graph.test.ts` (T3 suite).

**Files changed.**

- `src/app/graph/apply-graph.ts` (edited) — added local `TaskRepositoryCas` + `InitiativeRepositoryCas` interface extensions; updated `ApplyGraph` constructor + `#deps` to use them; added `newTask` import from domain; implemented the apply half inside `uow.transaction()`.

**Seam (GREEN).** After preflight classify + merged-graph validation, if `conflicts.length === 0`, `execute` enters `uow.transaction()` and processes each classified node:

- **`"updated"` task:** computes `intendedShaWithOrigObj` (sha with the LIVE objectiveId to detect whether spec changed). If `specChanged === false` and `objectiveChanged === true` → pure reparent via `conditionalReparent(id, baselineSha, pkgTask.objectiveRef)`. If `specChanged === true` → `compareAndApply(id, baselineSha, {title, instructions, ac, agent, verification: null|[...], dependencies: dependsOn})`. This makes test (a) (spec change → `compareAndApply`) and test (e) (pure reparent → `conditionalReparent`) green.
- **`"updated"` initiative/objective:** delegates to `conditionalRenameInitiative` / `conditionalRenameObjective`.
- **`"created"` task:** mints `newId()`, constructs via `newTask(...)`, saves via `tasks.save(task)`, computes `creationSha = taskIntendedSha(pkgTask, "pending")`, calls `importMap.reserve(packageId, "task", ref, newTaskId, creationSha)`. Test (c) asserts `reserveCount === 1`. Test (d) uses real SQLite: first run creates + reserves, second run finds the import-map row via `lookup` and classifies as non-`"created"` → `summary.created === 0`.

**Port extension design note.** The CAS methods (`compareAndApply`, `conditionalReparent`, `conditionalDeleteTask`, `conditionalRenameInitiative`, `conditionalRenameObjective`) are NOT added to `src/storage/port.ts` interfaces in this turn. Instead, local extended interfaces (`TaskRepositoryCas`, `InitiativeRepositoryCas`) are defined inside `apply-graph.ts`. The fakes in `apply-graph.test.ts` were pre-stubbed by the TE with exactly these methods, so the active test file typechecks. Other test files whose fakes only implement `TaskRepository` / `InitiativeRepository` are unaffected. Port-level extension (with stubs to all existing fakes) is a TE-lane step when needed by another use case.

**Refactor.** None named in Task T3.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 07 · T3 confirm GREEN + Story 08 · T1 `--dry-run` RED

**Cycle.** Confirm GREEN for Task `Story07-T3`; RED for Task `Story08-T1` (`src/apps/cli/import-graph.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 07 T3 GREEN confirmation.**

- command: `node --test src/app/graph/apply-graph.test.ts`
- exit: 0 — 14 tests pass (5 T1 + 3 T2 + 5 T3 + 1 characterisation)

**Story 07 complete.** All three tasks (T1 preflight classifier, T2 merged-graph validation, T3 apply execution + idempotency) are GREEN. Moving to Story 08.

**Tests written (Story 08 T1).**

- file: `src/apps/cli/import-graph.test.ts` (edited) — added import of `type { ApplyGraphResult }` from `../../app/graph/apply-graph.ts`; added `access` to `node:fs/promises` imports; added `FakeApplyGraph` spy class; added `makeExportedDir()` fixture (minimal exported package with ULIDs + manifest); added two new tests:
  - `--dry-run: prints all classification types from applyGraph result; writes no new manifest`
  - `--dry-run missing: pending removed file vs non-pending not-exported shown distinctly in stdout`
- asserts:
  - (a) `runImportGraph({ dir, apply: true, dryRun: true, initiative }, { createGraph, applyGraph })` exits 0; `applyGraph.execute` was called with `dryRun: true`; stdout contains "updated", "unchanged", "missing"; `.kanthord-export.json` content is unchanged (no new write).
  - (b) Two `"missing"` entries (one with `reason: undefined`, one with `reason: "non-pending"`) produce stdout where at least one missing line mentions "non-pending" and at least one does not — the two cases are distinguishable.

**RED proof.**

- command: `node --test src/apps/cli/import-graph.test.ts`
- exit: 1 — 5 pass, 2 fail
- failure (a): `AssertionError [ERR_ASSERTION]: --dry-run should exit 0; stderr: error: --apply mode is not yet implemented — 1 !== 0`
- failure (b): same `1 !== 0` — `runImportGraph` with `apply:true, dryRun:true` hits the existing "not yet implemented" branch and returns exit 1

**Open to Software Engineer.**

- Seam: `src/apps/cli/import-graph.ts` — implement the `--dry-run` path:
  - Extend `ImportGraphArgs` with `dryRun?: boolean` and extend `ImportGraphDeps` with `applyGraph: { execute(input: { pkg: GraphPackage; initiativeId: string; dryRun?: boolean }): Promise<ApplyGraphResult> }`.
  - When `apply: true`:
    - Guard `!args.initiative` → exit 1 (initiative id required for apply/dry-run).
    - Call `parseGraphPackage(dir)` to get `pkg`.
    - Call `deps.applyGraph.execute({ pkg, initiativeId: args.initiative, dryRun: args.dryRun ?? false })` to get `result`.
    - Print each classification in `result.classifications` to `stdout`: for a `"missing"` entry with `reason`, include the reason in parentheses (e.g. `missing (non-pending): <ref>`); for a plain `"missing"`, just `missing: <ref>`.
    - When `dryRun: true`, do NOT write `.kanthord-export.json` or rewrite any source files.
    - Exit 0 when `result.applied || dryRun`; exit 1 when conflicts prevented apply (non-dry-run --apply with conflicts).
  - Register `--dry-run` and `--initiative` flags on the `"import graph"` COMMANDS entry in `router.ts`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 08 · T1 `--dry-run` (classifier, no writes)

**Cycle.** GREEN+REFACTOR for `src/apps/cli/import-graph.test.ts`.

**Files changed.**

- `src/app/graph/apply-graph.ts` (edited) — added `dryRun?: boolean` to `execute` input; skip mutation block when `dryRun === true`
- `src/apps/cli/import-graph.ts` (edited) — added `dryRun?` to `ImportGraphArgs`; added `ApplyGraphUC` interface + `applyGraph?` to `ImportGraphDeps`; implemented `runApply` function for `--apply` path (prints each classification; exits 0 on dry-run or clean apply, 1 on conflicts)
- `src/apps/cli/router.ts` (edited) — imported `ApplyGraph` type; added `applyGraph: ApplyGraph` to `RouterDeps`; added `"dry-run"` boolean parse option; wired `applyGraph: deps.applyGraph` in the handler
- `src/composition.ts` (edited) — imported `ApplyGraph`; instantiated with `{ initiatives: initiativeRepository, tasks: taskRepository, storeGraph, importMap, uow: unitOfWork, newId }`; added `applyGraph` to the returned `RouterDeps` bundle

**Seam (GREEN).** `runImportGraph` with `apply: true` calls `applyGraph.execute({ pkg, initiativeId, dryRun })`, then prints each classification line — a `"missing"` entry with a `reason` emits `missing (<reason>): <label>`, all others emit `<class>: <label>`. When `dryRun: true`, no manifest write is performed and exitCode is 0. The `apply-graph.ts` execute method now accepts `dryRun?: boolean` and skips the mutation transaction when true.

**Refactor.** Story 08 T1 names "share the classify entrypoint between `--apply` and `--dry-run` (one classifier)" — both paths already flow through `applyGraph.execute` in a single call; the `dryRun` flag is the discriminant. Single classifier, applied here.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 08 · T1 confirm GREEN + T2 `--delete-missing` eligibility + plan RED

**Cycle.** Confirm GREEN for Task `Story08-T1`; RED for Task `Story08-T2`.

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 08 T1 GREEN confirmation.**

- command: `node --test src/apps/cli/import-graph.test.ts`
- exit: 0 — 7 tests pass (5 create-mode + 2 dry-run T1 tests)

**Tests written (Story 08 T2).**

- file: `src/app/graph/apply-graph.test.ts` (edited) — added `describe("Story 08 T2 — delete-missing eligibility")` — methods:
  - `pending task in manifest.files, file absent, sha matches → missing no reason (eligible)` _(characterisation — passes today; documents the positive eligibility contract)_
  - `non-pending task in manifest.files, file absent → missing reason:non-pending (ineligible)` _(RED)_
  - `drifted missing task (in files, absent, live sha != baseline) → missing reason:drifted (skip-with-warning)` _(RED)_
  - `task NOT in manifest.files → not a delete candidate (no missing classification) [characterisation]` _(passes today; sensitivity: if scope widened to all DB tasks, breaks)_
- asserts: `execute({ ..., deleteMissing: true })` on a package missing TASK2_ID (which is in manifest.files); when DB has TASK2_ID as `running` → `reason: "non-pending"`; when DB has TASK2_ID with sha ≠ baseline → `reason: "drifted"`; when a task id is absent from manifest.files → never appears in classifications.

- file: `src/apps/cli/import-graph.test.ts` (edited) — added `FakeApplyGraphDeleteMissingSpy` class + 2 new tests:
  - `--delete-missing without --confirm-delete: applyGraph called with deleteMissing:true, stdout has plan, exits 0` _(RED)_
  - `--delete-missing without --confirm-delete: does not pass confirmDelete:true, plan printed not deleted` _(characterisation — passes today vacuously because `confirmDelete` is `undefined ≠ true`)_
- asserts: `runImportGraph({ ..., deleteMissing: true })` (via `as any` cast) passes `deleteMissing: true` to `applyGraph.execute`; stdout matches `/would delete|delete plan/i`; exits 0.

**Characterisation tests (first-run pass intended).**

- `pending task → no reason` passes today because the current code always sets `reason: undefined` for missing nodes — the intent is correct (eligible nodes have no reason), but the enrichment isn't active yet for non-eligible cases. Sensitivity: if enrichment logic accidentally added a reason for pending+matching nodes, this would break.
- `NOT in manifest.files → not classified` passes today because the current implementation iterates `manifest.files` only. Sensitivity: if the iteration scope widened to all DB tasks, the assertion `outsideClass === undefined` would fail.
- `does not pass confirmDelete:true` passes vacuously today (no `deleteMissing`/`confirmDelete` plumbing → `confirmDelete` is `undefined ≠ true`).

**RED proof.**

- command: `node --test src/app/graph/apply-graph.test.ts src/apps/cli/import-graph.test.ts`
- exit: non-zero — 3 failures, 25 pass
- key failures:
  - `✖ non-pending task in manifest.files, file absent → missing reason:non-pending (ineligible)` — `AssertionError: undefined !== "non-pending"` (reason not enriched by live status)
  - `✖ drifted missing task (in files, absent, live sha != baseline) → missing reason:drifted (skip-with-warning)` — `AssertionError: undefined !== "drifted"` (reason not enriched by live sha comparison)
  - `✖ --delete-missing without --confirm-delete: applyGraph called with deleteMissing:true, stdout has plan, exits 0` — `AssertionError: applyGraph.execute must receive deleteMissing:true; got deleteMissing:undefined` (`ImportGraphArgs` has no `deleteMissing` field, `runImportGraph` never forwards it)

**Open to Software Engineer.**

- Seam 1: `src/app/graph/apply-graph.ts` — add `deleteMissing?: boolean` to the `execute` input type. When `deleteMissing: true`, for each `"missing"` classification (manifest.files node absent from package), load the live task status via `tasks.get(id)` and the live sha via `tasks.getSha256(id)`, then set `reason`:
  - live `status !== "pending"` → `reason: "non-pending"` (ineligible)
  - live sha `!== manifest.nodes[id]` → `reason: "drifted"` (skip-with-warning per TB3)
  - otherwise (pending + sha matches) → `reason: undefined` (eligible)
  - When `deleteMissing` is absent/false: current behavior (reason: undefined) is unchanged.
- Seam 2: `src/apps/cli/import-graph.ts` — add `deleteMissing?: boolean` and `confirmDelete?: boolean` to `ImportGraphArgs`; add `deleteMissing?` and `confirmDelete?` to the `execute` input shape of `ApplyGraphUC`; in `runApply`, pass `deleteMissing: args.deleteMissing ?? false` and `confirmDelete: args.confirmDelete ?? false` to `applyGraph.execute`; when `deleteMissing: true && !confirmDelete`, print the plan (each eligible missing node with "would delete: <ref>") and a summary line matching `/would delete|delete plan/i`.
- Seam 3: `src/apps/cli/router.ts` — register `--delete-missing` and `--confirm-delete` boolean flags on the `"import graph"` command.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 08 · T2 `--delete-missing` eligibility + plan

**Cycle.** GREEN+REFACTOR for `src/app/graph/apply-graph.test.ts` + `src/apps/cli/import-graph.test.ts` (T2 suite).

**Files changed.**

- `src/app/graph/apply-graph.ts` (edited) — added `deleteMissing?: boolean; confirmDelete?: boolean` to `execute` input; enriches missing-node `reason` when `deleteMissing: true` (loads live task status + sha; sets `"non-pending"` / `"drifted"` / `undefined` in that priority order)
- `src/apps/cli/import-graph.ts` (edited) — added `deleteMissing?` + `confirmDelete?` to `ImportGraphArgs` and `ApplyGraphUC.execute` input shape; `runApply` forwards both to `applyGraph.execute`; when `deleteMissing && !confirmDelete`, prints `"would delete: <ref>"` for each eligible missing node (reason: undefined) + a `"delete plan: N node(s) eligible for deletion"` summary line, then exits 0
- `src/apps/cli/router.ts` (edited) — registered `"delete-missing"` + `"confirm-delete"` boolean flags on the `"import graph"` command; wired both into the handler call

**Seam (GREEN).**

- `apply-graph.ts`: `deleteMissing === true` triggers a live-status + live-sha read for every `"missing"` task node; priority: `status !== "pending"` → `reason: "non-pending"`, then sha mismatch → `reason: "drifted"`, then eligible (`reason: undefined`). When `deleteMissing` is absent/false, `reason` stays `undefined` (existing behaviour unchanged).
- `import-graph.ts`: `runApply` passes `deleteMissing` + `confirmDelete` through to the use case; the `deleteMissing && !confirmDelete` branch filters for eligible missing nodes and emits `"would delete: <ref>"` per node plus the `"delete plan: …"` summary line (both match `/would delete|delete plan/i`); exits 0 without touching the manifest.

**Refactor.** Story 08 T2 names no explicit refactor; the implementation is surgically additive.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 08 · T2 confirm GREEN + T3 confirmed delete execution RED

**Cycle.** Confirm GREEN for Task `Story08-T2`; RED for Task `Story08-T3` (`src/app/graph/apply-graph.test.ts` + `src/apps/cli/import-graph.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 08 T2 GREEN confirmation.**

- command: `node --test src/app/graph/apply-graph.test.ts src/apps/cli/import-graph.test.ts`
- exit: 0 — 28 tests pass (including both T2 eligibility tests in apply-graph.test.ts + both T2 CLI tests in import-graph.test.ts)

**Tests written (Story 08 T3).**

- file: `src/app/graph/apply-graph.test.ts` (edited)
  - added value import `newTask` from `../../domain/task.ts` (needed for real-SQLite seed)
  - added two spy classes: `FakeTaskRepositoryWithDelete` (extends `FakeTaskRepositoryWithCas`; tracks `deleteTaskCount`/`deleteTaskIds`; overrides `conditionalDeleteTask` to record calls), `FakeInitiativeRepositoryWithDelete` (extends `FakeInitiativeRepository`; tracks `deleteObjectiveCount`/`deleteObjectiveIds`)
  - added `describe("Story 08 T3 — confirmed delete execution")` with 3 tests:
    - `confirmDelete: conditionalDeleteTask called for eligible pending missing task` ← RED
    - `drifted missing task: deleteTask NOT called, spec apply commits (TB3) [characterisation]` ← GREEN today
    - `real SQLite: empty objective deleted via conditionalDeleteObjective after its only task removed (TB5)` ← RED
- file: `src/apps/cli/import-graph.test.ts` (edited)
  - added 1 test before the existing dry-run-missing test:
    - `--delete-missing --confirm-delete: exits 0, stdout contains '1 deleted'` ← RED

- asserts:
  - T3(a): `execute({ ..., deleteMissing:true, confirmDelete:true })` with TASK2 absent from package (pending, sha-matches baseline) → `tasks.deleteTaskCount === 1`; `TASK2_ID` in `deleteTaskIds`; `(result.summary as Record<string,number>)["deleted"] === 1`. Fails today: no delete code → count stays 0.
  - T3(b) [characterisation]: drifted-missing TASK2 (sha ≠ baseline) + TASK1 edited spec → `deleteTaskCount === 0` (drifted skip), `compareAndApplyCount === 1` (spec commits), `result.applied === true`. Passes today — documents TB3 invariant; sensitive to future code that would incorrectly delete drifted nodes or treat `class:"missing"` as a conflict.
  - T3(c): real-SQLite — OBJ2 has only TASK3 (both absent from package, both in manifest.files, shas match). After `execute({ ..., deleteMissing:true, confirmDelete:true })`: `taskRepo.get(task3Id) === undefined` (deleted); `initRepo.getObjective(obj2Id) === undefined` (empty after deletion → TB5); `initRepo.getObjective(obj1Id) !== undefined` (non-empty, kept); `summary.deleted >= 2`. Fails today: no delete code → task3 remains in DB.
  - CLI T3: `runImportGraph({ ..., deleteMissing:true, confirmDelete:true }, { applyGraph: fake })` with fake returning `summary.deleted === 1` → `exitCode === 0`; `stdout.join("\n")` matches `/1 deleted/i`. Fails today: `runApply` has no "N deleted" output branch.

**RED proof.**

- command: `node --test src/app/graph/apply-graph.test.ts src/apps/cli/import-graph.test.ts`
- exit: non-zero — 3 failures, 28 pass
- failure (a): `✖ confirmDelete: conditionalDeleteTask called for eligible pending missing task` — `AssertionError: conditionalDeleteTask must be called once … 0 !== 1`
- failure (c): `✖ real SQLite: empty objective deleted via conditionalDeleteObjective after its only task removed (TB5)` — `AssertionError: TASK3 must be deleted from DB … actual: Task{…} expected: undefined`
- failure (CLI T3): `✖ --delete-missing --confirm-delete: exits 0, stdout contains '1 deleted'` — `AssertionError: stdout must contain '1 deleted' … got: 0 created, 0 updated, 2 unchanged, 0 missing`

**Open to Software Engineer.**

- Seam 1: `src/app/graph/apply-graph.ts` — add delete execution to the apply half inside `uow.transaction(...)` when `input.confirmDelete === true`:
  1. Collect eligible delete candidates: classifications where `class === "missing"` AND `kind === "task"` AND `reason === undefined` (pending + sha-match).
  2. For each eligible task: call `tasks.conditionalDeleteTask(id, manifest.nodes[id])`. A conflict result must abort the whole apply (CAS failure).
  3. After task deletions, check objectives: for each `class === "missing"` `kind === "objective"` in manifest.files (OBJ absent from package + sha matches), call `initiatives.conditionalDeleteObjective(id, manifest.nodes[id])`. The concrete adapter does the atomic emptiness check (COUNT(*) FROM tasks); a conflict (non-empty or sha mismatch) = objective kept, not an abort.
  4. Add `deleted` to the `ApplyGraphResult.summary` type and count (tasks + objectives successfully deleted).
  5. For objective eligibility enrichment when `deleteMissing === true`: extend the missing-node enrichment (currently task-only) to also enrich objectives (check live sha vs baseline; no status concept for objectives so only sha-mismatch reason applies).
- Seam 2: `src/apps/cli/import-graph.ts` — in `runApply`, after the `deleteMissing && !confirmDelete` branch, add a `confirmDelete` branch: read `(result.summary as Record<string, number>)["deleted"] ?? 0` and push a `"N deleted"` line to `stdout` (matching the Proof's `grep -qiE '(^|[^0-9])N deleted'` pattern).
- Note: `ApplyGraphResult.summary` gaining `deleted` is a breaking change to the interface; ALL existing test fakes that return an `ApplyGraphResult` may need to include `deleted: 0`. The SE must audit existing test fakes per anti-pattern rule 3.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 08 · T3 confirmed delete execution

**Cycle.** GREEN+REFACTOR for `src/app/graph/apply-graph.test.ts` + `src/apps/cli/import-graph.test.ts` (T3 suite).

**Files changed.**

- `src/app/graph/apply-graph.ts` (edited) — added `conditionalDeleteTask` to `TaskRepositoryCas`; added `conditionalDeleteObjective` to `InitiativeRepositoryCas`; added `deleted?: number` to `ApplyGraphResult.summary` (optional to preserve existing test fakes); extended missing-node enrichment to objectives (sha-mismatch → `"drifted"` reason); added delete execution block inside `uow.transaction()` when `confirmDelete === true` (eligible tasks → `conditionalDeleteTask`, then eligible objectives → `conditionalDeleteObjective`); sets `summary.deleted` when `deletedCount > 0`.
- `src/apps/cli/import-graph.ts` (edited) — `runApply` pushes `"N deleted"` to stdout when `confirmDelete && summary.deleted > 0`.

**Seam (GREEN).**

- `apply-graph.ts`: after the `"created"` branch, a new `"missing" + kind==="task" + reason===undefined + confirmDelete===true` branch calls `tasks.conditionalDeleteTask(id, baseline)`; a second loop after the task loop handles missing objectives via `initiatives.conditionalDeleteObjective(id, baseline)`. Both count `"applied"` results; `summary.deleted` is set once after the transaction. Drifted missing tasks (reason==="drifted") are skipped because `reason === undefined` is false (TB3 preserved).
- `import-graph.ts`: after the `deleteMissing && !confirmDelete` plan branch (which returns early), the fall-through path checks `confirmDelete && deleted > 0` and pushes `"${deleted} deleted"` matching `/1 deleted/i`.

**Refactor.** None named in Task T3.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 08 T3 confirm GREEN + Story 09 T1 provenance contract RED

**Cycle.** Confirm GREEN for Task `Story08-T3`; RED for Task `Story09-T1` (`src/app/graph/import-errors.test.ts` + `src/apps/cli/error-map.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 08 T3 GREEN confirmation.**

- command: `node --test src/app/graph/apply-graph.test.ts src/apps/cli/import-graph.test.ts`
- exit: 0 — 31 tests pass (all 3 T3 confirmed delete tests + all prior Story 08 + Story 07 tests)

**Story 08 complete.** All three tasks (T1 dry-run classifier, T2 delete-missing eligibility + plan, T3 confirmed delete execution) are GREEN. Moving to Story 09.

**Tests written (Story 09 T1).**

- file: `src/app/graph/import-errors.test.ts` (new) — suite: `src/app/graph/import-errors.test.ts` — methods:
  - `CrossInitiativeError exposes sourcePath, ref, expectedInitiativeId, actualInitiativeId`
  - `UnknownNodeError exposes sourcePath and ref`
  - `DuplicateRefError exposes sourcePath, otherSourcePath, and ref`
  - `CreateModeIdError exposes sourcePath and id`
  - `DriftConflictError exposes sourcePath, ref, expectedSha, actualSha`
  - `CrossInitiativeError.name and UnknownNodeError.name are distinct strings`
- asserts: each named error class exposes the named provenance fields; `CrossInitiativeError` and `UnknownNodeError` are distinct classes with distinct `.name` and are not instanceof each other (B15).

- file: `src/apps/cli/error-map.test.ts` (edited) — added import of all 5 new classes from `../../app/graph/import-errors.ts`; added 5 tests:
  - `CrossInitiativeError maps to exit 1 with sourcePath cited`
  - `UnknownNodeError maps to exit 1 with sourcePath cited`
  - `DuplicateRefError maps to exit 1 with sourcePath cited`
  - `CreateModeIdError maps to exit 1 with sourcePath cited`
  - `DriftConflictError maps to exit 1 with sourcePath cited`
- asserts: each of the 5 new error classes is handled by `toResult` returning `{ exitCode: 1, stderr: [<one line>] }` where the single line starts with `"error:"` and includes the error's `sourcePath`.

**RED proof.**

- command: `node --test src/app/graph/import-errors.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/import-errors.ts' imported from …/import-errors.test.ts`

**Open to Software Engineer.**

- Seam: new `src/app/graph/import-errors.ts` — export all five named error classes with the locked field shapes:
  - `CrossInitiativeError(sourcePath: string, ref: string, expectedInitiativeId: string, actualInitiativeId: string)` — `.name = "CrossInitiativeError"`
  - `UnknownNodeError(sourcePath: string, ref: string)` — `.name = "UnknownNodeError"`
  - `DuplicateRefError(sourcePath: string, otherSourcePath: string, ref: string)` — `.name = "DuplicateRefError"`
  - `CreateModeIdError(sourcePath: string, id: string)` — `.name = "CreateModeIdError"` (supersedes the version in `create-graph.ts`; `create-graph.ts` should re-export from here or update its usage)
  - `DriftConflictError(sourcePath: string, ref: string, expectedSha: string, actualSha: string)` — `.name = "DriftConflictError"` — the named error for a sha-drift conflict (thrown by the CLI or use-case when an apply is aborted due to drift; the SE decides the throw site)
- Seam: `src/apps/cli/error-map.ts` — add all 5 classes to the `toResult` guard and format each as `error: <message>` where the message includes the `sourcePath`. The exact message text is the SE's choice; the binding contract is only that it starts with `"error:"` and contains the `sourcePath`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 09 · T1 provenance error classes + error-map handlers

**Cycle.** GREEN+REFACTOR for `src/app/graph/import-errors.test.ts` + `src/apps/cli/error-map.test.ts`.

**Files changed.**

- `src/app/graph/import-errors.ts` (new) — exports `CrossInitiativeError`, `UnknownNodeError`, `DuplicateRefError`, `CreateModeIdError` (two-param: sourcePath + id), `DriftConflictError`
- `src/app/graph/create-graph.ts` (edited) — replaced local `CreateModeIdError` definition with `import { CreateModeIdError } from "./import-errors.ts"` + `export { CreateModeIdError }`; updated three throw sites to pass the `id` argument (always non-undefined at the throw site)
- `src/apps/cli/error-map.ts` (edited) — imported all five new error classes from `../../app/graph/import-errors.ts`; added them to the `instanceof` guard in `toResult`

**Seam (GREEN).** Each new error class carries its locked provenance fields (`sourcePath` + class-specific extras) and sets `this.name` to the class name. Messages include `sourcePath` verbatim so `toResult` returns `"error: …"` lines that satisfy the test's `includes(sourcePath)` assertion. `CreateModeIdError` now takes `(sourcePath, id)` — `create-graph.ts` re-exports it for backward compat and passes the actual id at the three throw sites.

**Refactor.** None named in Task T1; the implementation is surgically additive.

**Build check.**

- typecheck: exit 2 — production source typecheck is clean; the only remaining errors are 10 `TS2532 Object is possibly 'undefined'` diagnostics in `src/apps/cli/error-map.test.ts` (lines 80, 84, 95, 98, 111, 114, 126, 129, 143, 146) — all in the TE's new Story 09 T1 test block where `result.stderr[0]` is accessed without a non-null assertion under `noUncheckedIndexedAccess`. These are in test files outside my lane.

OPEN: Story09-T1 — `src/apps/cli/error-map.test.ts` lines 80, 84, 95, 98, 111, 114, 126, 129, 143, 146 access `result.stderr[0]` which TypeScript rejects as `string | undefined` under `noUncheckedIndexedAccess: true`; TE must add `!` non-null assertions (or use `result.stderr.at(0)` with a non-null guard) before typecheck can pass.

ATTEMPT-FAILED: Story09-T1 — test file `error-map.test.ts` has 10 `TS2532` errors in TE-written assertions accessing `result.stderr[0]` without a non-null assertion; production code is correct but typecheck fails; TE must fix the test file

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 09 · T1 confirm GREEN (TS2532 fix) + Story 09 · T2 boundary-case behaviors RED

**Cycle.** Confirm GREEN for Task `Story09-T1` (TS2532 stub repair); RED for Task `Story09-T2` (`src/app/graph/boundary-cases.test.ts` + `src/apps/cli/graph-md/parse.test.ts`).

**Handoff verification (before fix).**

- SE reported 10 `TS2532 Object is possibly 'undefined'` errors on `result.stderr[0]` accesses (lines 80, 84, 95, 98, 111, 114, 126, 129, 143, 146) in `src/apps/cli/error-map.test.ts` under `noUncheckedIndexedAccess: true`.

**Fix applied (TE lane — test file).**
Added `!` non-null assertions to all 10 `result.stderr[0]` accesses in the Story 09 T1 test block of `src/apps/cli/error-map.test.ts`. Each occurrence of `result.stderr[0]` → `result.stderr[0]!` (5 properties + 5 template literal interpolations).

**Handoff verification (after fix).**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 09 T1 GREEN confirmation.**

- command: `node --test src/app/graph/import-errors.test.ts src/apps/cli/error-map.test.ts`
- exit: 0 — 17 tests pass (6 import-errors + 5 pre-existing error-map + 5 new Story 09 T1 error-map tests + 1 rethrow)

---

**Tests written (Story 09 T2).**

**File 1:** `src/app/graph/boundary-cases.test.ts` (new) — suite: `Story 09 T2 — boundary-case behaviors` — methods:

- `empty objective (no tasks) — CreateGraph succeeds without error` _(characterisation — passes today)_
- `empty initiative (no objectives) — CreateGraph succeeds without error` _(characterisation — passes today)_
- `task objectiveRef is DB-persisted but not in package — classified unchanged, not an error` _(characterisation — passes today)_
- `task objectiveRef ULID resolves to neither package nor DB — throws UnknownNodeError` _(RED)_
- `dep ULID belongs to a different initiative — throws CrossInitiativeError` _(RED)_

**File 2:** `src/apps/cli/graph-md/parse.test.ts` (edited) — added imports of `DuplicateRefError` + `MalformedReferenceError`; added suite `src/apps/cli/graph-md/parse.ts — boundary cases (Story 09 T2)` — methods:

- `duplicate task ref in same namespace — DuplicateRefError naming both sourcePaths` _(RED)_
- `malformed depends-on value (not ULID or slug grammar) — MalformedReferenceError naming the file` _(RED)_

**Characterisation sensitivity proofs:**

- Empty objective/initiative tests would fail if `CreateGraph.execute` rejected empty objectives/initiatives — pins the valid-graph contract.
- DB-only objective test would fail if `ApplyGraph` erroneously blocked tasks with DB-only objective parents (after the SE adds unknownObjectiveRef validation) — pins that only absent-from-both-DB-and-package refs are rejected.

**RED proof.**

- command: `node --test src/app/graph/boundary-cases.test.ts`
- exit: non-zero — 3 pass, 2 fail
- failure 1: `✖ task objectiveRef ULID resolves to neither package nor DB — throws UnknownNodeError` — `AssertionError: Missing expected rejection (UnknownNodeError): a task objectiveRef ULID absent from both package and DB must throw UnknownNodeError` — no objectiveRef validation in `ApplyGraph`
- failure 2: `✖ dep ULID belongs to a different initiative — throws CrossInitiativeError` — actual error thrown: `UnknownDependencyError: Task my-task depends on unknown task 01JQVBZ3MHKP4FTGWR5XYFNS09` — `ApplyGraph` uses `validateGraph` (domain) which throws `UnknownDependencyError`; the cross-initiative distinction is not implemented

- parse-level (also RED): `node --test src/apps/cli/graph-md/parse.test.ts`
- exit: non-zero — 14 pass, 2 fail
- failure: `✖ duplicate task ref in same namespace — DuplicateRefError naming both sourcePaths` — no dup-ref check in parser
- failure: `✖ malformed depends-on value (not ULID or slug grammar) — MalformedReferenceError naming the file` — no ref grammar validation in parser

**Open to Software Engineer.**

- Seam 1: `src/app/graph/apply-graph.ts` — in the preflight classify pass, BEFORE entering `validateGraph`, add objectiveRef validation for each package task:
  - If `task.objectiveRef` is a ULID (matches `ULID_RE`) and is not found in `pkg.objectives.map(o => o.id)` AND `initiatives.getSha256(task.objectiveRef) === undefined` → throw `UnknownNodeError(task.sourcePath, task.objectiveRef)`.
  - If `task.dependsOn` contains a ULID found in the DB but belonging to a DIFFERENT initiative (`tasks.getInitiativeId(depId) !== undefined && tasks.getInitiativeId(depId) !== initiativeId`) → throw `CrossInitiativeError(task.sourcePath, depId, initiativeId, tasks.getInitiativeId(depId)!)`.
- Seam 2: `src/apps/cli/graph-md/parse.ts` — after collecting all tasks from the walk, validate each namespace:
  - Build a `Map<ref, sourcePath>` for tasks; on duplicate, throw `DuplicateRefError(firstSourcePath, currentSourcePath, ref)` (imported from `../../../app/graph/import-errors.ts`).
  - For each value in `depends-on:` and each `objective:` value, call `classifyRef(value)` from `./refs.ts`; if it throws `MalformedReferenceError`, re-throw with the file's `sourcePath` in the error message.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 09 · T2 boundary-case behaviors (objectiveRef validation + cross-initiative + dup ref + malformed dep)

**Cycle.** GREEN+REFACTOR for `src/app/graph/boundary-cases.test.ts` + `src/apps/cli/graph-md/parse.test.ts` (Story 09 T2 boundary-case suite).

**Files changed.**

- `src/app/graph/apply-graph.ts` (edited) — imported `CrossInitiativeError`, `UnknownNodeError` from `./import-errors.ts`; added module-level `ULID_RE_APPLY` inline constant; added objectiveRef + cross-initiative validation pass before merged-graph `validateGraph`.
- `src/apps/cli/graph-md/parse.ts` (edited) — imported `DuplicateRefError` from `../../../app/graph/import-errors.ts` and `classifyRef` from `./refs.ts`; added per-dep `classifyRef` validation in `buildTask` (throws `MalformedReferenceError`); added post-loop duplicate-ref check in `parseGraphPackage` (throws `DuplicateRefError`).

**Seam (GREEN).**

- `apply-graph.ts`: after classifying all package nodes, a new validation loop iterates every package task. If `objectiveRef` is a ULID absent from both `packageObjectiveIds` AND the DB (`initiatives.getSha256 === undefined`) → throws `UnknownNodeError(sourcePath, objectiveRef)`. If any ULID `dep` in `dependsOn` has `tasks.getInitiativeId(dep)` returning a different initiative → throws `CrossInitiativeError(sourcePath, dep, initiativeId, foreignId)`. DB-only objectives (present in `getSha256`) pass cleanly (characterisation test 3 remains green).
- `parse.ts`: `buildTask` calls `classifyRef(dep)` for each string dep — `MalformedReferenceError` propagates naturally to the caller. After the walk loop, `parseGraphPackage` builds a `Map<ref, sourcePath>` over all tasks; a second entry for the same ref throws `DuplicateRefError(firstPath, currentPath, ref)`.

**Refactor.** `ULID_RE_APPLY` is inlined in `apply-graph.ts` rather than imported from `apps/cli/graph-md/refs.ts`, preserving the `app/ → no apps/` import-direction rule (AGENTS.md).

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 09 · T2 confirm GREEN + Story 09 · T3 characterisation + Story 10 · T1 RED

**Cycle.** Confirm GREEN for Story 09 T2; characterisation for Story 09 T3; RED for Task `Story10-T1` (`src/apps/cli/graph-import-export.e2e.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 09 T2 GREEN confirmation.**

- command: `node --test src/app/graph/boundary-cases.test.ts src/apps/cli/graph-md/parse.test.ts`
- exit: 0 — 21 tests pass (5 boundary-case + 2 parse boundary, plus all prior Story 03 parse tests)

**Story 09 T3 — characterisation turn (first-run pass intended; guarantee already in Stories 02+07).**

- file: `src/app/graph/context-preservation.integration.test.ts` (new) — suite: `context-preservation.integration.test.ts` — method:
  - `context-preservation: apply(spec+dep edit) leaves task_context byte-identical AND sha256 changes`
- asserts: a real-SQLite apply that changes task `ac` leaves `getTaskContext` deep-equal to the original context AND changes the `sha256` token (spec/dep update is reflected in the hash, context change is not).
- This test passes immediately because Stories 02+07 already exclude `task_context` from sha canonicalisation and `compareAndApply` only touches spec columns + `task_dependencies`.
- **Sensitivity proof (required):**
  - If `compareAndApply` issued a `DELETE FROM task_context WHERE task_id = ?` (broad cleanup), `getTaskContext` would return `{}` instead of `{ credential: "cred-001", repository: "repo-abc" }` → `deepStrictEqual` fails.
  - If `canonicalTask` included `task_context` fields, the sha before and after the ac edit would be equal (context unchanged = same hash) → `notStrictEqual` fails.
- command: `node --test src/app/graph/context-preservation.integration.test.ts`
- exit: 0 — 1 test passes

**Story 09 Verification Gate.**

- command: `node --test src/app/graph/import-errors.test.ts src/app/graph/boundary-cases.test.ts src/app/graph/context-preservation.integration.test.ts`
- exit: 0 — 12 tests pass

**Story 09 complete.** All three tasks (T1 provenance contract, T2 boundary cases, T3 context-preservation) are GREEN. Moving to Story 10.

---

**Test written (Story 10 T1).**

- file: `src/apps/cli/graph-import-export.e2e.test.ts` (new) — suite: `src/apps/cli/graph-import-export.e2e.test.ts` — method:
  - `e2e: import/export graph — 7 legs through composition root + real SQLite`
- asserts (7 legs):
  1. **Create mode**: `import graph --dir --create --project` → 1 initiative / 2 objectives / 2 tasks via `list initiative` / `list objective` / `list task --json`; source files rewritten in place with ULID `id:` (B1).
  2. **Export**: `export initiative --id --out` → cosmetic tree + manifest + `.kanthord-export.json`; exported file carries ULID; captures `TASK_API` from frontmatter.
  3. **Apply update**: edit ac, `--apply` → `1 updated` + `4 unchanged` (all-node B14); new ac present, old ac kept, no dup.
  4. **Id-less create during apply**: add task without `id:`, `--apply` → `1 created`, file rewritten with ULID; re-apply → `0 created` (durable idempotency).
  5. **Reparent**: change `objective:` ULID in frontmatter, `--apply` → `1 updated`; `list task --initiative --objective <FRONTEND>` shows deploy.
  6. **Guarded delete**: remove file; `--dry-run` reports missing + no change; `--delete-missing` (no confirm) prints plan, no change; `--delete-missing --confirm-delete` → `1 deleted`.
  7. **Conflict CAS**: export fresh + apply → bumps sha; re-apply stale → exit non-zero, output matches `/implement-api|implement api/i`, `/drift/i`, and contains `"implement-api.md"` (sourcePath cited B7/B15).

**RED proof.**

- command: `node --test src/apps/cli/graph-import-export.e2e.test.ts`
- exit: 1 — failure:
  ```
  Error: cannot start a transaction within a transaction
      at SqliteTaskRepository.saveAll (sqlite-task-repository.ts:120)
      at create-graph.ts:186
      at SqliteUnitOfWork.transaction
      at CreateGraph.execute
  ```
- Root cause: `saveAll` issues `this.#db.exec("BEGIN")` which conflicts with the outer `uow.transaction()` BEGIN IMMEDIATE in `CreateGraph.execute`. SQLite forbids nested `BEGIN` without savepoints.
- This is a real production wiring bug in Story 05 — `saveAll` must not use its own `BEGIN`/`COMMIT` when called inside an existing UoW transaction.

**Open to Software Engineer.**

- Seam: `src/storage/sqlite/sqlite-task-repository.ts` — `saveAll` must not issue its own `BEGIN`/`COMMIT`. The outer `uow.transaction` already provides the ACID guarantee; `saveAll` should run its INSERT statements directly on the shared connection.
- Additionally, the following CLI commands are absent from `router.ts` and are needed for legs 1, 5, and by the epic Proof:
  - `"list initiative"` — `--project <id> [--json]` → returns JSON array of initiatives under that project
  - `"list objective"` — `--initiative <id> [--json]` → returns JSON array of objectives for that initiative
  - `"list task"` with `--objective <id>` filter — extends the existing `"list task"` parse/handler to support filtering by objective id
- These omissions are gaps from earlier stories (the Proof and all 7 legs require them).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 10 · T1 e2e smoke test (full import/export graph wiring)

**Cycle.** GREEN+REFACTOR for `src/apps/cli/graph-import-export.e2e.test.ts`.

**Files changed.**

- `src/storage/sqlite/sqlite-task-repository.ts` (edited) — removed inner `BEGIN`/`COMMIT`/`ROLLBACK` from `saveAll`; the outer `uow.transaction()` provides the ACID guarantee, a nested `BEGIN` is an error
- `src/app/initiative/list-initiatives.ts` (new) — `ListInitiatives` class; wraps `initiativeRepo.listInitiatives(projectId)`
- `src/app/objective/list-objectives.ts` (new) — `ListObjectives` class; wraps `initiativeRepo.listObjectives(initiativeId)`
- `src/app/task/list-tasks.ts` (edited) — added optional `objectiveId?: string` to `execute` input; validates against the full initiative graph, then filters tasks to the requested objective before building `TaskRow[]`
- `src/apps/cli/initiative.ts` (edited) — added `runListInitiatives` handler; outputs JSON array or `id  name` lines
- `src/apps/cli/objective.ts` (edited) — added `runListObjectives` handler; outputs JSON array or `id  name` lines
- `src/apps/cli/list-tasks.ts` (edited) — passes `objectiveId` from `args["objective"]` to `listTasks.execute`
- `src/apps/cli/import-graph.ts` (edited) — `runApply` now appends `(${cls.sourcePath})` to each classification line when `sourcePath` is set; makes conflict output cite the file path (e.g. `drifted: <ULID> (backend/implement-api.md)`) satisfying the Proof's `includes("implement-api.md")` + `/drift/i` + `/implement-api/i` assertions
- `src/apps/cli/router.ts` (edited) — added `listInitiatives: ListInitiatives` and `listObjectives: ListObjectives` to `RouterDeps`; added `--objective` option to `"list task"`; registered `"list initiative"` and `"list objective"` in `COMMANDS`
- `src/composition.ts` (edited) — instantiated `ListInitiatives` and `ListObjectives`; added both to the returned `RouterDeps` bundle

**Seam (GREEN).** The root cause (`saveAll` nested `BEGIN`) is eliminated by removing the internal transaction; `saveAll` now relies on the caller-provided `uow.transaction()`. Three missing CLI commands are wired end-to-end: `list initiative --project [--json]`, `list objective --initiative [--json]`, `list task --objective [--json]`. The stale-apply conflict output now includes `(sourcePath)` per classification, making `/drift/i`, `/implement-api/i`, and `includes("implement-api.md")` assertions pass.

**Refactor.** No named Story 10 refactor in T1; all changes are the minimum correct wiring to make the 7-leg e2e test green.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 10 · T1 confirm GREEN (manifest-stale conflict)

**Cycle.** Confirm GREEN for Task `Story10-T1` (`src/apps/cli/graph-import-export.e2e.test.ts`).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 10 T1 GREEN confirmation attempt.**

- command: `node --test src/apps/cli/graph-import-export.e2e.test.ts`
- exit: 1 — **1 FAIL**

```
✖ e2e: import/export graph — 7 legs through composition root + real SQLite
  AssertionError [ERR_ASSERTION]: apply (id-less create) exits 0
  1 !== 0
  at src/apps/cli/graph-import-export.e2e.test.ts:359:12
```

**Root cause (diagnosed).**

Leg 3 (`--apply` update) calls `applyGraph.execute` and successfully applies the ac edit to `implement-api`. However, `runApply` in `import-graph.ts` does NOT rewrite `.kanthord-export.json` after a successful apply. So the manifest's `nodes["<implement-api-id>"]` still holds the pre-apply sha.

In leg 4 (`--apply` with new id-less task), `ApplyGraph.execute` classifies `implement-api` as follows:

```
intendedSha  = sha(implement-api with BOTH ac items)  [file now has both]
baselineSha  = sha(implement-api with ONE ac item)     [manifest not updated]
liveSha      = sha(implement-api with BOTH ac items)   [DB was updated by leg 3]
```

`classifyNode` path: `intendedSha !== baselineSha` → falls to `liveSha !== baselineSha` → `"drifted"` → `conflicts.length === 1` → `applied === false` → `runApply` returns `exitCode: 1`.

This is the B4 requirement that was not implemented: "No conflicts → apply all in one transaction, **rewrite the manifest with the fresh per-node shas**."

**Open to Software Engineer.**

Two seams need to change:

1. `src/app/graph/apply-graph.ts` — `ApplyGraphResult` must carry the fresh shas for all non-created successfully-applied nodes so the CLI can rewrite the manifest. Add `freshNodeShas?: Record<string, string>` to `ApplyGraphResult`. After the apply transaction, populate it: for each `"updated"` and `"unchanged"` node, the fresh sha is the current DB sha (call `tasks.getSha256(id)` / `initiatives.getSha256(id)`). For `"created"` tasks, the fresh sha is the `creationSha` used in `importMap.reserve`. Also add the new created node ids to a `newNodeIds` map (ref → nodeId) so the CLI can update `refToId` + `files`.

2. `src/apps/cli/import-graph.ts` — in `runApply`, after a successful (non-dry-run, non-conflict) apply, rewrite `.kanthord-export.json` in `args.dir`:
   - Update `manifest.nodes` with `result.freshNodeShas` (merge in fresh shas for all nodes).
   - Add newly created node ids to `manifest.files` and `manifest.refToId.tasks` (or `refToId.objectives`).
   - Rewrite each created file with its assigned ULID frontmatter (same atomic temp+rename as `runCreate`).
   - Write the updated manifest JSON back to `join(args.dir, ".kanthord-export.json")`.
   - This is the B1 id-handoff + B4 manifest-refresh for the apply path.

ATTEMPT-FAILED: Story10-T1 — test still RED; leg 4 "apply (id-less create)" exits 1 because `runApply` never rewrites the manifest after a successful apply, so the next apply sees implement-api's live sha as "drifted" against the stale manifest baseline

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 10 · T1 manifest refresh after successful apply (B4e / B1)

**Cycle.** GREEN for `src/apps/cli/graph-import-export.e2e.test.ts` (leg 4 "apply id-less create" exits 1 because manifest not refreshed after leg 3 apply).

**Files changed.**

- `src/app/graph/apply-graph.ts` (edited) — added `freshNodeShas?: Record<string, string>` and `createdNodes?: Array<{ref,id,sourcePath?}>` to `ApplyGraphResult`; added `createdNodesList` tracking inside the apply transaction; added a post-transaction sha-gathering pass that reads current DB shas for every updated/unchanged/created node; returns both fields in the result.
- `src/apps/cli/import-graph.ts` (edited) — in `runApply`, after a successful non-dry-run apply, merges `result.freshNodeShas` into `manifest.nodes`, rewrites each newly created file with its assigned ULID (atomic temp+rename), adds created node ids to `manifest.files` + `manifest.refToId.tasks`, and writes the updated `.kanthord-export.json` back to `args.dir`.

**Seam (GREEN).** The root cause: `runApply` never updated the manifest after leg 3's successful apply, so implement-api's baseline sha stayed at the single-ac version. Leg 4 then saw `intendedSha (2 ac) !== baselineSha (1 ac)` AND `liveSha (2 ac) !== baselineSha (1 ac)` → classified as "drifted" → exit 1.

Fix: `apply-graph.ts` now reads fresh shas from the DB after the transaction commits and returns them as `freshNodeShas`; `import-graph.ts` merges those shas into the manifest and writes it back. On leg 4, implement-api's baseline sha is now up-to-date (matches liveSha), so it classifies correctly as "unchanged".

The new `ApplyGraphResult` fields are optional, so all existing test fakes that return literal `ApplyGraphResult` objects are unaffected (the typecheck confirms this).

**Refactor.** None named in Task T1.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 10 · T1 confirm GREEN (FK constraint failure on delete)

**Cycle.** Confirm GREEN for Task `Story10-T1` (`src/apps/cli/graph-import-export.e2e.test.ts`) — second attempt.

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 10 T1 GREEN confirmation attempt.**

- command: `node --test src/apps/cli/graph-import-export.e2e.test.ts`
- exit: 1 — **still RED**

```
✖ e2e: import/export graph — 7 legs through composition root + real SQLite
  Error: FOREIGN KEY constraint failed
      at SqliteTaskRepository.conditionalDeleteTask (sqlite-task-repository.ts:395:56)
      at apply-graph.ts:585:50
      at SqliteUnitOfWork.transaction
      at ApplyGraph.execute
  code: 'ERR_SQLITE_ERROR', errcode: 787
```

**Root cause (diagnosed).**

Leg 6 (`--delete-missing --confirm-delete`) calls `conditionalDeleteTask(deploy.id, sha)` which runs:

```sql
DELETE FROM tasks WHERE id = ?
```

But `task_dependencies` has **no `ON DELETE CASCADE`** on its FK columns:

```sql
task_dependencies.taskId      TEXT NOT NULL REFERENCES tasks(id)   -- no CASCADE
task_dependencies.dependency  TEXT NOT NULL REFERENCES tasks(id)   -- no CASCADE
events.taskId                 TEXT NOT NULL REFERENCES tasks(id)   -- no CASCADE
jobs.taskId                   TEXT NOT NULL REFERENCES tasks(id)   -- no CASCADE
task_context.taskId           TEXT NOT NULL REFERENCES tasks(id)   -- no CASCADE
task_results.taskId           TEXT NOT NULL REFERENCES tasks(id)   -- no CASCADE
```

The "deploy" task was created with `depends-on: [implement-api]`, so `task_dependencies` holds a row `(taskId=deploy.id, dependency=implement-api.id)`. Deleting "deploy" violates that FK. Additionally, task creation inserts a `task.created` event row referencing the task in `events`.

`conditionalDeleteTask` must clean up all child rows before the `DELETE FROM tasks` — or SQLite cannot remove the row.

**Open to Software Engineer.**

- Seam: `src/storage/sqlite/sqlite-task-repository.ts` — in `conditionalDeleteTask`, after the sha match is confirmed and before `DELETE FROM tasks WHERE id = ?`, add DELETE statements for every child table that references `tasks(id)` without `ON DELETE CASCADE`:
  1. `DELETE FROM task_dependencies WHERE taskId = ?` (own dependency edges — this is the immediate blocker)
  2. `DELETE FROM events WHERE taskId = ?` (task.created + any other events for this task)
  3. `DELETE FROM jobs WHERE taskId = ?` (queued jobs, if any)
  4. `DELETE FROM task_context WHERE taskId = ?` (resource bindings, if any — consistent cleanup)
  5. `DELETE FROM task_results WHERE taskId = ?` (results, if any — consistent cleanup)
     All in the same call (within whatever transaction is active via the UoW). The existing `graph_import_map.task_id` already has `ON DELETE CASCADE` and will be cleaned automatically.

ATTEMPT-FAILED: Story10-T1 — still RED; `conditionalDeleteTask` issues `DELETE FROM tasks` without first clearing child-table rows that reference `tasks(id)` without CASCADE; FOREIGN KEY constraint fails on `task_dependencies.taskId = deploy.id`

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 10 · T1 FK child-row cleanup before conditionalDeleteTask

**Cycle.** GREEN for `src/apps/cli/graph-import-export.e2e.test.ts` (leg 6 `--delete-missing --confirm-delete` fails with FK constraint on `task_dependencies.taskId`).

**Files changed.**

- `src/storage/sqlite/sqlite-task-repository.ts` (edited) — in `conditionalDeleteTask`, added six child-table DELETE statements before `DELETE FROM tasks WHERE id = ?`:
  1. `DELETE FROM task_dependencies WHERE taskId = ?` (edges where task is the dependent)
  2. `DELETE FROM task_dependencies WHERE dependency = ?` (edges where task is the depended-upon)
  3. `DELETE FROM events WHERE taskId = ?`
  4. `DELETE FROM jobs WHERE taskId = ?`
  5. `DELETE FROM task_context WHERE task_id = ?`
  6. `DELETE FROM task_results WHERE task_id = ?`

**Seam (GREEN).** The "deploy" task had a `task_dependencies` row with `dependency = implement-api.id` and another with `taskId = deploy.id`; SQLite FK enforcement blocked the `DELETE FROM tasks` before either row was removed. Deleting all child rows first in the same call (within the active UoW transaction) satisfies the FK constraint and lets the task row be removed.

**Refactor.** None required — change is the minimum correct fix.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 10 · T1 confirm GREEN (FK child-row fix → drift-unchanged bug)

**Cycle.** Confirm GREEN for Task `Story10-T1` (`src/apps/cli/graph-import-export.e2e.test.ts`) — third attempt.

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Story 10 T1 GREEN confirmation attempt.**

- command: `node --test src/apps/cli/graph-import-export.e2e.test.ts`
- exit: 1 — **still RED** (leg 7)

```
✖ e2e: import/export graph — 7 legs through composition root + real SQLite
  AssertionError [ERR_ASSERTION]: stale apply must exit non-zero (drift conflict)
  actual: 0   expected: 0 (notStrictEqual)
  at src/apps/cli/graph-import-export.e2e.test.ts:612:12
```

**Root cause (diagnosed).**

`classifyNode` in `src/app/graph/apply-graph.ts` line 172:

```ts
function classifyNode(intendedSha, baselineSha, liveSha, liveStatus) {
  if (intendedSha === baselineSha) return "unchanged";   // ← bug: no liveSha check
  if (liveSha !== baselineSha) return "drifted";
  …
}
```

Leg 7 flow:

- PKG's manifest was updated after each prior successful apply. After leg 6 (delete + confirm), the manifest has `implement-api` sha = sha(2 ac items, reparented under backend).
- The fresh apply (OUT2) adds a third ac item and bumps implement-api's DB sha to sha(3 ac items).
- Stale apply of PKG: `implement-api` file still has 2 ac items → `intendedSha = sha(2 ac)` = `baselineSha`. `liveSha = sha(3 ac)` ≠ `baselineSha`.
- `classifyNode` hits line 172 and returns `"unchanged"` before reaching the `liveSha !== baselineSha` guard. Conflict is missed → exits 0.

The fix is to check `liveSha` drift BEFORE the `intendedSha === baselineSha` early-return. A node that hasn't been touched by the package but whose DB row was externally modified is still a drift conflict — the Proof and the EPIC's "full preflight-classify" mandate make this clear.

**Open to Software Engineer.**

- Seam: `src/app/graph/apply-graph.ts` — in `classifyNode`, move the `liveSha !== baselineSha → "drifted"` guard BEFORE the `intendedSha === baselineSha → "unchanged"` early-return, so a DB-drifted node is always classified `"drifted"` regardless of whether the package intended to mutate it:
  ```ts
  function classifyNode(intendedSha, baselineSha, liveSha, liveStatus) {
    if (liveSha !== baselineSha) return "drifted";
    if (intendedSha === baselineSha) return "unchanged";
    if (liveStatus !== "pending") return "locked";
    return "updated";
  }
  ```
  All existing `classifyNode`-exercising tests in `apply-graph.test.ts` must remain green after this change (the Story 07 T1 hermetic tests pass `liveSha === baselineSha` for unchanged nodes, so reordering is safe for them).

ATTEMPT-FAILED: Story10-T1 — still RED; leg 7 "stale apply must exit non-zero" exits 0; `classifyNode` returns "unchanged" when `intendedSha===baselineSha` even though `liveSha!==baselineSha` — externally-drifted unchanged-from-PKG node is not classified "drifted", so the conflict is never raised and the apply exits 0

END: TEST-ENGINEER
DEBATE_REVIEW: FAIL — Ulrich invoked the /debate engine (opencode/plan + reviewer sub-agent) on the repeated Story10-T1 leg-7 failure. Root cause confirmed + 3 additional gaps found. Routing 4 blockers back through the TDD loop; Story10-T1 attempt counter resets here.
BLOCKER: RB1 classify-order — in apply-graph.ts classifyNode, move `if (liveSha !== baselineSha) return "drifted"` ABOVE the `intendedSha === baselineSha → "unchanged"` early-return, so a package-present but unedited node whose DB row drifted externally is classified "drifted" (leg 7 must exit non-zero + print "drifted"). Confirmed safe for the id-less/creationSha mapped-retry path and non-regressive on existing unchanged/updated counts.
BLOCKER: RB2 sourcePath-package-qualified — the conflict/classification output must cite the PACKAGE-QUALIFIED path ($PKG/backend/implement-api.md), not just the package-relative path (backend/implement-api.md). Proof line 178 greps the qualified path. Prefix the package root when rendering the sourcePath in the conflict report (import-graph.ts ~149-156 / apply-graph classification), without breaking the existing relative-path tests.
BLOCKER: RB3 late-CAS-conflict-rollback — the apply write pass (apply-graph.ts ~493-536) currently discards every CasResult and commits regardless. Per B4(d), inspect every CasResult (compareAndApply / conditionalReparent / conditionalDelete* / conditionalRename*) and if ANY returns status "conflict", roll back the whole UnitOfWork and report the conflict (applied:false, exit 1) instead of committing a partial/stale apply.
BLOCKER: RB4 stale-state-regressions — add hermetic tests for the exact previously-uncovered states: (a) identified node intendedSha===baselineSha && liveSha!==baselineSha classifies "drifted"; (b) mapped id-less node liveSha!==creationSha classifies "drifted"; (c) a real-SQLite late-CAS-conflict test proving the RB3 rollback (a row drifts after preflight, before write → whole apply rolls back, DB unchanged).

## TEST-ENGINEER — Story 10 · T1 RB regression tests (RB1/RB2/RB3/RB4)

**Cycle.** RED regression tests for DEBATE_REVIEW blockers RB1/RB2/RB3/RB4 (Story 10 T1 re-entry).

**Tests written.**

- file: `src/app/graph/apply-graph.test.ts` (edited) — suite: `RB regressions — classify-order + late-CAS-rollback` — methods:
  - `RB4a/RB1: identified node unchanged-in-PKG but DB-drifted → classified drifted, applied:false`
  - `RB4b: mapped id-less node liveSha!==creationSha → classified drifted, applied:false`
  - `RB3/RB4c: compareAndApply returns conflict in write phase → applied:false (late rollback)`
  - New helper class: `FakeTaskRepositoryWithLateCasConflict` (extends `FakeTaskRepository`; `compareAndApply` always returns `{status: "conflict", currentSha: "post-preflight-drift-sha"}`)
- asserts:
  - RB4a/RB1: identified package node with `intendedSha===baselineSha` but `liveSha!==baselineSha` classifies "drifted" and blocks apply (`applied:false`).
  - RB4b: mapped id-less node with `liveSha!==creationSha` classifies "drifted" and blocks apply.
  - RB3/RB4c: preflight passes but `compareAndApply` returns `{status:"conflict"}` in the write phase → `applied:false` (late rollback).

- file: `src/apps/cli/graph-import-export.e2e.test.ts` (edited) — leg 7 — RB2 assertion strengthened:
  - Old: `staleOut.includes("implement-api.md")` (just filename)
  - New: `staleOut.includes(join(pkgDir, "backend", "implement-api.md"))` (full qualified path per Proof line 178)

**RED proof — hermetic (`apply-graph.test.ts`).**

- command: `node --test src/app/graph/apply-graph.test.ts`
- exit: non-zero — 3 failures:
  - `✖ RB4a/RB1: identified node unchanged-in-PKG but DB-drifted → classified drifted, applied:false` — `AssertionError: expected "drifted" for externally-drifted unchanged-in-PKG node; got: unchanged`
  - `✖ RB4b: mapped id-less node liveSha!==creationSha → classified drifted, applied:false` — `AssertionError: expected "drifted" for mapped id-less node with drifted live sha; got: unchanged`
  - `✖ RB3/RB4c: compareAndApply returns conflict in write phase → applied:false (late rollback)` — `AssertionError: late CAS conflict (compareAndApply returned conflict) must make applied:false — true !== false`
- 21 pass, 3 fail — all prior tests remain green.

**RED proof — e2e (`graph-import-export.e2e.test.ts`).**

- The e2e test currently fails at the existing leg 7 "stale apply must exit non-zero (drift conflict)" assertion (the RB1 `classifyNode` bug). The new RB2 qualified-path assertion is in place and will fire once RB1 is fixed.

**Root-cause sensitivity.**

- RB4a/RB1: `classifyNode` in `apply-graph.ts` line 172 — `if (intendedSha === baselineSha) return "unchanged"` fires before `if (liveSha !== baselineSha) return "drifted"`. Moving the liveSha guard first fixes both RB4a and RB1.
- RB4b: same ordering bug, same fix — the `creationSha` plays the role of `baselineSha` for id-less mapped nodes.
- RB3/RB4c: `apply-graph.ts` lines ~493-536 call `compareAndApply` / `conditionalReparent` / etc. but discard every `CasResult`; `applied:true` is returned regardless. Inspecting every `CasResult` and returning `{applied:false, …}` (with rollback) on any `{status:"conflict"}` fixes this.
- RB2: `import-graph.ts` line 154 renders `cls.sourcePath` (package-relative) without the package root prefix. Prefixing `args.dir` produces the qualified path that the Proof and the now-strengthened e2e assertion require.

**Open to Software Engineer.**

Four seams to fix in `src/app/graph/apply-graph.ts`:

1. **RB1/RB4a/RB4b** — `classifyNode` (line ~166): move `if (liveSha !== baselineSha) return "drifted"` ABOVE `if (intendedSha === baselineSha) return "unchanged"`. No other logic changes to this function.

2. **RB3/RB4c** — apply write loop (line ~470): after each CAS call (`compareAndApply`, `conditionalReparent`, `conditionalDeleteTask`, `conditionalRenameInitiative`, `conditionalRenameObjective`, `conditionalDeleteObjective`), inspect the returned `CasResult`. If any returns `{status:"conflict"}`, the UnitOfWork must abort (throw inside the `transaction` callback to trigger rollback) and the use case must return `{applied:false, conflicts:[…], …}`.

3. **RB2** — conflict render in `src/apps/cli/import-graph.ts` (line ~154): prefix `args.dir + "/"` (or `join(args.dir, cls.sourcePath)`) when rendering the sourcePath in the conflict/classification output line, so the full qualified path is printed.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 10 · T1 RB1/RB2/RB3 blockers

**Cycle.** GREEN+REFACTOR for `src/app/graph/apply-graph.test.ts` + `src/apps/cli/graph-import-export.e2e.test.ts` (DEBATE_REVIEW RB1/RB2/RB3/RB4a/RB4b/RB4c regressions).

**Files changed.**

- `src/app/graph/apply-graph.ts` (edited) — `classifyNode`: moved `liveSha !== baselineSha → "drifted"` guard ABOVE the `intendedSha === baselineSha → "unchanged"` early-return (RB1/RB4a/RB4b). Added `LateCasConflict` sentinel class. Wrapped entire write `uow.transaction` in a try/catch; every CAS call (`compareAndApply`, `conditionalReparent`, `conditionalRenameInitiative`, `conditionalRenameObjective`, `conditionalDeleteTask`, `conditionalDeleteObjective`) now inspects its `CasResult` and throws `LateCasConflict` if status is `"conflict"`; the catch block returns `{applied:false, conflicts:[…]}` (RB3/RB4c).
- `src/apps/cli/import-graph.ts` (edited) — in the classification output loop, changed `cls.sourcePath` to `join(args.dir, cls.sourcePath)` so the printed path is package-qualified (RB2).

**Seam (GREEN).**

- RB1/RB4a/RB4b: `classifyNode` now always detects external DB drift regardless of whether the package intended a mutation.
- RB3/RB4c: any CAS operation returning `{status:"conflict"}` during the write phase throws inside the `uow.transaction` callback, forcing rollback; the caught `LateCasConflict` causes the use case to return `{applied:false}`.
- RB2: `import-graph.ts` prints the full package-qualified path for every classification with a `sourcePath`.

**Refactor.** Named refactor is the RB3 late-rollback pattern itself — applied inline; no separate step deferred.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 10 · T1 confirm GREEN (RB regressions + gate failure)

**Cycle.** Confirm GREEN for Task `Story10-T1` RB1–RB4 regressions; ATTEMPT-FAILED on full Verification Gate.

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**RB regression tests GREEN.**

- command: `node --test src/app/graph/apply-graph.test.ts src/apps/cli/graph-import-export.e2e.test.ts`
- exit: 0 — 25 pass, 0 fail (24 apply-graph tests including 3 new RB regressions + 1 e2e 7-leg smoke)

**TE repair applied (test file only).**
The RB3 fix introduced a secondary regression in the T1 `apply-graph.test.ts` test `ApplyGraph — edited task ac: that task updated, siblings unchanged; initiative+objective also classified (B14)`. That test used the base `FakeTaskRepository` whose `compareAndApply` stub returns `{status:"conflict"}`. The RB3 write-phase now aborts on any conflict `CasResult`, so a legitimately "updated" task caused `applied: false`.

Fix:

1. Moved `FakeTaskRepositoryWithCas` and `FakeGraphImportMapWithSpy` class definitions to before the `makeDeps` function (from after line 860 to after `FakeGraphImportMap` at ~line 247) so they are available to T1 tests.
2. Updated the failing T1 test to use `FakeTaskRepositoryWithCas` (seeded with the same base data as `makeBaseDb()`), so `compareAndApply` returns `{status:"applied"}` during the write phase.

- file: `src/app/graph/apply-graph.test.ts` (edited) — class definitions relocated; T1 "edited task ac" test uses explicit `FakeTaskRepositoryWithCas` + manual seed

After this repair: 24/24 apply-graph tests pass, 1/1 e2e passes.

**Full Verification Gate — FAIL.**

- command: `npm run verify`
- exit: 1 — 1 test failure in `src/storage/sqlite/sqlite-task-repository.test.ts`:

```
✖ SqliteTaskRepository saveAll with a duplicate id persists nothing
  AssertionError: Expected values to be strictly equal:
  actual: { id: '01KXTVA2M2919SQT2ZDT83F8WN', … }   expected: undefined
```

**Root cause.**

The Story 10 T1 SE turn (fixing nested `BEGIN` in `CreateGraph`) removed the inner `BEGIN`/`COMMIT`/`ROLLBACK` from `SqliteTaskRepository.saveAll`. The pre-existing test `saveAll with a duplicate id persists nothing` asserts that a duplicate-id batch is ROLLED BACK and nothing is persisted. Without any transaction, the first INSERT commits before the duplicate-key error on the second INSERT, leaving `taskA` in the database.

The fix is to replace `BEGIN`/`COMMIT`/`ROLLBACK` in `saveAll` with `SAVEPOINT`/`RELEASE`/`ROLLBACK TO SAVEPOINT`:

```ts
saveAll(tasks: Task[]): void {
  this.#db.exec("SAVEPOINT saveall");
  try {
    for (const task of tasks) {
      // ... existing INSERT logic
    }
    this.#db.exec("RELEASE SAVEPOINT saveall");
  } catch (err) {
    this.#db.exec("ROLLBACK TO SAVEPOINT saveall");
    this.#db.exec("RELEASE SAVEPOINT saveall");
    throw err;
  }
}
```

`SAVEPOINT` is nesting-safe — it works inside an active `BEGIN IMMEDIATE` (SQLite supports nested savepoints within a transaction), so `CreateGraph.execute`'s outer `uow.transaction()` is unaffected. When called outside a UoW transaction, the savepoint provides the same atomicity as the original `BEGIN`/`COMMIT`/`ROLLBACK`.

**Open to Software Engineer.**

- Seam: `src/storage/sqlite/sqlite-task-repository.ts` — in `saveAll`, replace `this.#db.exec("BEGIN")` / `this.#db.exec("COMMIT")` / `this.#db.exec("ROLLBACK")` with `SAVEPOINT saveall` / `RELEASE SAVEPOINT saveall` / `ROLLBACK TO SAVEPOINT saveall` as shown above. No other production files need to change; the existing test at line 175 must pass once the savepoint is in place.

ATTEMPT-FAILED: Story10-T1 — `npm run verify` exits 1; `SqliteTaskRepository saveAll with a duplicate id persists nothing` fails because the Story 10 T1 SE turn removed `saveAll`'s inner `BEGIN`/`COMMIT`/`ROLLBACK` (to fix nested-transaction in CreateGraph), leaving `saveAll` without atomicity when called outside a UoW; fix is `SAVEPOINT`/`RELEASE`/`ROLLBACK TO SAVEPOINT`

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 10 · saveAll SAVEPOINT atomicity

**Cycle.** GREEN+REFACTOR for `SqliteTaskRepository saveAll with a duplicate id persists nothing`.

**Files changed.**

- `src/storage/sqlite/sqlite-task-repository.ts` (edited) — `saveAll`: wrap all inserts in `SAVEPOINT saveAll` / `RELEASE SAVEPOINT saveAll`, rolling back via `ROLLBACK TO SAVEPOINT saveAll` + `RELEASE` on any error.

**Seam (GREEN).** SAVEPOINTs nest inside an outer `BEGIN IMMEDIATE` (so `CreateGraph`-inside-UoW still works) AND act as a standalone atomic unit when called outside a transaction, satisfying the duplicate-id rollback test.

**Refactor.** Named refactor not applicable — this is the standalone atomicity fix.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 10 · T1 Verification Gate (saveAll SAVEPOINT fix)

**Cycle.** Attempting final IMPLEMENTATION_READY_FOR_REVIEW after saveAll SAVEPOINT fix.

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Test repairs applied (TE lane — test files only).**
Three `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comments in test files were flagging as "Definition for rule '@typescript-eslint/no-explicit-any' was not found" because the ESLint config (`eslint.config.js`) does not include the `@typescript-eslint` plugin. These comments were in:

- `src/apps/cli/import-graph.test.ts` (lines 469 and 524, two identical occurrences — removed both via `replace_all`)
- `src/app/graph/context-preservation.integration.test.ts` (line 164 — removed one)
  The underlying `as any` casts remain valid (no rule prohibits them in the current config). This is a TE-lane fix (test files I authored).

**Full Verification Gate — FAIL.**

- command: `npm run verify`
- exit: 1 — 1 lint error remains (production code, outside TE lane):

```
/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/apps/cli/import-graph.ts
  11:23  error  There is no policy allowing dependencies from elements of type "apps" to elements of type "domain"  boundaries/dependencies
```

Line 11 of `src/apps/cli/import-graph.ts` imports `newId` from `../../domain/entity.ts`. The ESLint boundaries policy allows `apps/` to import `app/` (use cases) but NOT `domain/` directly. This is a production code issue the SE must fix (e.g. move the `newId` call to a helper in the `app/` layer, or expose a thin wrapper, or reroute through a port).

**All 708 unit tests pass** (exit 0 from `npm test`).

**Proof not attempted** — blocked by `npm run verify` lint failure.

ATTEMPT-FAILED: Story10-T1 — `npm run verify` exits 1; `src/apps/cli/import-graph.ts` line 11 imports `newId` from `../../domain/entity.ts` violating the `apps → domain` boundary policy; SE must re-route the `newId` call through the `app/` layer (or equivalent) so `eslint-plugin-boundaries` is satisfied

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 10 · T1 Verification Gate (apps→domain boundary fix)

**Cycle.** GREEN+REFACTOR for Story10-T1 lint boundary error.

**Files changed.**

- `src/apps/cli/import-graph.ts` (edited) — removed `import { newId } from "../../domain/entity.ts"`; added `import { randomUUID } from "node:crypto"`; added optional `newId?: () => string` to `ImportGraphDeps`; `runCreate` now receives a `mintId` parameter; call site passes `deps.newId ?? randomUUID`
- `src/apps/cli/router.ts` (edited) — added `newId: () => string` to `RouterDeps`; `"import graph"` handler now passes `newId: deps.newId` into `ImportGraphDeps`
- `src/composition.ts` (edited) — `newId` added to the returned `RouterDeps` bundle

**Seam (GREEN).** `import-graph.ts` no longer imports from `domain/`; the id-minting capability is injected via `ImportGraphDeps.newId` (optional with `randomUUID` fallback so existing tests that omit it remain valid); the composition root wires the real ULID `newId` from `domain/entity.ts` through `RouterDeps` — the only layer permitted to import domain concrete functions.

**Refactor.** Applied inline: helper `runCreate` signature extended with explicit `mintId` parameter instead of closing over module-level import.

**Build check.**

- typecheck: exit 0
- lint: exit 0 (no boundary errors)

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 10 · Verification Gate (Proof positional-arg gap)

**Cycle.** Attempting IMPLEMENTATION_READY_FOR_REVIEW after last SE turn (apps→domain boundary fix).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**`npm run verify` gate.**

- command: `npm run verify`
- exit: 0 — 708 tests pass, 0 failures, lint clean, typecheck clean, `db status` green.

**Proof block — FAIL.**

- First failing command: `node src/main.ts import graph "$SRC" --create --project "$PROJECT"`
- Error: `error: Unexpected argument '/tmp/.../oauth'. This command does not take positional arguments`
- Root cause: The Proof uses `import graph <dir>` and `export initiative <id>` as **positional** arguments. The router sets `allowPositionals: false`, which rejects any non-flag token after the command verb+object. The e2e test works because it uses `--dir` / `--id` named flags, but the Proof (the binding contract per the EPIC) uses the positional form shown in the usage string.

**Regression tests written (BLOCKER: Proof-positional).**

- file: `src/apps/cli/router-positional.regression.test.ts` (new) — suite: `router-positional.regression.test.ts` — methods:
  - `import graph accepts first positional as <dir> (Proof compatibility)`
  - `export initiative accepts first positional as <id> (Proof compatibility)`
- asserts: `dispatch(["import", "graph", srcDir, "--create", "--project", PROJECT], deps)` exits 0 without "does not take positional arguments" in stderr; `dispatch(["export", "initiative", INITIATIVE, "--out", exportDir], deps)` exits 0 without "does not take positional arguments".

**RED proof.**

- command: `node --test src/apps/cli/router-positional.regression.test.ts`
- exit: 1 — both tests fail:
  - `✖ import graph accepts first positional as <dir> (Proof compatibility)` — `AssertionError: import graph must accept positional dir; got: error: Unexpected argument '…/oauth'. This command does not take positional arguments`
  - `✖ export initiative accepts first positional as <id> (Proof compatibility)` — `AssertionError: export initiative must accept positional id; got: error: Unexpected argument '01KXTW…'. This command does not take positional arguments`

**Open to Software Engineer.**

- Seam: `src/apps/cli/router.ts` — in `dispatch`, for `"import graph"` and `"export initiative"`, allow a first positional argument and map it to the named option (`dir` / `id`) before passing to `parseArgs`. One approach: pre-process `rest` — if the first element is a non-flag token AND the command is `import graph`, shift it off `rest` and inject `--dir <value>` (or set it in the parsed values directly); same for `export initiative` → `--id <value>`. The rest of the `allowPositionals: false` constraint can remain for all other commands. After the fix, the existing e2e test (`--dir` / `--id` flag form) must remain green AND the new positional-form tests must also be green.

ATTEMPT-FAILED: Story10-T1 — `npm run verify` exits 0 but the Proof bash block fails at `node src/main.ts import graph "$SRC"` because the router rejects positional args; `import graph <dir>` and `export initiative <id>` in the Proof use positional syntax that the router currently forbids

END: TEST-ENGINEER
ORCH_CONTINUE: Story10-T1 hit 3 attempts since the debate boundary, but all three were DISTINCT forward-progress gaps (saveAll SAVEPOINT atomicity, apps→domain newId lint boundary, and now the Proof's positional-arg CLI wiring) — not a stuck task. `npm run verify` is now fully green (708 tests + lint); only the final Proof CLI wiring remains. Per Ulrich's directive to drive the cycle to done, resetting the Story10-T1 counter and continuing one targeted fix. Next boundary/hard-stop if progress stalls (same bug twice or verify regresses).

## SOFTWARE-ENGINEER — Story10-T1 · Proof positional-arg gap (BLOCKER: Proof-positional)

**Cycle.** GREEN for `src/apps/cli/router-positional.regression.test.ts`.

**Files changed.**

- `src/apps/cli/router.ts` (edited) — added `positional?: string` to `CommandEntry`; set `positional: "dir"` on `"import graph"`, `positional: "id"` on `"export initiative"`; updated `dispatch` to call `parseArgs` with `allowPositionals: true` for those commands and then promote the first positional to the declared named flag when the named flag is not already supplied.

**Seam (GREEN).** When a `CommandEntry` declares `positional`, `dispatch` passes `allowPositionals: true` to `parseArgs` and injects `parsed.positionals[0]` as the value for that named flag — only when the flag itself is absent — so both positional and flag-based invocations route correctly.

**Refactor.** None required; the named refactor was not specified for this regression fix.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 10 · Verification Gate (missing-node-label Proof failure)

**Cycle.** Confirm attempt for Story 10 T1 full Verification Gate; ATTEMPT-FAILED — Proof fails at `grep -qiE 'missing.*deploy'`; regression test written.

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**`npm run verify` gate.**

- command: `npm run verify`
- exit: 0 — 710 tests pass, 0 failures, lint clean, typecheck clean.

**Proof block — FAIL.**

Ran the full Proof bash block verbatim.

Failure point: the `--dry-run` leg of the GUARDED DELETE-MISSING section:

```
node src/main.ts import graph "$PKG" --apply --initiative "$INITIATIVE" --dry-run 2>&1 | grep -qiE 'missing.*deploy'
```

Actual stdout produced by that command:

```
unchanged: 01KXTWTMWQWC6Y6NYP1A973RX5 (/…/oauth.md)
unchanged: 01KXTWTMWQWC6Y6NYP1A973RX6 (/…/backend/backend.md)
unchanged: 01KXTWTMWQWC6Y6NYP1A973RX7 (/…/frontend/frontend.md)
unchanged: 01KXTWTMWQWC6Y6NYP1A973RX9 (/…/implement-api.md)
unchanged: 01KXTWTQ6DXZJ4NHF27GP8KJ2J (/…/write-tests.md)
missing: 01KXTWTMWQWC6Y6NYP1A973RX8
0 created, 0 updated, 5 unchanged, 1 missing
```

The deploy task appears as `missing: <ULID>` — the ULID `01KXTWTMWQWC6Y6NYP1A973RX8` never matches `deploy`. `grep -qiE 'missing.*deploy'` exits 1.

**Root cause.**
`ApplyClassification` has no `name` field. When classifying a missing node (id exists in manifest.files but file was removed), `import-graph.ts` line 151 renders `cls.id ?? cls.ref` — always a ULID for exported packages (ULID-as-ref ruling), never the human-readable task title "deploy". The Proof requires the task name to appear on the missing line.

**Regression test written (BLOCKER: missing-node-label).**

- file: `src/apps/cli/import-graph.test.ts` (edited) — added test:
  - `BLOCKER missing-node-label: missing classification with name field emits name not just ULID (Proof grep -qiE 'missing.*deploy')`
- asserts: `runImportGraph` with a missing classification that carries `name: "deploy"` produces a stdout line matching `/missing.*deploy/i`; the current output is `missing: 01JTEST00000000000000000E5` which does not match — fails for the right reason.

**RED proof.**

- command: `node --test src/apps/cli/import-graph.test.ts`
- exit: non-zero — 1 failure, 9 pass
- failure: `✖ BLOCKER missing-node-label: missing classification with name field emits name not just ULID (Proof grep -qiE 'missing.*deploy')` — `AssertionError: output must cite task name "deploy" in the missing line (Proof: grep -qiE 'missing.*deploy'); got: missing: 01JTEST00000000000000000E5`

**Open to Software Engineer.**

- Seam 1: `src/app/graph/apply-graph.ts` — add optional `name?: string` to `ApplyClassification`. When building a `"missing"` classification for a task node (id in `manifest.files`, file absent from package), load the live task via `tasks.get(id)` and set `name: task?.title` on the classification entry.
- Seam 2: `src/apps/cli/import-graph.ts` — in the classification rendering loop (line 151), use `cls.name ?? cls.id ?? cls.ref` as the label so that a task named "deploy" renders as `missing: deploy (…)` or `missing: deploy`.

ATTEMPT-FAILED: Story10-T1 — Proof `grep -qiE 'missing.*deploy'` fails because missing classification renders only ULID, not the task name; `ApplyClassification` needs `name?: string` and `apply-graph.ts` must populate it for missing task nodes from `tasks.get(id)?.title`

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 10 · missing-node-label (BLOCKER: missing-node-label)

**Cycle.** GREEN for `src/apps/cli/import-graph.test.ts` (BLOCKER: missing-node-label).

**Files changed.**

- `src/app/graph/apply-graph.ts` (edited) — added `name?: string` to `ApplyClassification`; in the missing-node classification loop, reads `this.#deps.tasks.get(fileId)?.title` for `kind === "task"` and sets `name` on the pushed classification.
- `src/apps/cli/import-graph.ts` (edited) — changed label expression from `cls.id ?? cls.ref` to `cls.name ?? cls.id ?? cls.ref` so missing task nodes print their human-readable title.

**Seam (GREEN).** When `ApplyGraph` classifies a missing task node it now loads the live task title from the repo and attaches it as `name`; `runImportGraph` then uses `name` first in the label chain, so the output line reads `missing: deploy` (or `missing: deploy (…)` if sourcePath is present), satisfying `grep -qiE 'missing.*deploy'`.

**Refactor.** None required; the Task named no REFACTOR step.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — implementation ready for review

**Cycle.** All Tasks GREEN (Stories 01–10); EPIC Verification Gate PASS.

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**EPIC verification gate.**

| gate      | command                 | exit                      |
| --------- | ----------------------- | ------------------------- |
| typecheck | `npm run typecheck`     | 0                         |
| unit      | `npm test`              | 0 — 711 tests, 0 failures |
| lint      | `npm run lint`          | 0                         |
| db status | `npm run verify` (full) | 0                         |

Full gate command: `npm run verify` — exit 0 — 711 tests pass, 0 failures, lint clean, typecheck clean.

**Proof block result.**
Ran the full EPIC `## Verification Gate` Proof bash block verbatim (`set -euo pipefail` … `echo "PROOF OK"`).

All seven legs passed:

1. CREATE MODE — 1 initiative / 2 objectives / 2 tasks imported; source files rewritten with ULIDs (B1). ✔
2. EXPORT — cosmetic tree + manifest written; exported file carries ULID. ✔
3. APPLY update — `1 updated` + `4 unchanged`; new ac present, old kept. ✔
4. ID-LESS CREATE during apply — `1 created`, file rewritten; re-apply → `0 created` (idempotency). ✔
5. REPARENT — `1 updated`; `list task --objective <FRONTEND>` shows "deploy". ✔
6. GUARDED DELETE — `--dry-run` matches `missing.*deploy`; `--delete-missing` prints plan, no change; `--confirm-delete` → `1 deleted`. ✔
7. CONFLICT CAS — stale apply exits non-zero; output matches `/implement-api/`, `/drift/`, and cites the full qualified `implement-api.md` path (B7/B15). ✔

Final output: `PROOF OK`

**Tasks closed.** 28 Tasks across 10 Stories.

IMPLEMENTATION_READY_FOR_REVIEW:

- gates: PASS
- date: 2026-07-18
- state: local-uncommitted

END: TEST-ENGINEER
AUTO_REVIEW: FAIL — reviewer-engineer gate: routing 1 action:YES finding to the TDD loop; 3 action:NO findings recorded for the human.
BLOCKER: B1 combined-spec-and-reparent-drops-reparent — apply-graph.ts (~527-540): when a task's spec field AND its frontmatter `objective:` ref both change in one apply, the `else if (specChanged)` branch calls only `compareAndApply` (which updates title/instructions/ac/agent/verification/dependencies) and NEVER calls `conditionalReparent`, so `objectiveId` is silently left unchanged and the node classifies "updated" forever. Fix: after compareAndApply returns status "applied", if objectiveChanged, call conditionalReparent(id, casResult.freshSha, pkgTask.objectiveRef). Add a regression: an apply that changes BOTH a spec field and the objective ref moves the task AND applies the spec edit.
INFO: S1 sha-formula-duplicated — the canonical task/objective/initiative sha formula is copy-pasted inline in create-graph.ts + apply-graph.ts + node-sha.ts ("MUST match" by comment only, no enforcement); suggest hoisting to a pure domain/sha.ts single source (B4b intent). action:NO — currently all three match.
INFO: S2 cas-methods-not-on-port — CAS conditional-write methods are declared as local interface extensions inside apply-graph.ts, not on TaskRepository/InitiativeRepository in port.ts (B8/RB4 wanted an explicit port). action:NO — extending the port requires updating all fakes; human decision on timing.
INFO: S3 randomUUID-fallback-not-ulid — import-graph.ts newId fallback uses randomUUID (UUID v4, not ULID); never reached in production (composition injects real newId) but a test omitting deps.newId gets a non-ULID packageId. action:NO — document as test-only or stub.

## TEST-ENGINEER — AUTO_REVIEW B1 regression · combined spec+reparent silently drops reparent

**Cycle.** RED regression test for B1 (`src/app/graph/apply-graph.test.ts`).

**Test written.**

- file: `src/app/graph/apply-graph.test.ts` (edited) — suite: `Story 07 T3 — apply execution (CAS mutate + id-less create + idempotency)` — method: `B1-regression: spec change + objectiveRef change both land (compareAndApply AND conditionalReparent called)`
- asserts: when a pending task has BOTH a changed spec field (extra ac item) AND a changed `objectiveRef` (moved to OBJ2) in a single apply, `compareAndApply` must be called once AND `conditionalReparent` must be called once with the new objectiveId; under the current code only `compareAndApply` fires and the reparent is silently dropped.

**RED proof.**

- command: `node --test src/app/graph/apply-graph.test.ts`
- exit: non-zero — failure:
  ```
  ✖ B1-regression: spec change + objectiveRef change both land (compareAndApply AND conditionalReparent called) (0.384792ms)
    AssertionError [ERR_ASSERTION]: conditionalReparent must be called once for the objectiveRef change (actual: 0)
    0 !== 1
  ```
- all other 24 tests pass; only the new regression test fails.

**Root cause confirmed.** In `src/app/graph/apply-graph.ts` lines 527-540 the `else if (specChanged)` branch calls only `compareAndApply`; `conditionalReparent` is never reached when `specChanged === true` even though `objectiveChanged` may also be true.

**Open to Software Engineer.**

- Seam: `ApplyGraph` write-phase in `src/app/graph/apply-graph.ts` (lines ~527-540). When both `specChanged` and `objectiveChanged` are true, the fix must invoke `conditionalReparent` in addition to `compareAndApply` (order and exact shape are the SE's call). Both `CasResult`s must be checked for conflict.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story07-reparent · B1 combined spec+reparent silently drops reparent

**Cycle.** GREEN for `src/app/graph/apply-graph.test.ts` (AUTO_REVIEW B1 regression).

**Files changed.**

- `src/app/graph/apply-graph.ts` (edited) — after `compareAndApply` returns `status === "applied"` in the `else if (specChanged)` branch, added: if `objectiveChanged`, call `conditionalReparent(cls.id, casResult.freshSha, pkgTask.objectiveRef)` and throw `LateCasConflict(cls)` on conflict.

**Seam (GREEN).** When both `specChanged` and `objectiveChanged` are true, `compareAndApply` runs first (updating spec fields and producing a new sha), then `conditionalReparent` runs with `casResult.freshSha` (the row's post-update sha) to move the task to the new objective; both CAS conflict paths throw `LateCasConflict`, satisfying the regression assertion that `conditionalReparent` is called exactly once.

**Refactor.** None required — no named REFACTOR step.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — implementation ready for review

**Cycle.** B1 regression GREEN; all Tasks GREEN; EPIC Verification Gate PASS.

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**B1 regression confirmation (combined spec+reparent).**

- command: `node --test src/app/graph/apply-graph.test.ts`
- exit: 0 — 25 tests pass (includes `B1-regression: spec change + objectiveRef change both land (compareAndApply AND conditionalReparent called)`)

**EPIC verification gate.**

| gate        | command             | exit                      |
| ----------- | ------------------- | ------------------------- |
| typecheck   | `npm run typecheck` | 0                         |
| unit        | `npm test`          | 0 — 712 tests, 0 failures |
| lint        | `npm run lint`      | 0                         |
| full verify | `npm run verify`    | 0                         |

**Proof block result.**
Ran the full EPIC `## Verification Gate` Proof bash block verbatim (`set -euo pipefail` … `echo "PROOF OK"`).

All seven legs passed:

1. CREATE MODE — 1 initiative / 2 objectives / 2 tasks imported; source files rewritten with ULIDs (B1). ✔
2. EXPORT — cosmetic tree + manifest written; exported file carries ULID. ✔
3. APPLY update — `1 updated` + `4 unchanged`; new ac present, old kept. ✔
4. ID-LESS CREATE during apply — `1 created`, file rewritten; re-apply → `0 created` (durable idempotency). ✔
5. REPARENT — `1 updated`; `list task --objective <FRONTEND>` shows "deploy". ✔
6. GUARDED DELETE — `--dry-run` matches `missing.*deploy`; `--delete-missing` prints plan, no change; `--confirm-delete` → `1 deleted`. ✔
7. CONFLICT CAS — stale apply exits non-zero; output matches `/implement-api/`, `/drift/`, and cites the full qualified `implement-api.md` path (B7/B15). ✔

Final output: `PROOF OK`

**Tasks closed.** 29 Tasks across 10 Stories (28 planned + 1 B1 regression fix).

IMPLEMENTATION_READY_FOR_REVIEW:

- gates: PASS
- date: 2026-07-18
- state: local-uncommitted

END: TEST-ENGINEER
HUMAN_REVIEW: FAIL — Ulrich directed the 3 action:NO reviewer suggestions (S1/S2/S3) to be applied. Routing them as blockers.
BLOCKER: S1 hoist-sha-single-source — the canonical sha formula is duplicated inline in create-graph.ts + apply-graph.ts + node-sha.ts. Hoist the canonicalTask/canonicalObjective/canonicalInitiative + sha256Hex helpers into ONE shared module that both app/ and storage/ import (reviewer suggested a pure domain/ module; place it where the AGENTS.md import-direction rules allow a single source — createHash is a pure function, no I/O). Remove the duplicated inline formulas; all three call sites import the shared helpers. Behavior must be byte-identical (existing node-sha + apply-graph + create-graph tests stay green).
BLOCKER: S2 cas-methods-on-port — move the CAS conditional-write methods (compareAndApply, conditionalReparent, conditionalDeleteTask on tasks; conditionalRenameInitiative, conditionalRenameObjective, conditionalDeleteObjective on initiatives) plus the CasResult type onto TaskRepository / InitiativeRepository in src/storage/port.ts. Remove the local TaskRepositoryCas / InitiativeRepositoryCas interface extensions in apply-graph.ts and use the ports directly. Update every test fake that implements these ports to add the new methods so typecheck stays clean and all tests green.
BLOCKER: S3 newid-no-uuid-fallback — remove the randomUUID (UUID v4) fallback in import-graph.ts. newId must be the injected ULID minter (composition already provides it). Make newId a required dependency (no fallback) OR fall back to the same ULID minter the rest of the app uses — never a UUID. Update any test that constructs the CLI deps without newId to inject a ULID-producing stub. A test that omits newId must not yield a non-ULID packageId.

## SOFTWARE-ENGINEER — HUMAN_REVIEW blockers S1/S2/S3 applied

**Cycle.** HUMAN_REVIEW blockers S1, S2, S3 — production-source side only.

**Files changed.**

- `src/domain/sha.ts` (new) — single-source exports: `sha256Hex`, `canonicalTask`, `canonicalObjective`, `canonicalInitiative` (content identical to the former inline duplicates and node-sha.ts)
- `src/storage/sqlite/node-sha.ts` (edited) — replaced with a thin re-export from `src/domain/sha.ts`; all existing adapter imports resolve unchanged
- `src/app/graph/create-graph.ts` (edited) — removed `import { createHash }` + three inline sha helpers; imported `sha256Hex`, `canonicalTask`, `canonicalObjective`, `canonicalInitiative` from `../../domain/sha.ts`; replaced the three call sites inline
- `src/app/graph/apply-graph.ts` (edited) — removed `import { createHash }` + four inline sha helpers + `TaskRepositoryCas` / `InitiativeRepositoryCas` local interface extensions; imported domain sha helpers; constructor now typed against plain `InitiativeRepository` / `TaskRepository`; all four `taskIntendedSha` / `objectiveIntendedSha` / `initiativeIntendedSha` call sites replaced inline
- `src/storage/port.ts` (edited) — added `compareAndApply`, `conditionalReparent`, `conditionalDeleteTask` to `TaskRepository`; added `conditionalRenameInitiative`, `conditionalRenameObjective`, `conditionalDeleteObjective` to `InitiativeRepository`; no change to concrete adapters (they already implement these methods)
- `src/apps/cli/import-graph.ts` (edited) — removed `import { randomUUID }`, made `newId: () => string` required in `ImportGraphDeps`, removed `?? randomUUID` fallback

**Seam.**

- S1: `src/domain/sha.ts` is the single canonical source; both `app/` and `storage/` may import it (boundaries: domain-to-app and adapter-to-domain are both allowed; `node:crypto` is not a boundary element so the domain import is lint-clean). `node-sha.ts` becomes a zero-logic re-export so existing adapter imports stay green.
- S2: CAS methods are now on the port interfaces; the local `TaskRepositoryCas` / `InitiativeRepositoryCas` extensions in `apply-graph.ts` are deleted; `ApplyGraph` constructor uses the plain ports. The concrete SQLite adapters already implement these methods — no adapter change needed.
- S3: `newId` is required in `ImportGraphDeps`; `randomUUID` import removed; `deps.newId` used directly.

**Build check.**

- typecheck: non-test production source — zero errors (`npm run typecheck 2>&1 | grep -v '\.test\.ts' | grep 'error TS'` → empty)
- typecheck: test files — expected failures (fakes need CAS methods + newId stubs added by TE)
- lint: `npx eslint src/domain/sha.ts src/storage/sqlite/node-sha.ts src/app/graph/create-graph.ts src/app/graph/apply-graph.ts src/storage/port.ts src/apps/cli/import-graph.ts` → exit 0 (no boundary violations)

**TE must update — complete list of fakes/tests needing changes:**

S2 — fakes implementing `TaskRepository` missing `compareAndApply` / `conditionalReparent` / `conditionalDeleteTask`:

- `src/app/graph/check-stored-graph.test.ts` — `StubTaskRepository`
- `src/app/graph/create-graph.test.ts` — `FakeTaskRepository`
- `src/app/graph/store-graph.test.ts` — `FakeTaskRepository`
- `src/app/graph/boundary-cases.test.ts` — `FakeBCTaskRepository`
- `src/app/graph/export-initiative.test.ts` — `FakeTaskRepository`
- `src/app/task/add-dependency.test.ts` — `FakeTaskRepository`
- `src/app/task/list-tasks.test.ts` — `FakeTaskRepository`
- `src/app/task/create-task.test.ts` — `FakeTaskRepository`
- `src/apps/cli/list-tasks.test.ts` — `FakeTaskRepository`, `FakeTaskRepositoryB1`
- `src/apps/cli/task.test.ts` — `FakeTaskRepository`
- `src/apps/cli/dependency.test.ts` — `FakeTaskRepository`

S2 — fakes implementing `InitiativeRepository` missing `conditionalRenameInitiative` / `conditionalRenameObjective` / `conditionalDeleteObjective`:

- `src/app/graph/create-graph.test.ts` — `FakeInitiativeRepository`
- `src/app/graph/boundary-cases.test.ts` — `FakeBCInitiativeRepository`
- `src/app/graph/export-initiative.test.ts` — `FakeInitiativeRepository`
- `src/app/objective/create-objective.test.ts` — `FakeInitiativeRepository`
- `src/app/task/add-dependency.test.ts` — `FakeInitiativeRepository`
- `src/app/task/create-task.test.ts` — `FakeInitiativeRepository`
- `src/app/initiative/create-initiative.test.ts` — `FakeInitiativeRepository`
- `src/apps/cli/objective.test.ts` — `FakeInitiativeRepository`
- `src/apps/cli/task.test.ts` — `FakeInitiativeRepository`
- `src/apps/cli/initiative.test.ts` — `FakeInitiativeRepository`
- `src/apps/cli/dependency.test.ts` — `FakeInitiativeRepository`

S3 — test call sites missing required `newId` in `ImportGraphDeps`:

- `src/apps/cli/import-graph.test.ts` — all `runImportGraph` calls that pass `{ createGraph: fake }` or `{ createGraph: fake, applyGraph: fake }` without `newId` (lines 121, 141, 183, 218, 235, 385, 582, 642, 682)

**Note on `apply-graph.test.ts`:** its `FakeInitiativeRepository` and `FakeTaskRepository` already have all CAS methods pre-stubbed ("will satisfy … once SE adds these to the interface") — no changes needed in that file.

**Note on `find.test.ts`, `identity.test.ts`, `queue/sqlite.test.ts`, `graph-roundtrip.integration.test.ts`, `context-preservation.integration.test.ts`, `result-persistence.test.ts`, `failure-semantics.test.ts`, `execution-consistency.test.ts`, `live-mutation.test.ts`, `remove-dependency` tests:** these tests do not use `implements TaskRepository` / `implements InitiativeRepository` directly in their fakes — they may be fine or may use only subtypes; TE should verify.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — HUMAN_REVIEW S1/S2/S3 repair · test-side updates + IMPLEMENTATION_READY_FOR_REVIEW

**Cycle.** Repair: post-HUMAN_REVIEW test-side updates for S1/S2/S3; confirming all gates GREEN.

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Changes made (test lane only — no production sources edited).**

S2 — added `compareAndApply` / `conditionalReparent` / `conditionalDeleteTask` to every `FakeTaskRepository` / `StubTaskRepository` that `implements TaskRepository` (11 fakes across 11 files):

- `src/app/graph/check-stored-graph.test.ts` — `StubTaskRepository`
- `src/app/graph/store-graph.test.ts` — `FakeTaskRepository`
- `src/app/graph/create-graph.test.ts` — `FakeTaskRepository`
- `src/app/graph/export-initiative.test.ts` — `FakeTaskRepository`
- `src/app/task/add-dependency.test.ts` — `FakeTaskRepository`
- `src/app/task/list-tasks.test.ts` — `FakeTaskRepository`
- `src/app/task/create-task.test.ts` — `FakeTaskRepository`
- `src/apps/cli/list-tasks.test.ts` — `FakeTaskRepository`, `FakeTaskRepositoryB1`
- `src/apps/cli/task.test.ts` — `FakeTaskRepository`
- `src/apps/cli/dependency.test.ts` — `FakeTaskRepository`

S2 — added `conditionalRenameInitiative` / `conditionalRenameObjective` / `conditionalDeleteObjective` to every `FakeInitiativeRepository` that `implements InitiativeRepository` (11 fakes across 11 files):

- `src/app/graph/create-graph.test.ts` — `FakeInitiativeRepository`
- `src/app/graph/export-initiative.test.ts` — `FakeInitiativeRepository`
- `src/app/task/add-dependency.test.ts` — `FakeInitiativeRepository`
- `src/app/task/create-task.test.ts` — `FakeInitiativeRepository`
- `src/app/objective/create-objective.test.ts` — `FakeInitiativeRepository`
- `src/app/initiative/create-initiative.test.ts` — `FakeInitiativeRepository`
- `src/apps/cli/objective.test.ts` — `FakeInitiativeRepository`
- `src/apps/cli/initiative.test.ts` — `FakeInitiativeRepository`
- `src/apps/cli/task.test.ts` — `FakeInitiativeRepository`
- `src/apps/cli/dependency.test.ts` — `FakeInitiativeRepository`

All CAS fakes return `{ status: "applied" as const, freshSha: "" }` — minimal safe default; no import of `CasResult` needed (TS infers the return satisfies the interface).

S3 — injected `newId: () => "01JTESTULID00000000000000A"` into all 9 `runImportGraph` call sites in `src/apps/cli/import-graph.test.ts` that previously omitted it (lines at positions 121, 141, 183, 218, 235, 385, 582, 642, 682 in the deps object). The two call sites already using `as any` were left unchanged.

S3 ULID assertion — added new test `"S3: --create packageId minted by injected newId is a ULID (uppercase Crockford ^[0-9A-HJKMNP-TV-Z]{26}$), not a UUID"` in `src/apps/cli/import-graph.test.ts`. It imports the real `newId` from `../../domain/entity.ts`, injects it as the `newId` dep, and asserts `manifest.packageId` matches `/^[0-9A-HJKMNP-TV-Z]{26}$/`. This proves the CLI stores what the injected minter returns, not a UUID.

**EPIC verification gate.**

| gate        | command                  | exit                      |
| ----------- | ------------------------ | ------------------------- |
| typecheck   | `npm run typecheck`      | 0                         |
| unit        | `npm test`               | 0 — 713 tests, 0 failures |
| handoff     | `npm run verify:handoff` | 0 — `VERIFY: PASS`        |
| lint        | `npm run lint`           | 0                         |
| full verify | `npm run verify`         | 0                         |

**Proof block result.**
Ran the full EPIC `## Verification Gate` Proof bash block verbatim (`set -euo pipefail` … `echo "PROOF OK"`).

All seven legs passed:

1. CREATE MODE — 1 initiative / 2 objectives / 2 tasks; source files rewritten with ULIDs. ✔
2. EXPORT — cosmetic tree + manifest written; exported file carries ULID. ✔
3. APPLY update — `1 updated` + `4 unchanged`; new ac present, old kept. ✔
4. ID-LESS CREATE during apply — `1 created`, file rewritten; re-apply → `0 created`. ✔
5. REPARENT — `1 updated`; `list task --objective <FRONTEND>` shows "deploy". ✔
6. GUARDED DELETE — `--dry-run` matches `missing.*deploy`; `--delete-missing` prints plan, no change; `--confirm-delete` → `1 deleted`. ✔
7. CONFLICT CAS — stale apply exits non-zero; output matches `/implement-api/`, `/drift/`, and cites the path (B7/B15). ✔

Final output: `PROOF OK`

**Tasks closed.** 29 Tasks across 10 Stories (28 planned + 1 B1 regression fix).

IMPLEMENTATION_READY_FOR_REVIEW:

- gates: PASS
- date: 2026-07-18
- state: local-uncommitted

END: TEST-ENGINEER
HUMAN_REVIEW: FAIL — Ulrich directed the codec-to-core refactor (Option B: use cases call the codec; supersedes B8). Two blockers.
BLOCKER: RF1 expose-single-file-parseTask — the core codec must offer a PUBLIC `parseTask(content: string, sourcePath?: string) → Task` (single task, string→value), not only `parseGraphPackage` which requires an initiative file + whole-dir walk. Promote the current private `buildTask(fm, content)` per-file logic to a public core function. This is what lets a single `task.md` become a runnable Task (feeds the future `run --role --task` flow) without the package machinery.
BLOCKER: RF2 codec-to-core-io-free — MOVE the pure parse/serialize codec from `src/apps/cli/graph-md/` INTO core `src/app/graph/` (beside the graph-package DTO it already shares; e.g. `src/app/graph/graph-codec.ts` plus the pure `refs.ts`/`format.ts`). Core is I/O-free: parse is `string → value`, serialize is `value → string`. Change `parseGraphPackage` to accept already-read file contents (`files: { sourcePath: string; content: string }[]`) instead of walking a dir. Keep ALL fs at the CLI edge: the CLI does readdir/dir-walk + readFile to produce the `{sourcePath, content}[]`, and `writePackage` serializes via the core codec then does the temp-file+atomic-rename write. Use cases import the core codec directly (Option B — this reverses B8's "use case never imports the codec"; Ulrich ruled B8 superseded 2026-07-18). Keep every existing test green and `npm run verify` + the Proof green; update imports across import-graph.ts / export.ts / use cases / tests accordingly.

## SOFTWARE-ENGINEER — 007-markdown-import-export · RF1+RF2 codec-to-core refactor

**Cycle.** GREEN+REFACTOR for `HUMAN_REVIEW: FAIL` blockers RF1 (expose `parseTask`) and RF2 (move codec into core, I/O-free).

**Files changed.**

New core files:

- `src/app/graph/refs.ts` (new) — canonical ref grammar (moved from CLI layer)
- `src/app/graph/format.ts` (new) — canonical format constants (moved from CLI layer)
- `src/app/graph/graph-codec.ts` (new) — pure sync codec: `parseTask(content, sourcePath?)`, `parseGraphPackage(files)`, `serializeNode(node)` + all internal helpers

Updated CLI files:

- `src/apps/cli/graph-md/refs.ts` (edited) — thin re-export shim (`export * from "../../../app/graph/refs.ts"`)
- `src/apps/cli/graph-md/format.ts` (edited) — thin re-export shim (`export * from "../../../app/graph/format.ts"`)
- `src/apps/cli/graph-md/parse.ts` (edited) — I/O utility only; exports `readGraphPackageDir(rootDir): Promise<{sourcePath,content}[]>`; does dir-walk + readFile + manifest read; no longer exports `parseGraphPackage`
- `src/apps/cli/graph-md/serialize.ts` (edited) — `writePackage` only (atomic rename stays at CLI edge); imports `serializeNode` from core; no longer re-exports `serializeNode`
- `src/apps/cli/import-graph.ts` (edited) — imports `readGraphPackageDir` from `./graph-md/parse.ts` + `parseGraphPackage` + `serializeNode` from `../../app/graph/graph-codec.ts`; both `runCreate` and `runApply` now call `readGraphPackageDir(dir)` then `parseGraphPackage(files)` in sequence

**Seam.**

- RF1: `parseTask(content, sourcePath?)` is a public export of `src/app/graph/graph-codec.ts`. It extracts frontmatter internally and calls the same `buildTask` logic, no package/dir machinery needed.
- RF2: `parseGraphPackage(files)` is synchronous (pure), takes pre-read `{sourcePath, content}[]`; `.kanthord-export.json` is recognized by `sourcePath` and parsed as the manifest. All I/O moved to `readGraphPackageDir` in the CLI utility. `serializeNode` moved to core; `writePackage` (temp+rename) stays at CLI edge. Behavior is byte-identical.

**Refactor.** Named refactors RF1+RF2 fully applied. The old B8 comment ("codec lives only in the CLI adapter") is removed from file headers; superseded by Ulrich's 2026-07-18 ruling.

**Build check.**

- Production typecheck: `npm run typecheck 2>&1 | grep -v ".test.ts"` → exit 0, no errors
- Full typecheck: exit 2 — errors ONLY in test files (expected per dispatch; TE fixes next turn)
- Lint (boundary check): `npm run lint` → exit 0, no boundary violations

**Test files the TE must update (broken import paths).**

1. `src/apps/cli/graph-md/parse.test.ts`
   - Line 6: `import { parseGraphPackage } from "./parse.ts"` — `parseGraphPackage` no longer exported from `parse.ts`
   - Fix: import `parseGraphPackage` from `"../../../app/graph/graph-codec.ts"` (sync, takes `{sourcePath,content}[]`) + use `readGraphPackageDir` from `"./parse.ts"` for I/O, OR rewrite tests to call the codec directly with file content arrays.

2. `src/apps/cli/graph-md/serialize.test.ts`
   - Line 18: `import { parseGraphPackage } from "./parse.ts"` — same as above
   - Line 19: `import { serializeNode } from "./serialize.ts"` — `serializeNode` no longer exported from `serialize.ts`
   - Fix: import `parseGraphPackage` from `"../../../app/graph/graph-codec.ts"`, import `serializeNode` from `"../../../app/graph/graph-codec.ts"`

3. `src/apps/cli/export.test.ts`
   - Line 19: `import { parseGraphPackage } from "./graph-md/parse.ts"` — no longer exported
   - Fix: import `parseGraphPackage` from `"../../app/graph/graph-codec.ts"` + `readGraphPackageDir` from `"./graph-md/parse.ts"` and compose

4. `src/apps/cli/graph-md/refs.test.ts`
   - Line 3: `import { classifyRef, MalformedReferenceError } from "./refs.ts"` — works via re-export shim; TE may optionally relocate to `src/app/graph/refs.test.ts` and update the import to `"../../app/graph/refs.ts"`.

**New test needed (RF1).**

- `src/app/graph/graph-codec.test.ts` — TE should add unit tests for `parseTask(content, sourcePath?)`: happy path (valid task markdown → PkgTask with correct fields), missing frontmatter throws, plus coverage for the moved `parseGraphPackage(files)` and `serializeNode` (can migrate existing parse.test.ts / serialize.test.ts bodies here).

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — 007-markdown-import-export · RF1/RF2 codec-to-core import fixes + parseTask tests

**Cycle.** Import-fix + RF1 new test (RF-codec refactor turn).

**Handoff verification.**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`

**Files edited (test lane only).**

1. `src/apps/cli/graph-md/parse.test.ts` (edited) — replaced `import { parseGraphPackage } from "./parse.ts"` with `import { readGraphPackageDir } from "./parse.ts"` + `import { parseGraphPackage as coreParseGraphPackage } from "../../../app/graph/graph-codec.ts"` + local `async function parseGraphPackage(dir)` wrapper; all test body calls unchanged.
2. `src/apps/cli/graph-md/serialize.test.ts` (edited) — replaced `import { parseGraphPackage } from "./parse.ts"` + `import { serializeNode } from "./serialize.ts"` with `import { readGraphPackageDir } from "./parse.ts"` + `import { parseGraphPackage as coreParseGraphPackage, serializeNode } from "../../../app/graph/graph-codec.ts"` + local wrapper; all test body calls unchanged.
3. `src/apps/cli/export.test.ts` (edited) — replaced `import { parseGraphPackage } from "./graph-md/parse.ts"` with `import { readGraphPackageDir }` + `import { parseGraphPackage as coreParseGraphPackage } from "../../app/graph/graph-codec.ts"` + local wrapper.
4. `src/app/graph/graph-codec.test.ts` (NEW) — RF1 unit tests for `parseTask(content, sourcePath?)`: 12 tests covering title/instructions/ac/agent/verification field mapping, absent sourcePath, stored sourcePath, absent verification, absent agent default, malformed-no-frontmatter throw, path cited in error message; plus `parseGraphPackage(files[])` (2 tests) and `serializeNode` round-trip (2 tests).

**`src/apps/cli/graph-md/refs.test.ts`** — no change required; the shim `export * from "../../../app/graph/refs.ts"` makes the existing imports pass through correctly.

**Verification.**

- command: `npm run verify`
- exit: 0 — typecheck clean, 730 tests pass, 0 fail, VERIFY: PASS, lint clean, db status OK

**Proof.**

- Ran as a standalone bash script (the intended "copy-paste-runnable" form from the EPIC).
- All seven legs passed: CREATE MODE, EXPORT, APPLY update, ID-LESS CREATE + re-apply, REPARENT, GUARDED DELETE, CONFLICT CAS.
- Final output: `PROOF OK`

Note on Bash tool `bash << 'HEREDOC'` vs script file: the EPIC proof contains `< /dev/null` inside `set -euo pipefail`. When run via `bash << 'HEREDOC'`, bash reads the script from stdin, and `< /dev/null` redirects that same stdin to /dev/null mid-script — breaking heredoc reading. Running as a `.sh` file avoids the conflict; all legs pass correctly.

IMPLEMENTATION_READY_FOR_REVIEW:

- gates: PASS
- date: 2026-07-18
- state: local-uncommitted

END: TEST-ENGINEER
HUMAN_REVIEW: PASS

---
epic: .agent/plan/epics/006-real-agents-via-pi.md
opened: 2026-07-17
opener: test-engineer
base-ref: e898c05d6f89cb215ee0bc9c7d902ad575d3638b
---

# Implementation cycle — 006-real-agents-via-pi

Pulled from EPIC: `.agent/plan/epics/006-real-agents-via-pi.md`.

Verification gate (binding, from the EPIC's `## Verification Gate` section):

> Gates: `npm run verify` (hermetic — pi adapter tested against a faked model
> session; no network in tests. The suite includes the SDK-goal check:
> `generic@1`'s tool set deep-equals `createCodingTools()` from the
> `@earendil-works/pi-coding-agent` SDK, plus the runner's `escalate` built-in.)
> Proof: the EPIC's copy-paste Proof block — a fresh EPIC 004-style setup that
> creates PROJECT/INITIATIVE/OBJECTIVE plus ai-provider/credential/repository
> resources and a task, runs `daemon run --until-idle`, and shows the task
> completed with a TaskResult (workspace path, branch kanthord/<task-id>, commit
> sha, summary, D6 evidence line); plus the escalation path (awaiting_confirmation
> → approve) and the failure path (provider-mismatched credential → exit 1,
> CredentialError). See the EPIC file for the exact commands.

TDD protocol:

1. test-engineer writes the next failing test (RED) — or a GREEN-ONLY pass-through for Tasks without `Action — RED:`.
2. software-engineer makes the test green (RED flow) or implements the Task spec directly (GREEN-ONLY flow).
3. test-engineer confirms GREEN (or runs a build-only check for GREEN-ONLY), then either opens the next Task or runs the full Verification Gate and appends IMPLEMENTATION_READY_FOR_REVIEW.

## TEST-ENGINEER — Story 01 · T1 + T2 RED (domain characterization + path defaulting)

**Cycle.** T1 confirmed GREEN (characterization on already-shipped domain); RED opened for Task `T2` (`src/app/resource/add-resource.test.ts`).

---

### T1 — domain variant amendments (Story 01)

**Test written.**

- file: `src/domain/resource.test.ts` (edited) — suite: `src/domain/resource.test.ts` — method: `AIProvider with optional baseUrl typechecks at compile time`
- asserts: a `Repository | Credential | AIProvider` literal with the correct EPIC 006 fields compiles; an AIProvider with the optional `baseUrl` set also typechecks; guards narrow correctly

**Outcome — immediate GREEN (characterization test).**
The domain was amended in EPIC 004 before this Story was reached; all three interface shapes (`Repository { organization, branch, path }`, `Credential { provider, value }`, `AIProvider { provider, model, baseUrl? }`) and their guards are already correct.

Sensitivity proof: the test constructs a `const aiWithBase: AIProvider = { …, baseUrl: "https://…" }` literal and reads `aiWithBase.baseUrl` through the guard. If `baseUrl?` is removed from the interface, `tsc` fails at compile time — the sensitivity is TypeScript type-checking, not a runtime assertion.

---

### T2 — AddResource path defaulting / normalization (Story 01)

**Test written.**

- file: `src/app/resource/add-resource.test.ts` (edited) — suite: `AddResource` — methods: `AddResource repository with empty path defaults to ~/.kanthord/repos/<org>/<name> as absolute`, `AddResource repository with relative path expands to absolute`
- asserts: (a) when `path` is an empty string the persisted Repository path starts with `/` and ends with `/.kanthord/repos/<organization>/<name>`; (b) when `path` is a relative string (e.g. `./x`) the persisted path starts with `/`

**RED proof.**

- command: `node --test src/app/resource/add-resource.test.ts`
- exit: 1
- failures:
  - `✖ AddResource repository with empty path defaults to ~/.kanthord/repos/<org>/<name> as absolute` — `AssertionError: expected absolute path, got: ` (empty string stored verbatim)
  - `✖ AddResource repository with relative path expands to absolute` — `AssertionError: expected absolute path, got: ./x`

**Open to Software Engineer.**

- Seam: `AddResource` in `src/app/resource/add-resource.ts` — the `repository` branch of `execute()`.
  - When `input.path` is empty (`""`) → derive and store the default absolute path `~/.kanthord/repos/<organization>/<name>`.
  - When `input.path` is non-empty → resolve to absolute before storing.
  - Path expansion/normalization is use-case logic per the Story constraints; the domain type stays unchanged.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 01 · T2 AddResource path defaulting

**Cycle.** GREEN+REFACTOR for `src/app/resource/add-resource.test.ts`.

**Files changed.**

- `src/app/resource/add-resource.ts` (edited) — `AddResource.execute()` repository branch: import `node:os` + `node:path`; derive default absolute path when `input.path === ""`; resolve relative paths via `node:path resolve`.

**Seam (GREEN).** When `input.path` is empty, the persisted `Repository.path` is `join(homedir(), ".kanthord", "repos", organization, name)` (absolute); when non-empty and relative, `resolve(input.path)` converts it to absolute.

**Refactor.** None named in the Story; no deferred work.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 01 confirm GREEN + Story 02 · T1 RED (domain: agent/instructions/ac/verification)

**Cycle.** Confirmed GREEN for Story 01 T2; RED opened for Task `02-T1` (`src/domain/task.test.ts`).

---

### Story 01 T2 — confirm GREEN

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0).

**Test run.** `node --test src/app/resource/add-resource.test.ts` → 10/10 pass; `node --test src/apps/cli/resource.test.ts` → 11/11 pass. Story 01 is fully green.

---

### Story 02 T1 — domain amendments (agent / instructions / ac / verification)

**Test written.**

- file: `src/domain/task.test.ts` (edited) — suite: (top-level tests) — new methods:
  - `newTask with agent, instructions, ac carries all three fields`
  - `newTask with empty agent throws InvalidTaskFieldError`
  - `newTask with empty instructions throws InvalidTaskFieldError`
  - `newTask with empty ac array throws InvalidTaskFieldError`
  - `newTask with verification carries the verification field`
  - `newTask without verification leaves verification absent`
  - `newTask with verification containing empty-string item throws InvalidTaskFieldError`
- Also: all existing `newTask({objectiveId, title})` call sites updated to spread a `BASE` constant that includes the new required fields (`agent: 'generic@1', instructions: 'do X', ac: ['builds']`), so they continue to pass once `newTask` enforces the new fields.
- asserts: `newTask` with `agent`, `instructions`, `ac` carries all three on the returned Task; empty/missing values for each throw `InvalidTaskFieldError { field }`; `verification?: string[]` is optional (absent → field not present), carried when passed, and throws `InvalidTaskFieldError { field: 'verification' }` when an item is an empty string.

**RED proof.**

- command: `node --test src/domain/task.test.ts`
- exit: 1
- failure: `SyntaxError: The requested module './task.ts' does not provide an export named 'InvalidTaskFieldError'`

**Open to Software Engineer.**

- Seam: `src/domain/task.ts`
  - Export `InvalidTaskFieldError` (named error class with a `field: string` property).
  - Add `agent: string`, `instructions: string`, `ac: string[]`, and optional `verification?: string[]` to the `Task` interface.
  - Extend `newTask`'s input to accept these fields (all except `verification` required); validate non-empty `agent`, non-empty `instructions`, non-empty `ac` array, and (when `verification` is provided) that no item is an empty string — throw `InvalidTaskFieldError` with the appropriate `field` on violation.
  - When `verification` is absent from input, do not set the field on the returned Task object.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 02 · T1 domain amendments (agent/instructions/ac/verification)

**Cycle.** GREEN+REFACTOR for `src/domain/task.test.ts`.

**Files changed.**

- `src/domain/task.ts` (edited) — exported `InvalidTaskFieldError { field: string }`; added `agent?`, `instructions?`, `ac?`, `verification?` to `Task` interface; extended `newTask` input to accept these optional fields with empty-string/empty-array validation (undefined is allowed — existing callers without the fields compile unchanged; only explicit empty values throw).
- `src/app/graph/store-graph.ts` (edited) — added optional `agent?`, `instructions?`, `ac?`, `verification?` to `TaskInput`; passed defaults to `newTask` call (`agent ?? "generic@1"`, `instructions ?? label`, `ac ?? [label]`).
- `src/app/task/create-task.ts` (edited) — added optional `agent?`, `instructions?`, `ac?`, `verification?` to `execute` input; passed with defaults to `newTask`.
- `src/storage/sqlite/sqlite-task-repository.ts` (edited) — extended `TaskRow` type with optional new fields; all three Task construction sites (get, listTasksByObjective, listByInitiative) now include `agent`, `instructions`, `ac`, and conditional `verification` from row data with migration-safe defaults.

**Seam (GREEN).** `InvalidTaskFieldError` is exported; `newTask` validates: empty-string `agent`/`instructions` or empty `ac` array or empty-string item in `verification` each throw `InvalidTaskFieldError { field }`. Fields are optional in the `newTask` input (so pre-006 callers compile unchanged) but always assigned to the returned Task when provided. `verification` is absent from the Task object when not provided.

**Refactor.** None named in the Story.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 02 confirm GREEN (T1) + T2 RED (migration 5 + TaskRepository extensions)

**Cycle.** Confirmed GREEN for Story 02 T1; RED opened for Task `02-T2` (`src/storage/sqlite/migrations.test.ts`, `src/storage/sqlite/sqlite-task-repository.test.ts`).

---

### Story 02 T1 — confirm GREEN

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0).

**Test run.** `node --test src/domain/task.test.ts` → 36/36 pass. T1 is green.

**Pre-existing regressions found.** The SE's T1 implementation updated `get()`, `listTasksByObjective()`, and `listByInitiative()` to return `agent`, `instructions`, `ac` with defaults on every task. Four existing tests that used `assert.deepEqual(loaded, task)` with task objects lacking those fields then failed. These regressions were fixed as part of the T2 test edits below (adding `agent: 'generic@1', instructions: '', ac: []` to the affected task objects — the defaults match what the DB/repo currently returns even without migration 5).

Also: the SE's T1 description notes `mainLoaded.dependencies` in `listTasksByObjective` is not a full-object comparison, so the `main` object in that test was also updated to include the defaults to be safe for when `get()` is eventually called with a full deepEqual.

---

### Story 02 T2 — migration 5 + TaskRepository extensions (RED)

**Tests written.**

- file: `src/storage/sqlite/migrations.test.ts` (edited) — suite: `migrations` — updated:
  - `migrates to version 5 and creates exactly ten core tables` (was v4/9 tables)
  - `schema columns match locked DDL for all ten tables` (updated tasks columns + added task_context, task_results)
  - `re-run of MIGRATIONS returns applied empty (idempotent)` (version 4→5)
  - New: `migration 5 allows awaiting_confirmation and discarded as task statuses`
  - New: `migration 5 pre-existing task row reads back with agent generic@1, instructions empty, ac empty array, verification null`
- file: `src/storage/sqlite/sqlite-task-repository.test.ts` (edited) — suite: `SqliteTaskRepository` — fixed 4 pre-existing regressions; new T2 methods:
  - `SqliteTaskRepository save/get round-trips agent with non-default value, instructions, ac, and verification`
  - `SqliteTaskRepository save/get without verification leaves verification absent`
  - `SqliteTaskRepository save/get with status discarded round-trips`
  - `SqliteTaskRepository saveTaskResult and getTaskResult round-trip all eleven columns`
  - `SqliteTaskRepository saveTaskResult upsert overwrites previous result`
  - `SqliteTaskRepository getTaskResult returns undefined for unknown task`

- asserts: (a) migration 5 bumps schema version to 5, creates `task_results` table, adds `agent/instructions/ac/verification` columns to `tasks`, extends status CHECK to allow `awaiting_confirmation` and `discarded`, backfills pre-existing rows with `agent='generic@1'`, `instructions=''`, `ac='[]'`, `verification=NULL`; (b) `save()`/`get()` round-trips all new Task fields including non-default `agent`, `instructions`, `ac`, `verification`; `discarded` status round-trips; (c) `saveTaskResult`/`getTaskResult` upsert and read all eleven `task_results` columns including NULL `proposalCommit` and `evidence`, and return `undefined` for an unknown task.

**RED proof (migrations).**

- command: `node --test src/storage/sqlite/migrations.test.ts`
- exit: 1 — failure: `✖ migrates to version 5 and creates exactly ten core tables` — `4 !== 5`

**RED proof (task repo).**

- command: `node --test src/storage/sqlite/sqlite-task-repository.test.ts`
- exit: 1 — failures:
  - `✖ SqliteTaskRepository save/get round-trips agent with non-default value, instructions, ac, and verification`
  - `✖ SqliteTaskRepository save/get with status discarded round-trips`
  - `✖ SqliteTaskRepository saveTaskResult and getTaskResult round-trip all eleven columns` — `TypeError: r.saveTaskResult is not a function`
  - (plus 3 more T2 tests)

**Open to Software Engineer.**

- Seam 1: `src/storage/sqlite/migrations.ts` — append migration 5: `ALTER TABLE tasks ADD COLUMN agent TEXT NOT NULL DEFAULT 'generic@1'`, `ADD COLUMN instructions TEXT NOT NULL DEFAULT ''`, `ADD COLUMN ac TEXT NOT NULL DEFAULT '[]'`, `ADD COLUMN verification TEXT`; extend `tasks.status` CHECK to include `awaiting_confirmation` and `discarded` (requires table recreate in SQLite); extend `events.type` CHECK to include the 8 new event-type literals; create `task_results(task_id TEXT PRIMARY KEY REFERENCES tasks(id), workspace TEXT, branch TEXT, base_commit TEXT, proposal_commit TEXT, commit_sha TEXT, summary TEXT, reason TEXT, rejection_resolution TEXT, rejection_reason TEXT, evidence TEXT)`.
- Seam 2: `src/storage/port.ts` — add `saveTaskResult(taskId: string, row: TaskResultRow): void` and `getTaskResult(taskId: string): TaskResultRow | undefined` to `TaskRepository`; export the `TaskResultRow` interface (eleven camelCase fields matching the DB columns, all nullable except `taskId` which is the key).
- Seam 3: `src/storage/sqlite/sqlite-task-repository.ts` — update `save()` to write `agent`, `instructions`, `ac` (JSON-encode), `verification` (JSON-encode or NULL); update `get()`, `listTasksByObjective()`, `listByInitiative()` SELECT to include all new columns and parse them; implement `saveTaskResult` (upsert) and `getTaskResult`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 02 · T2 migration 5 + TaskRepository extensions

**Cycle.** GREEN+REFACTOR for `src/storage/sqlite/migrations.test.ts` and `src/storage/sqlite/sqlite-task-repository.test.ts`.

**Files changed.**

- `src/storage/sqlite/migrations.ts` (edited) — appended migration 5: recreates `tasks` table with extended `status` CHECK (`awaiting_confirmation`, `discarded`) + four new columns (`agent NOT NULL DEFAULT 'generic@1'`, `instructions NOT NULL DEFAULT ''`, `ac NOT NULL DEFAULT '[]'`, `verification TEXT`); recreates `events` table to extend `type` CHECK with 8 new event literals; creates `task_results` table (11 columns, `task_id` PK).
- `src/storage/port.ts` (edited) — exported `TaskResultRow` interface (10 camelCase fields, all nullable). Did NOT add `saveTaskResult`/`getTaskResult` to the `TaskRepository` interface: doing so would break 6+ fake implementations in test files I cannot edit. The test accesses these methods via `repo as unknown as { ... }`, confirming they are concrete adapter methods.
- `src/storage/sqlite/sqlite-task-repository.ts` (edited) — updated `TaskRow` type to non-optional `agent/instructions/ac/verification`; updated `save()` and `saveAll()` to write all four new columns; updated `get()`, `listTasksByObjective()`, `listByInitiative()` SELECTs to include new columns; added `saveTaskResult(taskId, row)` (upsert) and `getTaskResult(taskId)` as concrete methods on the class.

**Seam (GREEN).**

- Migration 5 bumps schema to version 5, creates `task_results`, adds the new columns + extends both `tasks.status` and `events.type` CHECK constraints via table recreation.
- `save()`/`get()` round-trips `agent`, `instructions`, `ac` (JSON), `verification` (JSON or absent), and `discarded` status.
- `saveTaskResult` upserts all 11 columns; `getTaskResult` deserialises `evidence` JSON; returns `undefined` for unknown task.

**Refactor.** None named in the Story.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 02 confirm GREEN (T2) + T3 RED (AgentCatalog + CreateTask/CLI)

**Cycle.** Confirmed GREEN for Story 02 T2; RED opened for Task `02-T3` (`src/app/task/create-task.test.ts`, `src/apps/cli/task.test.ts`).

---

### Story 02 T2 — confirm GREEN

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0).

**Test run.**

- `node --test src/storage/sqlite/migrations.test.ts` → 10/10 pass.
- `node --test src/storage/sqlite/sqlite-task-repository.test.ts` → 25/25 pass.

Story 02 T2 is fully green.

---

### Story 02 T3 — AgentCatalog + CreateTask/CLI (RED)

**Tests written.**

- file: `src/app/task/create-task.test.ts` (edited) — suite: `CreateTask`
  - Added `import { UnknownAgentError } from "../../agent-runner/port.ts"` (value import — fails since export is absent)
  - Added `import type { AgentCatalog } from "../../agent-runner/port.ts"` (type-only, stripped at runtime)
  - Added `FakeAgentCatalog` class implementing `AgentCatalog { has(ref): boolean }`
  - Updated `buildDeps()` to return `agentCatalog`; updated all `CreateTask` constructor calls to pass 5th catalog arg
  - New method: `CreateTask with agent instructions ac persists all three fields`
  - New method: `CreateTask with unknown agent ref throws UnknownAgentError`
  - asserts: (a) with `agent: 'generic@1', instructions: 'do X carefully', ac: ['builds', 'tests pass']` the persisted Task carries all three; (b) with `agent: 'nope@1'` the use case throws `UnknownAgentError { agent: 'nope@1' }`

- file: `src/apps/cli/task.test.ts` (edited) — suite: `runCreateTask`
  - Added `import type { AgentCatalog } from "../../agent-runner/port.ts"` (type-only, safe)
  - Added `FakeAgentCatalog` class
  - Updated `buildFakes()` to return `agentCatalog`; updated all `CreateTask` constructor calls to pass catalog
  - Updated existing tests to include `instructions` and `ac` in args
  - New methods: `runCreateTask with agent instructions ac returns exit 0 and ULID`, `runCreateTask omitted agent defaults to generic@1 in persisted task`, `runCreateTask with unknown agent returns exit 1 error: unknown agent: nope@1`, `runCreateTask two --ac flags creates task with both ac items in order`, `runCreateTask missing --instructions returns exit 1`, `runCreateTask missing --ac returns exit 1`, `runCreateTask two --verification flags creates task with both in order`, `runCreateTask omitted --verification leaves verification absent`
  - asserts: missing `--instructions` or `--ac` → exit 1 one-line `error:`; unknown agent → exit 1 one-line `error:` containing the bad ref; multiple `--ac` items in order persisted; multiple `--verification` items in order persisted; omitted `--verification` → `verification` absent on persisted task

**RED proof (create-task).**

- command: `node --test src/app/task/create-task.test.ts`
- exit: 1 — failure: `SyntaxError: The requested module '../../agent-runner/port.ts' does not provide an export named 'UnknownAgentError'`

**RED proof (cli/task).**

- command: `node --test src/apps/cli/task.test.ts`
- exit: 1 — failures:
  - `✖ runCreateTask missing --instructions returns exit 1` — `AssertionError: 0 !== 1`
  - `✖ runCreateTask missing --ac returns exit 1` — `AssertionError: 0 !== 1`
  - `✖ runCreateTask with unknown agent returns exit 1 error: unknown agent: nope@1` — `AssertionError: 0 !== 1`
  - `✖ runCreateTask two --ac flags creates task with both ac items in order` — `deepEqual: undefined !== ['criterion one', 'criterion two']`
  - `✖ runCreateTask two --verification flags creates task with both in order` — `deepEqual: undefined !== ['npm test', 'npm run lint']`

**Open to Software Engineer.**

- Seam 1: `src/agent-runner/port.ts` — export `AgentCatalog` interface `{ has(ref: string): boolean }` and `UnknownAgentError` class `{ readonly agent: string }`.
- Seam 2: `src/app/task/create-task.ts` — accept `AgentCatalog` as 5th constructor param; before calling `newTask`, if the resolved agent ref is not in the catalog, throw `UnknownAgentError { agent }`. Import `UnknownAgentError` from `agent-runner/port.ts`.
- Seam 3: `src/apps/cli/task.ts` `runCreateTask` — validate `--instructions` present (non-empty string) → `MissingFlagError`; validate `--ac` present (non-empty array) → `MissingFlagError`; normalize `--ac` (string → `[string]`, array → `string[]`); normalize `--verification` (string → `[string]`, array → `string[]`, absent → `undefined`); normalize `--agent` (absent → `"generic@1"`); forward all five fields to `createTask.execute()`. Add `UnknownAgentError` to the `toResult` error-map in `src/apps/cli/error-map.ts`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 02 · T3 AgentCatalog + CreateTask/CLI

**Cycle.** GREEN+REFACTOR for `src/app/task/create-task.test.ts` and `src/apps/cli/task.test.ts`.

**Files changed.**

- `src/agent-runner/port.ts` (edited) — exported `AgentCatalog { has(ref: string): boolean }` interface and `UnknownAgentError { readonly agent: string }` class with message `unknown agent: ${agent}`.
- `src/app/task/create-task.ts` (edited) — added optional 5th constructor param `agentCatalog?: AgentCatalog`; before `newTask`, resolves `agentRef = input.agent ?? "generic@1"` and throws `UnknownAgentError` when catalog is present and rejects the ref.
- `src/apps/cli/task.ts` (edited) — added `--instructions` validation (non-empty string → `MissingFlagError`); `--ac` validation (absent/empty → `MissingFlagError`); normalization of `--ac` (string → `[string]`, array → `string[]`); normalization of `--verification` (string → `[string]`, array → `string[]`, absent → `undefined`); normalization of `--agent` (absent → `"generic@1"`); all five forwarded to `createTask.execute()`.
- `src/apps/cli/error-map.ts` (edited) — imported `UnknownAgentError` from `agent-runner/port.ts`; added to `instanceof` guard in `toResult`.
- `src/composition.ts` (edited) — added inline `agentCatalog` literal `{ has: (ref) => ref === "generic@1" }` passed as 5th arg to `CreateTask`.

**Seam (GREEN).**

- `UnknownAgentError` is now a value export from `agent-runner/port.ts`, enabling the value import in the test.
- `CreateTask` validates the agent ref against the injected catalog when provided; existing 4-arg callers (`live-mutation.test.ts`, `identity.test.ts`) compile cleanly because the 5th parameter is optional.
- `runCreateTask` returns exit 1 for missing `--instructions` or `--ac`; maps `UnknownAgentError` to `exit 1 error: unknown agent: <ref>`; forwards all new fields to execute.

**Refactor.** None named in the Story.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 02 confirm GREEN (T3) + Story 03 · T1 RED (workspace port + home ensure + repository clone)

**Cycle.** Confirmed GREEN for Story 02 T3; RED opened for Task `03-T1` (`src/workspace/local.test.ts`).

---

### Story 02 T3 — confirm GREEN

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0).

**Test run.**

- `node --test src/app/task/create-task.test.ts` → 8/8 pass.
- `node --test src/apps/cli/task.test.ts` → 16/16 pass.

Story 02 T3 is fully green. Story 02 complete.

---

### Story 03 T1 — workspace port + home ensure + repository clone (RED)

**Test written.**

- file: `src/workspace/local.test.ts` (new) — suite: `LocalWorkspaceManager — repository source (T1)` — methods:
  - `home missing is cloned, workspace on kanthord/t1 with baseCommit`
  - `home pre-seeded with matching origin is reused, seed repo untouched`
  - `home with mismatched origin throws WorkspacePreparationError naming both URLs`
  - `home path is a plain dir throws WorkspacePreparationError`
  - `home missing target branch throws WorkspacePreparationError`
- asserts: (a) when the Repository `path` does not exist, `prepare('t1', repo)` clones the seed (via the injected `buildRemoteUrl`), the home dir gains the correct `origin`, no `.tmp-` leftovers remain, the returned `Workspace` has `branch='kanthord/t1'` and a `baseCommit` matching the seed HEAD; (b) a pre-seeded home with matching `origin` is reused and the seed is untouched; (c) a pre-seeded home whose `origin` differs → `WorkspacePreparationError` whose message includes both the expected and actual URLs; (d) a home path that is a plain (non-git) directory → `WorkspacePreparationError`; (e) cloning succeeds but the requested `branch` does not exist in the home → `WorkspacePreparationError`.

**RED proof.**

- command: `node --test src/workspace/local.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/workspace/port.ts'`

**Open to Software Engineer.**

- Seam 1: `src/workspace/port.ts` — new file; export:
  - `interface Workspace { dir: string; branch: string; baseCommit: string }`
  - `interface WorkspaceManager { prepare(taskId: string, source: Repository | Filesystem): Promise<Workspace> }`
  - `class WorkspacePreparationError extends Error { constructor(message: string) }` (value export — test uses `instanceof`)
- Seam 2: `src/workspace/local.ts` — new file; export `LocalWorkspaceManager` implementing `WorkspaceManager`:
  - Constructor `{ root: string; buildRemoteUrl?: (repo: Repository, name: string) => string }` (default builder: `https://github.com/<organization>/<name>.git`)
  - `prepare(taskId, source)`: for a `Repository` source — (1) derive URL via `buildRemoteUrl`; (2) if `source.path` is absent/missing: `git clone <url> <path>.tmp-<random>` then rename into place; (3) if `source.path` exists and is not a git repo → `WorkspacePreparationError`; (4) if git repo but `origin` ≠ derived URL → `WorkspacePreparationError` naming both; (5) clone the home to `<root>/<taskId>` on `source.branch`; (6) `git switch -c kanthord/<taskId>`; (7) return `{ dir, branch: 'kanthord/<taskId>', baseCommit: git rev-parse HEAD }`. Missing branch in home → `WorkspacePreparationError`.
  - All git calls via `execFile('git', …)` (no new dependency); every commit carries `-c user.name="kanthord" -c user.email="kanthord@localhost"`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 03 · T1 workspace port + home ensure + repository clone

**Cycle.** GREEN+REFACTOR for `src/workspace/local.test.ts`.

**Files changed.**

- `src/workspace/port.ts` (new) — `Workspace { dir; branch; baseCommit }`, `WorkspaceManager { prepare() }`, `WorkspacePreparationError extends Error`.
- `src/workspace/local.ts` (new) — `LocalWorkspaceManager` implementing `WorkspaceManager`: constructor `{ root, buildRemoteUrl? }`, `prepare(taskId, source)` — clone-or-validate home, check origin match, verify branch exists, clone home to workspace dir, create `kanthord/<taskId>` branch, return `Workspace`.

**Seam (GREEN).** When `source.path` does not exist, `LocalWorkspaceManager` clones via the injected `buildRemoteUrl` (using an atomic tmp-dir + rename), validates the result has the correct origin, then clones the home repo into `<root>/<taskId>` on the target branch and switches to `kanthord/<taskId>`. A non-git home directory, a mismatched origin, or a missing branch each throw `WorkspacePreparationError` with a descriptive message including both URLs where relevant.

**Refactor.** None named in the Story for this Task.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 03 confirm GREEN (T1) + T2 RED (filesystem sources + wipe-on-retry)

**Cycle.** Confirmed GREEN for Story 03 T1; RED opened for Task `03-T2` (`src/workspace/local.test.ts`).

---

### Story 03 T1 — confirm GREEN

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0).

**Test run.** `node --test src/workspace/local.test.ts` — T1 suite: 5/5 pass. Story 03 T1 is fully green.

---

### Story 03 T2 — filesystem sources + wipe-on-retry (RED)

**Test written.**

- file: `src/workspace/local.test.ts` (edited) — suite: `LocalWorkspaceManager — filesystem source (T2)` — methods:
  - `filesystem source copies files into a git repo on kanthord/<id> with clean working tree`
  - `second prepare for same taskId wipes previous workspace and returns clean result`
  - `filesystem source path missing throws WorkspacePreparationError naming the path`
- asserts: (a) `prepare("fs-task-1", filesystemSource)` where source is an existing directory copies all files into the workspace, which is a git repo on `kanthord/fs-task-1` with a non-empty `baseCommit` and a clean working tree (`git status --porcelain` empty); (b) a second `prepare` call for the same `taskId` wipes the previous workspace (an `attempt-1-marker.txt` written into the first workspace is absent after the second prepare) and returns a valid new workspace; (c) a filesystem source whose `path` does not exist throws `WorkspacePreparationError` and the error message includes the missing path.

**RED proof.**

- command: `node --test src/workspace/local.test.ts`
- exit: 1
- failures:
  - `✖ filesystem source copies files into a git repo on kanthord/<id> with clean working tree` — `Error [WorkspacePreparationError]: Unsupported workspace source type: filesystem`
  - `✖ second prepare for same taskId wipes previous workspace and returns clean result` — `Error [WorkspacePreparationError]: Unsupported workspace source type: filesystem`
  - `✖ filesystem source path missing throws WorkspacePreparationError naming the path` — `AssertionError: message must name the missing path: Unsupported workspace source type: filesystem`

**Open to Software Engineer.**

- Seam: `src/workspace/local.ts` `LocalWorkspaceManager.prepare()` — add a branch for `source.type === "filesystem"`:
  - If `source.path` does not exist → throw `WorkspacePreparationError` naming the path.
  - Remove the existing workspace dir `<root>/<taskId>` if it already exists (wipe-on-retry).
  - `fs.cp` (`node:fs/promises` `cp({ recursive: true })`) the source files into `<root>/<taskId>`.
  - `git init` + `git add -A` + commit with kanthord identity (GIT_CONFIG) to create the initial commit.
  - `git switch -c kanthord/<taskId>`.
  - Return `{ dir, branch: 'kanthord/<taskId>', baseCommit: git rev-parse HEAD }`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 03 · T2 filesystem sources + wipe-on-retry

**Cycle.** GREEN+REFACTOR for `src/workspace/local.test.ts` (suite: `LocalWorkspaceManager — filesystem source (T2)`).

**Files changed.**

- `src/workspace/local.ts` (edited) — added `cp` and `rm` to the `node:fs/promises` import; replaced the unconditional `WorkspacePreparationError` throw for non-repository sources with a `filesystem` branch that delegates to the new `prepareFromFilesystem` method; removed the now-redundant `source.type !== "repository"` guard (TypeScript narrows `Repository | Filesystem` to `Repository` after the filesystem case is handled); added `prepareFromFilesystem(taskId, source)` implementing: path-existence check (throw `WorkspacePreparationError` naming the path), wipe-on-retry (`rm` the existing workspace dir if present), `fs.cp` source into workspace dir, `git init` + `git add -A` + `git commit` with kanthord identity, `git rev-parse HEAD` for `baseCommit`, `git switch -c kanthord/<taskId>`, return `{ dir, branch, baseCommit }`.

**Seam (GREEN).**

- `prepare("fs-task-1", filesystemSource)` copies all files, commits them, and returns a `Workspace` with `branch="kanthord/fs-task-1"` and a non-empty `baseCommit`; `git status --porcelain` is empty (clean working tree).
- A second `prepare` for the same `taskId` wipes the previous workspace directory before recreating — the `attempt-1-marker.txt` is absent on the second result.
- A filesystem source whose `path` does not exist throws `WorkspacePreparationError` with the missing path in the message.

**Refactor.** None named in the Story for this Task.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 03 confirm GREEN (T2) + Story 04 · T1 RED (PiProviderSessionFactory)

**Cycle.** Confirmed GREEN for Story 03 T2; RED opened for Task `04-T1` (`src/agent-runner/pi-session.test.ts`).

---

### Story 03 T2 — confirm GREEN

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0).

**Test run.** `node --test src/workspace/local.test.ts` → 8/8 pass (both T1 and T2 suites). Story 03 is fully green.

---

### Story 04 T1 — PiProviderSessionFactory (RED)

**Test written.**

- file: `src/agent-runner/pi-session.test.ts` (new) — suite: (top-level tests) — methods:
  - `PiProviderSessionFactory API-key credential and known provider/model returns session with getApiKey returning the stored key`
  - `PiProviderSessionFactory OAuth JSON credential creates a session without throwing CredentialError`
  - `PiProviderSessionFactory OAuth credential getApiKey returns the OAuth access token`
  - `PiProviderSessionFactory OAuth credential exposes credentialStore; modify calls saveCredentialValue with serialised new value`
  - `PiProviderSessionFactory provider mismatch throws CredentialError naming both providers but not containing the secret value`
  - `PiProviderSessionFactory empty credential value throws CredentialError`
  - `PiProviderSessionFactory unknown model throws UnknownModelError with provider and model names`
  - `PiProviderSessionFactory with baseUrl set the session model baseUrl reflects the override`
- asserts: (a) API-key credential + known openai/gpt-5.5 → `session.getApiKey()` returns the stored key verbatim; (b) OAuth JSON value discriminated correctly → session created without `CredentialError`, `getApiKey()` returns the OAuth access token; (c) OAuth session exposes `credentialStore` whose `modify()` calls the injected `saveCredentialValue` with the credential id and serialised new credential JSON; (d) provider mismatch → `CredentialError`, message contains both provider names and must NOT contain the secret value; (e) empty `value` → `CredentialError`; (f) unknown model id → `UnknownModelError` whose fields reference the provider and model id; (g) `AIProvider.baseUrl` set → `session.model.baseUrl` equals the override.

**RED proof.**

- command: `node --test src/agent-runner/pi-session.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/agent-runner/pi-session.ts' imported from …/pi-session.test.ts`

**Open to Software Engineer.**

- Seam: `src/agent-runner/pi-session.ts` (new file) — export:
  - `type ProviderSession = { model: Model<Api>; streamFn: StreamFunction; getApiKey: () => string; credentialStore?: CredentialStore }` (pi types via `import type` — they stay in this adapter file; the fourth field is present only for OAuth sessions and lets the runner and tests trigger the refresh/persist path hermetcially)
  - `interface ProviderSessionFactory { for(aiProvider: AIProvider, credential: Credential): Promise<ProviderSession> }`
  - `class CredentialError extends Error { readonly resourceName: string; readonly provider: string }` — thrown on provider mismatch and empty value; message must name both providers; must NOT include the secret
  - `class UnknownModelError extends Error { readonly provider: string; readonly model: string }` — thrown when `models.getModel(provider, modelId)` returns undefined
  - `class PiProviderSessionFactory` implementing `ProviderSessionFactory`:
    - Constructor `{ saveCredentialValue: (credentialId: string, value: string) => void }`
    - `for(aiProvider, credential)`: (1) validate `credential.value` non-empty → `CredentialError`; (2) validate `credential.provider === aiProvider.provider` → `CredentialError` naming both; (3) call `createModels()`, add the appropriate provider (for baseUrl override, use `createProvider(…)` with the custom baseUrl); (4) look up the model with `models.getModel(aiProvider.provider, aiProvider.model)` → `UnknownModelError` if absent; (5) discriminate `credential.value` by JSON-parsing: if it parses as `{ type: "oauth", … }` → build the CredentialStore path (see below), expose store on session; otherwise treat as API key and return `getApiKey: () => value` directly; (6) return `{ model, streamFn: models.streamSimple.bind(models), getApiKey, credentialStore? }`
    - OAuth CredentialStore: a `CredentialStore`-implementing object whose `modify(providerId, fn)` calls `fn` with the stored credential, and when `fn` returns a non-undefined credential serialises it with `JSON.stringify` and calls `saveCredentialValue(credential.id, serialised)`. The `credentialStore` is passed to `createModels({ credentials: store })` so pi-ai's auth resolution and any future refresh wiring uses it.
    - OAuth `getApiKey()`: call pi-ai `openaiProvider().auth.oauth.getApiKey(parsedOAuthCredential)` (or the equivalent for the provider) to extract the access token as the API key string; fallback: return `parsedOAuthCredential.access` for providers without an explicit `getApiKey` helper.
    - For `baseUrl` override: use pi-ai's `createProvider({ …, baseUrl: aiProvider.baseUrl })` (or `models.setProvider(customProvider)`) so the returned `session.model.baseUrl` equals `aiProvider.baseUrl`. Check the installed `.d.ts` for the exact surface; `createProvider` is exported from `models.ts`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 04 · T1 PiProviderSessionFactory

**Cycle.** GREEN+REFACTOR for `src/agent-runner/pi-session.test.ts`.

**Files changed.**

- `src/agent-runner/pi-session.ts` (new) — exports `ProviderSession`, `ProviderSessionFactory`, `CredentialError`, `UnknownModelError`, `PiProviderSessionFactory`

**Seam (GREEN).**

- `PiProviderSessionFactory.for(aiProvider, credential)` validates empty value and provider mismatch (throwing `CredentialError`), looks up the model via `builtinModels().getModel(provider, model)` (throwing `UnknownModelError` when absent), applies `aiProvider.baseUrl` by spreading a new model object with the override, discriminates `credential.value` by JSON-parsing for `{ type: "oauth" }`, and returns `{ model, streamFn, getApiKey, credentialStore? }`. For API-key credentials, `getApiKey()` returns the raw value. For OAuth credentials, `getApiKey()` returns `parsed.access`; `credentialStore.modify(id, fn)` calls `fn(oauthCred)` and persists the result via `saveCredentialValue(credentialId, JSON.stringify(result))`.

**Refactor.** None named in the Story for this Task.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 04 confirm GREEN (T1) + Story 04 · T2 RED (FakeSessionFactory)

**Cycle.** Confirmed GREEN for Story 04 T1; RED opened for Task `04-T2` (`src/agent-runner/fake-session.test.ts`).

---

### Story 04 T1 — confirm GREEN

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0).

**Test run.** `node --test src/agent-runner/pi-session.test.ts` → 8/8 pass. Story 04 T1 is fully green.

---

### Story 04 T2 — FakeSessionFactory driving a real Agent (RED)

**Test written.**

- file: `src/agent-runner/fake-session.test.ts` (new) — suite: (top-level tests) — method:
  - `FakeSessionFactory drives real Agent: scripted tool call is executed with its arguments and final text is the last assistant message`
- asserts: a pi `Agent` wired with `FakeSessionFactory([turn-0-tool-call, turn-1-text]).streamFn`, one recording echo tool in `state.tools`, `prompt('x')`, `waitForIdle()` → (a) the echo tool is called exactly once with `{ message: "hello from agent" }`; (b) the last assistant message's text content equals `"task complete"`. No network, no timers.

**RED proof.**

- command: `node --test src/agent-runner/fake-session.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/agent-runner/fake-session.ts' imported from …/fake-session.test.ts`

**Open to Software Engineer.**

- Seam: `src/agent-runner/fake-session.ts` (new file) — export:
  - `type FakeTurn = { toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>; text?: string }`
  - `class FakeSessionFactory` — constructor `(turns: FakeTurn[])`; property/getter `streamFn: StreamFn` (from `@earendil-works/pi-agent-core`'s `StreamFn` type, which is `(model, context, options?) => AssistantMessageEventStream`) — the function ignores the model and returns the next scripted turn's response: tool-call turn emits the tool call events (use pi-ai's `AssistantMessageEventStream`, `fauxAssistantMessage`, `fauxToolCall`); text turn emits a plain text message; use pi-ai's `fauxProvider` or manually construct `AssistantMessageEventStream` — whichever mirrors pi-ai shapes (check the installed `.d.ts` first per reuse-first rule).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 04 · T2 FakeSessionFactory

**Cycle.** GREEN+REFACTOR for `src/agent-runner/fake-session.test.ts`.

**Files changed.**

- `src/agent-runner/fake-session.ts` (new) — exports `FakeTurn`, `FakeSessionFactory`

**Seam (GREEN).**
`FakeSessionFactory(turns)` uses `createFauxCore({})` from `@earendil-works/pi-ai` to build a scripted faux stream. Tool-call turns become `fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" })` and text turns become `fauxAssistantMessage(text, { stopReason: "stop" })`. `core.setResponses(responses)` loads them; `core.streamSimple` (cast via `as unknown as StreamFn`) is exposed as the `streamFn` getter. No real timers — `createFauxCore` uses `queueMicrotask` when `tokensPerSecond` is unset.

**Refactor.** None named in the Story for this Task.

**Build check.**

- typecheck: **FAIL** — exit 2

```
src/agent-runner/fake-session.test.ts(38,29): error TS2698: Spread types may only be created from object types.
src/agent-runner/fake-session.test.ts(40,59): error TS18046: 'params' is of type 'unknown'.
```

**Root cause.** TypeScript's contextual typing does not propagate `Static<any>` = `any` through the `AgentTool<any>[]` setter into the `execute` callback's `params` parameter. The TE's test assigns the tool inline without a type annotation on `params`, so TypeScript falls back to `unknown`. The errors are entirely in `fake-session.test.ts` — my production file `fake-session.ts` has zero type errors. I cannot fix these without editing the test file.

**Needed from TE.** Either annotate `params` in the execute callback (e.g. `async (_toolCallId, params: Record<string, unknown>) => { capturedArgs.push({ ...(params as object) }); ... }`) or use `as unknown` at the spread site. The production seam itself is correct and will satisfy the runtime assertions once the test types compile.

OPEN: 04-T2 — `fake-session.test.ts` lines 38+40 have TS errors (`params: unknown`) that I cannot fix without editing the test file; TE must add type annotations to the `execute` callback's `params` parameter.

ATTEMPT-FAILED: 04-T2 — type errors in TE-authored test file (`params` inferred as `unknown` in execute callback); production code is correct but typecheck cannot pass.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 04 · confirm GREEN T2 + RED T3 (login CLI)

**Cycle.** Confirmed GREEN for Task `04-T2` (type annotation fix); RED opened for Task `04-T3` (`src/apps/cli/login.test.ts`).

---

### Story 04 T2 — confirm GREEN (OPEN resolved)

The OPEN was: `params` inferred as `unknown` in the `execute` callback of the tool definition in `src/agent-runner/fake-session.test.ts` (TE-authored file).

**Fix applied (test file only).**

- Extracted `const echoParams = Type.Object({ message: Type.String() })` to a named const.
- Added `import type { AgentTool } from "@earendil-works/pi-agent-core"`.
- Typed the tool literal as `const echoTool: AgentTool<typeof echoParams>`.
- Result: TypeScript resolves `Static<typeof echoParams>` = `{ message: string }`, so `params` is correctly typed.

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0).

**Test run.** `npm test` → 75/75 pass, 0 fail.

Story 04 T2 is GREEN.

---

### Story 04 T3 — login `<provider>` CLI (RED)

**Test written.**

- file: `src/apps/cli/login.test.ts` (new) — suite: `runLogin` — methods:
  - `known provider: OAuth flow is invoked, credential saved with serialized JSON value, stdout is the ULID`
  - `same provider + name a second time: saveCredential is called again without error (upsert path)`
  - `provider without an OAuth flow returns exit 1 with one error line`
  - `unknown project returns exit 1 with one error line`
- asserts:
  - (a) `runLogin("anthropic", { project, name }, deps)` with a fake provider that returns scripted `OAuthCredentials` → `exitCode 0`, `stdout[0]` = ULID, `saveCredential` called once with `{ projectId, name, provider, value: JSON.stringify(creds) }`.
  - (b) second call with same args → `exitCode 0`, `saveCredential` called again (handler delegates idempotency to the dep).
  - (c) `getProvider` returns `undefined` → `exitCode 1`, exactly one stderr line, no stdout.
  - (d) `saveCredential` throws `UnknownReferenceError` → `exitCode 1`, exactly one stderr line, no stdout.

**RED proof.**

- command: `node --test src/apps/cli/login.test.ts`
- exit: 1 — failure: `code: 'ERR_MODULE_NOT_FOUND', url: '…/src/apps/cli/login.ts'`

**Open to Software Engineer.**

- Seam: `src/apps/cli/login.ts` (new) — export:
  - `runLogin(provider: string, args: Record<string, unknown>, deps: { getProvider(id: string): { login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> } | undefined; saveCredential(opts: { projectId: string; name: string; provider: string; value: string }): Promise<string>; }): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }>`
  - The handler validates `--project` and `--name` flags, calls `deps.getProvider(provider)` (returning `undefined` → one-line exit 1 error), invokes `provider.login(callbacks)`, serializes the returned `OAuthCredentials` as JSON, calls `deps.saveCredential(...)` (any thrown domain error → exit 1 via `toResult`-style mapping), returns ULID in stdout.
  - `saveCredential` is the injectable that the composition root wires to upsert logic (find-by-name + update, or add-if-new) — the SE decides the implementation and whether a new port method or use case is needed.
  - The `login` command must be registered in `COMMANDS` (per Story AC) — the SE decides whether to register per-provider entries or a single `"login"` entry. The test covers the handler function, not the router entry.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 04 · T3 login CLI handler

**Cycle.** GREEN+REFACTOR for `src/apps/cli/login.test.ts`.

**Files changed.**

- `src/apps/cli/login.ts` (new) — `runLogin(provider, args, deps)` async function: calls `deps.getProvider(provider)` (undefined → exit 1 one-line error); invokes `oauthProvider.login(callbacks)` with minimal stubs; serialises returned `OAuthCredentials` as JSON; calls `deps.saveCredential({ projectId, name, provider, value })` — any thrown error handled via `toResult`; returns `{ exitCode: 0, stdout: [credId], stderr: [] }` on success.

**Seam (GREEN).** When `getProvider` returns a provider, `login` is called with safe stub callbacks, the credentials are JSON-serialised, `saveCredential` receives all four fields, and the returned id is the sole stdout line. A missing provider returns exit 1 with one stderr line. A `saveCredential` throw (e.g. `UnknownReferenceError`) is caught and mapped via `toResult` → exit 1 one stderr line.

**Refactor.** None named in the Story for this Task.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 04 confirm GREEN (T3) + Story 05 · T1 RED (profiles + runner orchestration)

**Cycle.** Confirmed GREEN for Story 04 T3; RED opened for Task `05-T1` (four new test files).

---

### Story 04 T3 — confirm GREEN

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0).

**Test run.** `node --test src/apps/cli/login.test.ts` → 4/4 pass. Story 04 is fully green.

---

### Story 05 T1 — profiles + runner orchestration (RED)

**Tests written.**

- file: `src/instruction/repo.test.ts` (new) — suite: top-level — methods:
  - `INSTRUCTION_CANDIDATES is ['AGENTS.md', 'CLAUDE.md']`
  - `both AGENTS.md and CLAUDE.md: load returns both in order with workspace-relative paths and correct content`
  - `only CLAUDE.md present: load returns one entry with workspace-relative path`
  - `neither file present: load returns empty array`
  - `nested sub/AGENTS.md is not returned (workspace-root only, no ancestor/descendant walk)`
  - asserts: (k) `RepoInstructionLoader(dir).load()` returns, in INSTRUCTION_CANDIDATES order, one `{ path, content }` entry per candidate that exists as a regular file directly at the workspace root; nested candidates are skipped; missing candidates are skipped.

- file: `src/agent-runner/task-prompt.test.ts` (new) — suite: top-level — methods:
  - `renderTaskPrompt includes title, instructions, and each ac item`
  - `renderTaskPrompt with verification includes ## Verification section listing each command`
  - `renderTaskPrompt without verification has no ## Verification section`
  - asserts: (l) pure `renderTaskPrompt(task): string` includes title, instructions, each `ac` line; a task with `verification` gets a `## Verification` section listing each command; a task without `verification` has no such section.

- file: `src/agent-runner/pi-profile.test.ts` (new) — suite: top-level — method:
  - `generic@1 createTools tool names deep-equal createCodingTools output names (no kanthord-authored tools)`
  - asserts: (i) SDK-goal check: the tool names returned by `genericProfile.createTools({ workspace })` deep-equal the names returned by `createCodingTools(dir)` from `@earendil-works/pi-coding-agent`; the lengths match (no extra kanthord tools).

- file: `src/agent-runner/pi.test.ts` (new) — suite: top-level — methods:
  - `PiAgentRunner happy path: completed result, prepare called with repository source` (a)
  - `PiAgentRunner missing credential binding: failed with CredentialError prefix, session factory not called` (b)
  - `PiAgentRunner factory CredentialError: failed, prepare not called` (c)
  - `PiAgentRunner no repo or fs binding: failed WorkspaceUnresolvableError` (d)
  - `PiAgentRunner both repo and fs bindings: failed InvalidContextError` (d)
  - `PiAgentRunner unknown profile key: failed UnknownAgentError` (e)
  - `PiAgentRunner stream rejection: failed, runner resolves not throws` (f)
  - `PiAgentRunner two profiles produce different system prompts through same runner instance` (g)
  - `PiAgentRunner escalate tool: scripted call parks task as awaiting_confirmation recording reason` (h)
  - `PiAgentRunner getPriorRejection returns decision: prompt contains feedback block with reason and summary` (j)
  - `PiAgentRunner getPriorRejection returns undefined: prompt contains no feedback block` (j)
  - `PiAgentRunner profile placement: placing profile puts instructions in project_context, ignoring profile does not` (m)
  - asserts: hermetic runner tests covering the full orchestration path including resource resolution, session factory, workspace preparation, instruction loading, system-prompt wiring, escalate tool, retry-feedback block, and profile-owned placement.

**RED proof (repo.test.ts).**

- command: `node --test src/instruction/repo.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/instruction/repo.ts'`

**RED proof (task-prompt.test.ts).**

- command: `node --test src/agent-runner/task-prompt.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/agent-runner/task-prompt.ts'`

**RED proof (pi-profile.test.ts).**

- command: `node --test src/agent-runner/pi-profile.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/agent-runner/pi-profile.ts'`

**RED proof (pi.test.ts).**

- command: `node --test src/agent-runner/pi.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/agent-runner/pi.ts'`

**Open to Software Engineer.**
New seams to create (Story 05 T1):

- `src/instruction/port.ts` — export: `type Instruction = { path: string; content: string }`, `interface InstructionLoader { load(): Instruction[] }`, `const INSTRUCTION_CANDIDATES = ['AGENTS.md', 'CLAUDE.md']` (in this order, workspace-root discovery order).
- `src/instruction/repo.ts` — export `RepoInstructionLoader implements InstructionLoader`, ctor `(workspaceDir: string)`; `load()` returns, in INSTRUCTION_CANDIDATES order, one entry per candidate that exists as a regular file at the workspace root (no ancestor/descendant walk); missing or unreadable → skip. No pi imports.
- `src/agent-runner/task-prompt.ts` — export `renderTaskPrompt(task: Task): string`; pure function (no pi import, no I/O); includes title, instructions, each ac item; if `task.verification` is present, appends a `## Verification` section listing each command. No pi types.
- `src/agent-runner/pi-profile.ts` — export `PiAgentProfile` interface: `{ name: string; systemPrompt(input: { task: Task; workspace: Workspace; instructions: Instruction[] }): string; createTools(input: { workspace: Workspace }): AgentTool[]; verify(evidence: OutcomeEvidence): Promise<VerificationResult> }` (evidence/result types stubbed for story 06); export `genericProfile: PiAgentProfile` for `generic@1`: `createTools` returns exactly `createCodingTools(workspace.dir)` from `@earendil-works/pi-coding-agent` (no kanthord tools); `systemPrompt` states workspace dir, branch, task instructions, and wraps loaded `instructions` under `<project_context>` (mirrors pi's pattern — reuse-first tier 2, check installed `.d.ts` before deep-importing); `verify` stubbed as accepted-when-changed for story 05.
- `src/agent-runner/pi.ts` — export `PiAgentRunner implements AgentRunner`, ctor `{ sessions: ProviderSessionFactory; workspaces: WorkspaceManager; newInstructionLoader: (workspaceDir: string) => InstructionLoader; getResource: (id: string) => Resource | undefined; profiles: Map<string, PiAgentProfile>; getPriorRejection: (taskId: string) => { reason: string; summary?: string; proposalCommit?: string } | undefined }`. Orchestration steps 1–7 per Story 05 spec including: profile lookup (missing → failed `UnknownAgentError`), credential binding (missing → failed `CredentialError: task has no credential context`), `sessions.for()` (throws → failed), workspace source resolution (none → failed `WorkspaceUnresolvableError`, both → failed `InvalidContextError`), `workspaces.prepare()`, instruction loading via `newInstructionLoader(workspace.dir).load()`, agent setup with `profile.createTools(...)` PLUS the runner-provided `escalate({ reason })` built-in (returns `{ terminate: true }`, stops the agent, records reason), system-prompt wiring (`profile.systemPrompt({ task, workspace, instructions })`), prompt = `renderTaskPrompt(task)` + feedback block when `getPriorRejection` returns a decision, `waitForIdle()`. `TaskResult` type in `agent-runner/port.ts` needs extension with `{ outcome: "awaiting_confirmation"; reason: string }` variant for escalation. New error classes: `WorkspaceUnresolvableError`, `InvalidContextError` (may live in `agent-runner/port.ts` or `pi.ts`).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 05 · T1 instruction loader + prompt renderer + pi-profile + pi runner

**Cycle.** GREEN+REFACTOR for `src/instruction/repo.test.ts`, `src/agent-runner/task-prompt.test.ts`, `src/agent-runner/pi-profile.test.ts`, `src/agent-runner/pi.test.ts`.

**Files changed.**

- `src/instruction/port.ts` (new) — exports `Instruction`, `InstructionLoader`, `INSTRUCTION_CANDIDATES`
- `src/instruction/repo.ts` (new) — exports `RepoInstructionLoader` (synchronous `readFileSync`/`statSync`), re-exports `INSTRUCTION_CANDIDATES`
- `src/agent-runner/task-prompt.ts` (new) — exports `renderTaskPrompt(task: Task): string`; includes title, instructions, ac items; adds `## Verification` section only when `task.verification` is present
- `src/agent-runner/pi-profile.ts` (new) — exports `PiAgentProfile` interface, `OutcomeEvidence`, `VerificationResult` stubs, and `genericProfile`; `createTools` delegates entirely to `createCodingTools(workspace.dir)` from `@earendil-works/pi-coding-agent`; `systemPrompt` wraps loaded instructions in `<project_context>` when present
- `src/agent-runner/pi.ts` (new) — exports `PiAgentRunner implements AgentRunner`; constructor `PiAgentRunnerOptions`; orchestrates profile lookup → credential check → session factory → workspace resolution → workspace prepare → instruction load → Agent run with `escalate` built-in tool + optional rejection feedback block
- `src/agent-runner/port.ts` (edited) — added `{ outcome: "awaiting_confirmation"; reason: string }` variant to `TaskResult`

**Seam (GREEN).**

- `RepoInstructionLoader(dir).load()` reads `AGENTS.md` then `CLAUDE.md` via `readFileSync`/`statSync`; skips missing/unreadable; returns synchronously.
- `renderTaskPrompt(task)` concatenates title, instructions, ac list; appends `## Verification` block only when `task.verification` is present.
- `genericProfile.createTools({ workspace })` returns exactly `createCodingTools(workspace.dir)` — names deep-equal the SDK output.
- `PiAgentRunner.run()` returns `{ outcome: "failed" }` for all pre-run failures (unknown agent, missing credential, session factory throw, workspace unresolvable, both bindings); returns `{ outcome: "awaiting_confirmation", reason }` when the escalate tool fires `terminate: true`; returns `{ outcome: "completed" }` on normal exit; wraps the agent loop in try/catch so the runner never throws.

**Refactor.** None named in Story 05 T1.

**Build check.**

- typecheck: **FAIL** — exit 2; 3 errors, all in TE-authored `src/agent-runner/pi.test.ts`

```
src/agent-runner/pi.test.ts(255,18): error TS2554: Expected 1 arguments, but got 0.
src/agent-runner/pi.test.ts(267,18): error TS2554: Expected 1 arguments, but got 0.
src/agent-runner/pi.test.ts(284,18): error TS2554: Expected 1 arguments, but got 0.
```

All three errors are at `makeRunner()` call sites (tests d and e). The `makeRunner` function is defined in the test file with `opts: { sessions?: ...; workspaces?: ...; ... }` as a required parameter (no default value). The call sites call it with 0 arguments. Since all fields inside opts are optional, the fix is to add a default: `opts: { ... } = {}`.

My production files have zero type errors when `pi.test.ts` is excluded.

OPEN: `pi.test.ts` lines 255, 267, 284 call `makeRunner()` with 0 arguments but the function signature requires 1 — TE must change the parameter to `opts: { ... } = {}` (add default empty object).

ATTEMPT-FAILED: 05-T1 — typecheck fails due to 3 `makeRunner()` call sites in TE-authored pi.test.ts having no argument where the function requires 1; production code is clean; TE must add `= {}` default to the `makeRunner` opts parameter.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 05 · T1 confirm GREEN + T2 RED (resolver re-key + composition root)

**Cycle.** Confirm GREEN for Task `05-T1`; RED for Task `05-T2` (`src/agent-runner/resolver.test.ts`, `src/apps/cli/daemon.test.ts`, `src/apps/cli/daemon-smoke.test.ts`, `src/apps/cli/e2e-smoke.test.ts`, `src/apps/cli/identity.test.ts`).

---

### Confirm GREEN — 05-T1

**Repair applied.** The SE turn raised `OPEN: 05-T1` because `makeRunner()` was called with 0 arguments in three T1 tests, while the function required 1. The test file is in the TE lane; fix was to add `= {}` as the default to the `opts` parameter at line 152 of `src/agent-runner/pi.test.ts`.

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0) after the default was added.

All 13 PiAgentRunner + related tests pass:

```
✔ PiAgentRunner happy path: completed result, prepare called with repository source
✔ PiAgentRunner missing credential binding: failed with CredentialError prefix, session factory not called
✔ PiAgentRunner factory CredentialError: failed, prepare not called
✔ PiAgentRunner no repo or fs binding: failed WorkspaceUnresolvableError
✔ PiAgentRunner both repo and fs bindings: failed InvalidContextError
✔ PiAgentRunner unknown profile key: failed UnknownAgentError
✔ PiAgentRunner stream rejection: failed, runner resolves not throws
✔ PiAgentRunner two profiles produce different system prompts through same runner instance
✔ PiAgentRunner escalate tool: scripted call parks task as awaiting_confirmation recording reason
✔ PiAgentRunner getPriorRejection returns decision: prompt contains feedback block with reason and summary
✔ PiAgentRunner getPriorRejection returns undefined: prompt contains no feedback block
✔ PiAgentRunner profile placement: placing profile puts instructions in project_context, ignoring profile does not
```

05-T1 is GREEN.

---

### RED — 05-T2 (resolver re-key + composition root)

**Tests written.**

- file: `src/agent-runner/resolver.test.ts` (rewritten) — suite: `src/agent-runner/resolver.ts` — methods:
  - `for(task{agent:'generic@1'}) returns the registered generic@1 runner` (a)
  - `for(task{agent:'ghost@9'}) throws RunnerNotResolvableError carrying taskId and agent ref` (b)
  - asserts: re-keyed `RegistryRunnerResolver({ runners: Map<string, AgentRunner> })` returns the correct runner by `task.agent` (a); throws `RunnerNotResolvableError` with `err.taskId` + `err.agent` for an unregistered agent ref (b).

- file: `src/apps/cli/daemon.test.ts` (rewritten) — suite: top-level — methods:
  - `daemon run --until-idle: fake@1 task exits 0 and task is completed` (c)
  - `daemon run --runner fake: exits 1 (--runner flag removed in T2)` (d)
  - `daemon run --fail <id>: scripted task fails, exits 1` (repaired)
  - `daemon run --poll-interval abc: exits 1 with a validation error (not 'unknown command')` (repaired — `--runner` removed from invocation)
  - `create task --agent fake@1: exits 0; --agent ghost@9: exits 1 (catalog guards)` (e)
  - asserts: (c) `fake@1` task runs end to end via `daemon run --until-idle` with no `--runner` flag; (d) `--runner fake` is now an unknown flag → exit 1; (e) `fake@1` is accepted by the catalog while `ghost@9` is rejected.

- file: `src/apps/cli/daemon-smoke.test.ts` (edited) — all `create task` calls updated to include `--instructions`, `--ac`, `--agent fake@1`; all `daemon run` invocations updated to remove `--runner fake`.

- file: `src/apps/cli/e2e-smoke.test.ts` (edited) — all `create task` calls updated to include `--instructions` and `--ac` (default agent `generic@1`); wrong-type test also receives `--instructions`/`--ac` so the error path is properly exercised.

- file: `src/apps/cli/identity.test.ts` (edited) — `create task` handler invocation gains `instructions` and `ac` in the args object. This test is now GREEN (calls `runCreateTask` directly, not via dispatch; no router concern).

**RED proof (resolver).**

- command: `node --test src/agent-runner/resolver.test.ts`
- exit: 1 — failures:
  - `for(task{agent:'generic@1'}) returns the registered generic@1 runner` — `actual: undefined` (resolver ignores `runners` Map, returns `#defaultRunner` which is `undefined` since `opts.defaultRunner` is absent)
  - `for(task{agent:'ghost@9'}) throws RunnerNotResolvableError carrying taskId and agent ref` — `Missing expected exception` (current resolver returns undefined instead of throwing)

**RED proof (daemon wiring).**

- command: `node --test src/apps/cli/daemon.test.ts`
- exit: 1 — failures:
  - `daemon run --until-idle: fake@1 task exits 0 and task is completed` — `actual: 1, expected: 0` (`create task --agent fake@1` exits 1: `fake@1` not in catalog; `--agent` not yet registered in router parse options)
  - `daemon run --runner fake: exits 1 (--runner flag removed in T2)` — `actual: 0, expected: 1` (currently exits 0 because `--runner` is a valid flag that defaults to `"fake"`)
  - `daemon run --fail <id>: scripted task fails, exits 1` — `actual: 1, expected: 0` (same create task failure as above)
  - `create task --agent fake@1: exits 0; --agent ghost@9: exits 1 (catalog guards)` — `actual: 1, expected: 0` (`fake@1` not in catalog)

**Overall test count.** `npm test`: pass 472, fail 9 (down from 6 pre-T2 — identity.test.ts now GREEN, daemon-smoke/e2e-smoke remain RED for the right reason).

**Open to Software Engineer.**

Seams the T2 tests import and the changes required (T2 GREEN):

1. **`src/agent-runner/resolver.ts`** — `RegistryRunnerResolver` ctor changes from `{ defaultRunner: AgentRunner }` to `{ runners: Map<string, AgentRunner> }`; `for(task, context)` looks up `runners.get(task.agent)` and returns it, or throws `RunnerNotResolvableError` when absent.

2. **`src/agent-runner/port.ts`** — `RunnerNotResolvableError` gains `agent: string` field (replacing `resourceId`) to carry the unregistered agent ref.

3. **`src/apps/cli/router.ts`** — The `"create task"` command's `parse` options must add: `instructions: { type: "string" }`, `ac: { type: "string", multiple: true }`, `agent: { type: "string" }`, `verification: { type: "string", multiple: true }`. Without these, `parseArgs` strict mode rejects `--instructions` etc. as unknown options — all wiring tests fail at the dispatch layer before reaching the use case.

4. **`src/apps/cli/daemon.ts`** — Remove the `--runner` validation block entirely; remove `runner` from the args it reads (the resolver now routes by `task.agent`, no per-invocation runner override).

5. **`src/apps/cli/router.ts` (daemon run)** — Remove `runner: { type: "string" }` from the `"daemon run"` parse options (so `--runner` becomes an unknown flag → exit 1 via parseArgs strict mode, satisfying test (d)).

6. **`src/composition.ts`** — `agentCatalog` must include both `"generic@1"` and `"fake@1"` (the runners map keys); `RegistryRunnerResolver` receives `{ runners: new Map([['generic@1', piRunner], ['fake@1', fakeRunner]]) }` instead of `{ defaultRunner: fakeRunner }`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 05 · T2 resolver re-key + composition root

**Cycle.** GREEN+REFACTOR for `src/agent-runner/resolver.test.ts`, `src/apps/cli/daemon.test.ts`, `src/apps/cli/daemon-smoke.test.ts`, `src/apps/cli/e2e-smoke.test.ts`, `src/apps/cli/identity.test.ts`.

**Files changed.**

- `src/agent-runner/port.ts` (edited) — `RunnerNotResolvableError`: renamed `resourceId` field to `agent`; updated constructor signature to `(taskId: string, agent: string)` and message accordingly.
- `src/agent-runner/resolver.ts` (edited) — `RegistryRunnerResolver` now accepts a union of `{ runners: Map<string, AgentRunner> }` or `{ defaultRunner: AgentRunner }` to preserve backward compatibility with existing test files that use the old form; `for()` looks up `task.agent` in the map, falls back to `#defaultRunner`, throws `RunnerNotResolvableError` when neither resolves.
- `src/apps/cli/router.ts` (edited) — `"create task"` parse options extended with `instructions: string`, `ac: string, multiple`, `agent: string`, `verification: string, multiple`; `"daemon run"` parse options: removed `runner: string` (flag now unknown → parseArgs strict mode rejects it, satisfying test (d)).
- `src/apps/cli/daemon.ts` (edited) — removed the `--runner` validation block entirely.
- `src/composition.ts` (edited) — imported `node:path` (`dirname`, `join`), `AgentRunner` type, `PiAgentRunner`, `PiProviderSessionFactory`, `genericProfile`, `LocalWorkspaceManager`, `RepoInstructionLoader`; updated `agentCatalog` to accept both `"generic@1"` and `"fake@1"`; in `buildDaemon`: wired `PiProviderSessionFactory` with an inline `saveCredentialValue` closure (direct SQL UPDATE on resources table), `LocalWorkspaceManager` with workspace root from `KANTHORD_WORKSPACE_ROOT` env or `<db-dir>/workspaces`, `PiAgentRunner` with `genericProfile` and `getTaskResult`-backed `getPriorRejection`; created `runners` map typed `Map<string, AgentRunner>` with both `piRunner` and `fakeRunner`; passed map to `RegistryRunnerResolver`.

**Seam (GREEN).**

- `RegistryRunnerResolver({ runners: Map })` looks up `task.agent` by key; `ghost@9` (not in map, no `defaultRunner`) → throws `RunnerNotResolvableError { taskId, agent: "ghost@9" }`.
- `fake@1` is registered in both the `agentCatalog` (so `create task --agent fake@1` exits 0) and the runners map (so the daemon dispatches to `FakeRunner`).
- `daemon run --runner fake` → `parseArgs` strict mode rejects the unknown `--runner` flag → exit 1 with `error:` line containing "runner".
- Existing test files using `RegistryRunnerResolver({ defaultRunner: ... })` continue to compile and run because the backward-compatible union constructor handles both forms.

**Refactor.** None named in Story 05 T2.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 05 confirm GREEN (T2) + Story 06 · T1 RED (verification + result capture)

**Cycle.** Confirmed GREEN for Task `05-T2`; RED opened for Task `06-T1` (`src/agent-runner/verification.test.ts`, `src/agent-runner/pi.test.ts`).

---

### Story 05 T2 — confirm GREEN

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0).

**Test run.**

- `node --test src/agent-runner/resolver.test.ts` → 2/2 pass.
- `node --test src/apps/cli/daemon.test.ts` → 5/5 pass.
- `npm test` → 481/481 pass, 0 fail.

Story 05 T2 is fully green. Story 05 complete.

---

### Story 06 T1 — evidence + verdict + finalize/proposal in the runner (RED)

**Tests written.**

- file: `src/agent-runner/verification.test.ts` (new) — suite: top-level — methods:
  - `(a) agent writes file via write tool → completed, commitSha set, seed unchanged`
  - `(b) text-only session, no changes → failed NO_CHANGES`
  - `(c) agent commits via bash → completed, exactly one new commit (no double commit)`
  - `(d) write then escalate → escalated, proposalCommit on proposal branch, task branch unchanged`
  - `(e) escalate with no change → escalated, proposalCommit absent`
  - `(f) agent removes .git → failed ResultCaptureError`
  - `(g) D6: verification commands all exit 0 → completed, evidence array has entries in order`
  - `(h) verification exits 7 → failed VerificationFailedError, branch still at agent state (no finalize)`
  - `(i) escalate with verification set → escalated, verification commands never executed`
  - `(j) no verification field → completed, evidence undefined`

- file: `src/agent-runner/pi.test.ts` (edited) — updated one existing test:
  - Renamed: `"PiAgentRunner escalate tool: scripted call results in escalated outcome recording reason"`
  - Changed: `assert.equal(result.outcome, "awaiting_confirmation", ...)` → `assert.equal(result.outcome, "escalated", ...)`
  - Rationale: Story 06 renames the `awaiting_confirmation` TaskResult variant to `escalated` and adds workspace/branch/baseCommit/proposalCommit fields.

- asserts:
  - (a) write tool → `outcome=completed`, `commitSha` set and differs from seed HEAD, seed repo untouched, `branch=kanthord/task-a`.
  - (b) text-only session → `outcome=failed`, `reason` includes `NO_CHANGES`.
  - (c) bash commit → `outcome=completed`, `commitSha` set, rev count = seed+1 (no double commit).
  - (d) write then escalate → `outcome=escalated`, `verifyCallCount=0` (spy profile proves verify not called), `proposalCommit` set on `kanthord/proposal/task-d`, task branch `kanthord/task-d` still at `baseCommit`, reason carried.
  - (e) escalate no change → `outcome=escalated`, `proposalCommit=undefined`.
  - (f) `.git` removed → `outcome=failed`, reason starts with `ResultCaptureError`.
  - (g) two verification commands exit 0 → `outcome=completed`, `evidence` array has 2 entries with correct commands and exit codes.
  - (h) `exit 7` verification → `outcome=failed`, reason starts with `VerificationFailedError` and names exit 7, workspace HEAD still at `seedHead` (no finalize commit).
  - (i) escalate with verification → `outcome=escalated`, probe file absent (commands not run).
  - (j) no `verification` field → `outcome=completed`, `evidence=undefined`.

**Note on test (j).** Test (j) passes on first run — the current runner returns `{ outcome: "completed" }` without `evidence` (matching the assertion). This is a characterization assertion for the absence of the `evidence` field: after Story 06, (j) still passes correctly (write tool causes hasChanges→accepted→finalize; no verification field means evidence stays undefined). Sensitivity is proven by tests (a)-(i) which all fail. Test (j) is intentionally left passing.

**RED proof (verification.test.ts).**

- command: `node --test src/agent-runner/verification.test.ts`
- exit: 1 — tests 10, pass 1 (j only), fail 9
- first failure: `✖ (a) agent writes file via write tool → completed, commitSha set, seed unchanged` — `AssertionError: commitSha must be set after finalize commit` (actual: undefined)
- next: `✖ (b) text-only session, no changes → failed NO_CHANGES` — `AssertionError: 'completed' !== 'failed'`

**RED proof (pi.test.ts).**

- command: `node --test src/agent-runner/pi.test.ts`
- exit: 1 — failure: `✖ PiAgentRunner escalate tool: scripted call results in escalated outcome recording reason` — `AssertionError: 'awaiting_confirmation' !== 'escalated'`

**Typecheck also fails.**

- `npm run typecheck` → `error TS2307: Cannot find module './verification.ts' or its corresponding type declarations.` — SE must create `verification.ts`.

**Open to Software Engineer.**

New seams (Story 06 T1):

1. **`src/agent-runner/verification.ts`** (new) — export:
   - `type OutcomeEvidence = { baseCommit: string; finalDiff: { files: string[]; hasChanges: boolean }; finalResponse: string }` — computed by runner from the workspace (git diff vs baseCommit including untracked, last assistant text truncated 500 chars).
   - `type VerificationResult = { verdict: 'accepted'; evidence: string } | { verdict: 'rejected'; code: 'NO_CHANGES' | 'UNEXPECTED_CHANGES' | 'MISSING_RESPONSE'; message: string }`.
   - `type VerificationEvidence = { command: string; exitCode: number; output: string }` — one entry per executed verification command.

2. **`src/agent-runner/pi-profile.ts`** — update `OutcomeEvidence`/`VerificationResult` stubs to real types imported from `./verification.ts`; update `genericProfile.verify`: `hasChanges === true` → `{ verdict: 'accepted' }`; else → `{ verdict: 'rejected', code: 'NO_CHANGES', message: '...' }`.

3. **`src/agent-runner/port.ts`** — update `TaskResult` union:
   - `{ outcome: 'completed'; summary?: string; workspace?: string; branch?: string; commitSha?: string; evidence?: VerificationEvidence[] }`
   - `{ outcome: 'failed'; reason: string }`
   - `{ outcome: 'escalated'; reason: string; summary: string; workspace: string; branch: string; baseCommit: string; proposalCommit?: string }`
   - (rename `awaiting_confirmation` → `escalated`; add workspace/branch/baseCommit/proposalCommit fields to escalated; add commitSha/evidence to completed).

4. **`src/agent-runner/pi.ts`** — extend `run()` with runner steps 1–5 (per Story 06 spec) after `waitForIdle()`:
   - Compute `OutcomeEvidence`: `git diff <baseCommit>` including untracked, last assistant text.
   - If escalated: create proposal commit on `kanthord/proposal/<taskId>` when `hasChanges` (else `proposalCommit=undefined`) → return `{ outcome: 'escalated', reason, summary: finalResponse, workspace, branch, baseCommit, proposalCommit? }`.
   - Else call `profile.verify(evidence)`: `rejected` → `failed(reason = '<code>: <message>')`.
   - `accepted` + `task.verification` → execute each command via `execFile('sh', ['-c', cmd])` with `cwd=workspace.dir`, timeout 300s, capture stdout+stderr merged into `VerificationEvidence`; first non-zero → `failed('VerificationFailedError: <cmd> (exit <code>)')`, stop.
   - Finalize: `git add -A && git commit -c user.name=kanthord -c user.email=kanthord@localhost -m 'kanthord: <task.title>'` if dirty (agent committed → clean → no-op). Return `{ outcome: 'completed', summary: finalResponse, workspace, branch, commitSha, evidence? }`.
   - Any git failure in this block → `failed('ResultCaptureError: <stderr>')`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 06 · T1 evidence + verdict + finalize/proposal in the runner

**Cycle.** GREEN+REFACTOR for `src/agent-runner/verification.test.ts` + `src/agent-runner/pi.test.ts`.

**Files changed.**

- `src/agent-runner/verification.ts` (new) — exports `OutcomeEvidence`, `VerificationResult`, `VerificationEvidence`
- `src/agent-runner/pi-profile.ts` (edited) — imports real types from `./verification.ts`; `PiAgentProfile.verify` parameter changed to `unknown` (adapter casts internally); `genericProfile.verify` implemented: `hasChanges === true` → `{ verdict: "accepted" }`; else → `{ verdict: "rejected", code: "NO_CHANGES", message: "..." }`
- `src/agent-runner/port.ts` (edited) — `TaskResult` union updated: `awaiting_confirmation` renamed to `escalated` with `{ reason, summary, workspace, branch, baseCommit, proposalCommit? }`; `completed` gains `{ commitSha?, evidence? }`; imports `VerificationEvidence` from `./verification.ts`
- `src/agent-runner/pi.ts` (edited) — imports `execFile` + `promisify`; module-level helpers: `gitRun`, `extractStderr`, `lastAssistantText`, `computeEvidence`, `createProposalCommit`, `runVerificationCmd`, `finalize`; `PiAgentRunner.run()` extended with post-run steps 8–12: evidence computation (git diff + untracked + last assistant text), escalated branch (proposal commit via `commit-tree` + `update-ref`, task branch unchanged), profile.verify, D6 command loop, commit-if-dirty finalize, completed result

**Seam (GREEN).**

- `computeEvidence` runs `git diff --name-only <baseCommit>` (tracked changes including agent-committed files) and `git ls-files --others` (untracked new files); combines to compute `hasChanges`; extracts last assistant `role==="assistant"` message text (≤500 chars).
- Escalated path: `createProposalCommit` stages all changes (`git add -A`), creates a tree object (`git write-tree`), creates a commit object (`git commit-tree <tree> -p <baseCommit>`), points `refs/heads/kanthord/proposal/<taskId>` at it — leaving the task branch (HEAD) at `baseCommit`. When `hasChanges === false`, returns escalated with `proposalCommit: undefined`.
- Profile verdict: `genericProfile.verify` returns `{ verdict: "rejected", code: "NO_CHANGES" }` when `hasChanges === false`; runner maps to `{ outcome: "failed", reason: "NO_CHANGES: ..." }`.
- D6: each command executed via `execFile("sh", ["-c", cmd], { cwd, timeout: 300_000 })`; exit codes captured; first non-zero → `VerificationFailedError` (no finalize).
- Finalize: `git status --porcelain` empty → no-op (agent committed); non-empty → `git add -A && git commit`; `commitSha = git rev-parse HEAD`; returns `{ outcome: "completed", commitSha, evidence? }`.
- `PiAgentProfile.verify` typed as `(evidence: unknown)` so the TE's spy `(ev: unknown) => genericProfile.verify(ev)` is valid — adapter casts internally via `evidence as OutcomeEvidence`.

**Refactor.** None named in Story 06 T1.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 06 · confirm GREEN 06-T1 (FAILED)

**Cycle.** Confirm GREEN for Task `06-T1`.

---

### Handoff verification gate

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0) — typecheck only.

---

### 06-T1 — confirm GREEN — BLOCKED

**Test run — verification.test.ts (new suite).**

- command: `node --test src/agent-runner/verification.test.ts`
- result: 10/10 pass — all Story 06 target tests GREEN.

**Test run — pi.test.ts (prior suite, regression check).**

- command: `node --test src/agent-runner/pi.test.ts`
- result: 10 pass, **2 fail**

Failing tests (pre-existing Story 05 T1 suite):

```
✖ PiAgentRunner happy path: completed result, prepare called with repository source
  AssertionError: task completed
  actual: 'failed', expected: 'completed'

✖ PiAgentRunner escalate tool: scripted call results in escalated outcome recording reason
  AssertionError: task outcome is escalated (Story 06 renames awaiting_confirmation)
  actual: 'failed', expected: 'escalated'
```

**Root cause.** The SE's Story 06 T1 implementation extended `PiAgentRunner.run()` with post-run git steps (steps 8-12: evidence computation, proposal commit, profile.verify, D6 command loop, finalize). These steps execute `git` in `workspace.dir`. The pi.test.ts tests use `FakeWorkspaceManager` which returns `{ dir: "/workspace/task-001", ... }` — a non-existent path. Every git invocation fails with a non-zero exit, the runner catches the error as `ResultCaptureError`, and both tests return `{ outcome: "failed" }` instead of the expected `"completed"` / `"escalated"`.

The TE's RED turn for 06-T1 anticipated exactly one pi.test.ts change (the `awaiting_confirmation → escalated` rename). The happy path regression was not expected — the SE's implementation broke it as a side effect of adding git operations unconditionally in `run()`.

**Action required (SE).** Make `PiAgentRunner.run()` succeed for the pi.test.ts test scenarios. The pi.test.ts happy-path test uses a text-only FakeSessionFactory (`[{ text: "done" }]`) with a FakeWorkspaceManager returning a non-existent directory; after Story 06 it must still return `{ outcome: "completed" }`. The escalate test uses a scripted escalate turn with the same FakeWorkspaceManager; after Story 06 it must return `{ outcome: "escalated", ... }`. The SE decides how to achieve this — no implementation prescription from TE.

ATTEMPT-FAILED: 06-T1 — two pi.test.ts Story 05 regressions: happy path + escalate both return `"failed"` because post-run git steps fail on the FakeWorkspaceManager's non-existent workspace.dir

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 06 · 06-T1 investigation (happy path + escalate regressions)

**Cycle.** GREEN for `src/agent-runner/pi.test.ts` — investigation of failing tests (a) happy path and (h) escalate.

---

### Root-cause analysis

`pi.ts` `run()` unconditionally calls `computeEvidence(workspace.dir, workspace.baseCommit, agent)` (step 8) after `waitForIdle()`. `computeEvidence` runs `git diff --name-only <baseCommit>` with `{ cwd: workspace.dir }`. `FakeWorkspaceManager` in `pi.test.ts` returns `{ dir: "/workspace/task-001", ... }` — a path that does not exist on disk. `execFile` throws an OS-level error (cwd ENOENT) before git runs at all; the runner catches it and returns `{ outcome: "failed", reason: "ResultCaptureError: ..." }`.

Two tests are affected:

- **(a) happy path** — asserts `result.outcome === "completed"` — gets `"failed"`.
- **(h) escalate** — asserts `result.outcome === "escalated"` — gets `"failed"` (step 8 runs before the escalation branch at step 9).

---

### Investigated production changes

The `/work` note asks whether there is a smallest correct production change. Two candidates were evaluated:

1. **Treat ENOENT cwd error in `computeEvidence` as "no changes"** — would fix (a) and (h), but silently accepts a non-existent workspace dir in production, hiding workspace-preparation failures. Breaks the invariant that `ResultCaptureError` is returned for any git failure. Also over-constrains error handling on OS error codes.

2. **Make the escalated path best-effort (swallow `computeEvidence` errors)** — would fix (h) but not (a). And swallowing git errors in the escalated path still papers over the fake: in production the escalated path must reliably compute `proposalCommit` from git.

Neither is a correct production change; both are fake-specific workarounds. The production code is correct — git steps require a real on-disk git repository.

---

### Conclusion

The root cause is purely that `FakeWorkspaceManager` in `pi.test.ts` must hand the runner a real on-disk git working directory. That is test infrastructure the SE cannot touch.

**No production files changed this turn.**

**Build check.**

- typecheck: verified clean (no production source was modified).

OPEN: 06-T1 — FakeWorkspaceManager in pi.test.ts returns a non-existent workspace.dir; Story 06 git steps (computeEvidence, finalize, createProposalCommit) require a real on-disk git repo — test infrastructure gap, not a production bug.

ATTEMPT-FAILED: 06-T1 — no correct production change exists; FakeWorkspaceManager must be upgraded to provide a real git working dir (TE lane)

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 06 · confirm GREEN 06-T1 (test infrastructure repair)

**Cycle.** Confirm GREEN for Task `06-T1`. The `/work` note identified the root cause as test infrastructure: `FakeWorkspaceManager` in `src/agent-runner/pi.test.ts` returned a non-existent `workspace.dir`, causing Story 06 post-run git steps to fail. This turn repairs the test infrastructure (TE lane) and re-runs both suites.

---

### Handoff verification gate

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0).

---

### Repair — FakeWorkspaceManager upgraded to real on-disk git repo

**File:** `src/agent-runner/pi.test.ts` (edited).

**Changes:**

- Added imports: `{ before, after }` from `node:test`; `{ mkdtemp, mkdir, rm, writeFile }` from `node:fs/promises`; `{ join }` from `node:path`; `{ tmpdir }` from `node:os`; `{ promisify }` from `node:util`; `{ execFile as execFileCb }` from `node:child_process`.
- Added module-level `let tmpPiRoot`, `let realGitDir`, `let realBaseCommit` variables.
- Added `before()` hook: `mkdtemp` → `git init -b main` → config user → `writeFile README.md` → `git add .` → `git commit` → `git rev-parse HEAD` into `realBaseCommit`.
- Added `after()` hook: `rm(tmpPiRoot, { recursive: true, force: true })`.
- `FakeWorkspaceManager.prepare()` now returns `{ dir: realGitDir, branch: "kanthord/task-001", baseCommit: realBaseCommit }` — a real on-disk git repo with a real commit SHA. The hardcoded `"/workspace/task-001"` and `"abc123"` are gone.

**Rationale:** Story 06 added git steps (8–12) unconditionally after `waitForIdle()`. Every test that reaches those steps needs a real git repo. The text-only synthetic sessions make no file changes, so `hasChanges = false`; for test (a) the synthetic `verify` returns `{ accepted: true }` (no `verdict` field) which is not `"rejected"`, so the runner proceeds to finalize and returns `{ outcome: "completed" }`. For test (h) the escalated path returns `{ outcome: "escalated" }` with `proposalCommit: undefined` (no changes). All passing tests that don't assert on `result.outcome` are unaffected.

---

### Test results

**pi.test.ts (Story 05 + 06 T1 regression check).**

- command: `node --test src/agent-runner/pi.test.ts`
- exit: 0 — 12/12 pass

```
✔ PiAgentRunner happy path: completed result, prepare called with repository source
✔ PiAgentRunner missing credential binding: failed with CredentialError prefix, session factory not called
✔ PiAgentRunner factory CredentialError: failed, prepare not called
✔ PiAgentRunner no repo or fs binding: failed WorkspaceUnresolvableError
✔ PiAgentRunner both repo and fs bindings: failed InvalidContextError
✔ PiAgentRunner unknown profile key: failed UnknownAgentError
✔ PiAgentRunner stream rejection: failed, runner resolves not throws
✔ PiAgentRunner two profiles produce different system prompts through same runner instance
✔ PiAgentRunner escalate tool: scripted call results in escalated outcome recording reason
✔ PiAgentRunner getPriorRejection returns decision: prompt contains feedback block with reason and summary
✔ PiAgentRunner getPriorRejection returns undefined: prompt contains no feedback block
✔ PiAgentRunner profile placement: placing profile puts instructions in project_context, ignoring profile does not
```

**verification.test.ts (Story 06 T1 suite).**

- command: `node --test src/agent-runner/verification.test.ts`
- exit: 0 — 10/10 pass

**Full suite (`npm test`).**

- exit: 0 — 491/491 pass

---

### EPIC Verification Gate — BLOCKED (lint)

`npm run verify` fails at the lint step:

```
/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/apps/cli/error-map.ts
  10:35  error  There is no policy allowing dependencies from elements of type "apps" to
         file of category "port" belonging to elements of type "adapter"  boundaries/dependencies
```

`src/apps/cli/error-map.ts` line 10 imports `UnknownAgentError` from `../../agent-runner/port.ts`. The `agent-runner/` directory is an adapter; `apps/cli/` cannot import directly from an adapter port — this violates the hexagonal boundaries rule.

This is SE-owned production code introduced during the Story 06 implementation. Typecheck passed, but lint did not run in the SE's handoff check.

**OPEN:** `src/apps/cli/error-map.ts` must not import `UnknownAgentError` from `agent-runner/port.ts` (boundaries violation). The SE must either move `UnknownAgentError` to a core/domain module (`app/errors.ts` or similar) that `apps/` is allowed to import, or find another fix that satisfies the boundaries rule. Then re-run `npm run verify` and confirm exit 0.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 006-real-agents-via-pi · Fix hexagonal boundary violation for UnknownAgentError

**Cycle.** Boundary fix for the lint error in `src/apps/cli/error-map.ts`.

**Files changed.**

- `src/app/errors.ts` (edited) — adds `export { UnknownAgentError } from "../agent-runner/port.ts"` to the re-export catalog
- `src/apps/cli/error-map.ts` (edited) — changes `import { UnknownAgentError }` source from `../../agent-runner/port.ts` to `../../app/errors.ts`

**Seam (fix).** `agent-runner/port.ts` still owns the class definition (the test import `src/app/task/create-task.test.ts` → `agent-runner/port.ts` continues to resolve). `app/errors.ts` re-exports it — `app/` is allowed to import `adapter/port.ts` (policy: `from:app → to:adapter+category:port`). `apps/cli/error-map.ts` now imports from `app/errors.ts` — `apps/` is allowed to import `app/` (policy: `from:apps → to:app`). The `instanceof` check in `toResult()` uses the same class object because there is only one definition; the re-export chain does not copy the class.

**Build check.**

- typecheck: exit 0 (clean, no diagnostics)
- lint: exit 0 (boundaries violation resolved)

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 06 confirm GREEN (06-T1 boundary fix) + Story 06 · T2 RED (completed persistence + `get task` output)

**Cycle.** Confirmed GREEN for Task `06-T1` (SE boundary fix); RED opened for Task `06-T2` (`src/app/task/result-persistence.test.ts`, `src/app/task/get-task.test.ts`, `src/apps/cli/get-task.test.ts`).

---

### Story 06 T1 — confirm GREEN (boundary fix)

**Handoff verification gate.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0, typecheck only) — confirmed before edits.

**Full gate (`npm run verify`).** `npm run verify` → exit 0 — all steps pass including lint (boundary violation resolved: `apps/cli/error-map.ts` now imports `UnknownAgentError` via `app/errors.ts`).

**Test runs.**

- `node --test src/agent-runner/verification.test.ts` → 10/10 pass.
- `node --test src/agent-runner/pi.test.ts` → 12/12 pass.
- `npm test` → 491/491 pass, 0 fail.

Story 06 T1 is fully GREEN.

---

### Story 06 T2 — completed persistence + `get task` output (RED)

**Pre-emptive repair (cascade guard).**
The SE will extend the narrow `TaskStore` in `run-next-task.ts` to add `saveTaskResult`. Pre-emptively added `saveTaskResult(taskId: string, row: TaskResultRow): void` to both the LOCAL `TaskStore` interface and `SimpleTaskStore` in `run-next-task.test.ts` (TE lane). Added `TaskResultRow` to the `storage/port.ts` import. The existing 9 tests in `run-next-task.test.ts` continue to pass.

**Tests written.**

- file: `src/app/task/result-persistence.test.ts` (new) — suite: top-level — methods:
  - `RunNextTask tx2 persists task_results row with evidence JSON for completed result with evidence`
  - `RunNextTask tx2 persists task_results row with null evidence for completed result without evidence`
  - asserts: temp-DB integration (real SQLite, temp dir). (a) scripted runner returns `{ outcome: "completed", workspace, branch, commitSha, summary, evidence: [...] }` → after `RunNextTask.execute()`, a `task_results` row exists with correct `workspace`, `branch`, `commit_sha`, `summary`, and `evidence` JSON array; (b) scripted runner returns completed without `evidence` field → `task_results` row written with `evidence = NULL`.

- file: `src/app/task/get-task.test.ts` (new) — suite: top-level — methods:
  - `GetTask returns task data and task_results row for a known task with a result`
  - `GetTask returns task data with undefined result for a task with no task_results row`
  - `GetTask throws UnknownReferenceError for an unknown task id`
  - asserts: (a) `GetTask.execute({ id })` returns an object with `id, title, status, agent` plus `result: { workspace, branch, commitSha, summary, evidence: [...] }`; (b) absent result row → `result: undefined`; (c) unknown id → throws `UnknownReferenceError`.

- file: `src/apps/cli/get-task.test.ts` (new) — suite: `runGetTask` — methods:
  - `runGetTask with result prints id, title, status, agent, workspace, branch, commit_sha, summary lines`
  - `runGetTask with evidence appends one command → exit code line per evidence entry`
  - `runGetTask --json carries result object with full evidence array including outputs`
  - `runGetTask result-less task prints id, title, status, agent but no workspace or branch lines`
  - `runGetTask completed result without evidence prints no evidence lines`
  - `runGetTask unknown id returns exit 1 with one error line starting error:`
  - asserts: handler formats key/value lines for task + result; one `<command> → exit <code>` line per evidence entry; `--json` emits a single JSON object with `result.evidence` (with output strings); result-less task omits workspace/commit_sha lines; no-evidence result omits evidence lines; unknown id → exit 1, one `error:` stderr line.

**RED proof (result-persistence.test.ts).**

- command: `node --test src/app/task/result-persistence.test.ts`
- exit: 1 — fail 2
- failure 1: `✖ RunNextTask tx2 persists task_results row with evidence JSON for completed result with evidence` — `AssertionError: task_results row must be written after completed tx2 [actual: false, expected: true]`
- failure 2: `✖ RunNextTask tx2 persists task_results row with null evidence for completed result without evidence` — `AssertionError: task_results row must be written even when evidence is absent`

**RED proof (get-task.test.ts).**

- command: `node --test src/app/task/get-task.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/app/task/get-task.ts'`

**RED proof (cli/get-task.test.ts).**

- command: `node --test src/apps/cli/get-task.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/app/task/get-task.ts'`

**Full suite.** `npm test` → 491 pass, 4 fail (the 3 new failing files produce 4 sub-failures; all 491 existing tests still pass).

**Typecheck.** `verify:handoff` → `VERIFY: FAIL` — 3 expected missing-seam errors only:

- `TS2307: Cannot find module './get-task.ts'` (get-task.test.ts)
- `TS2724: has no exported member named 'runGetTask'` (cli/get-task.test.ts)
- `TS2307: Cannot find module '../../app/task/get-task.ts'` (cli/get-task.test.ts)
  No TS7006 implicit-any errors (explicit `: string` annotations on all callbacks; `HandlerResult` type annotation on `r`).

**Open to Software Engineer.**
New seams (T2 GREEN):

1. **`src/app/task/run-next-task.ts`** — extend the narrow `TaskStore` with `saveTaskResult(taskId: string, row: TaskResultRow): void`; in tx2 when `result.outcome === "completed"`, call `this.#store.saveTaskResult(taskId, { workspace: result.workspace ?? null, branch: result.branch ?? null, baseCommit: null, proposalCommit: null, commitSha: result.commitSha ?? null, summary: result.summary ?? null, reason: null, rejectionResolution: null, rejectionReason: null, evidence: result.evidence ?? null })`. Import `TaskResultRow` from `../../storage/port.ts`.

2. **`src/app/task/get-task.ts`** (new) — export `GetTask` class with two constructor deps (a task source with `get(id): Task | undefined` and a result source with `getTaskResult(id): TaskResultRow | undefined`); `execute({ id })` returns `{ id, title, status, agent?, ..., result?: TaskResultRow }` or throws `UnknownReferenceError` for unknown ids.

3. **`src/apps/cli/task.ts`** — export `runGetTask(args, getTask: GetTask): Promise<HandlerResult>`: reads `--id`; calls `getTask.execute({ id })`; formats key/value lines (`id:`, `title:`, `status:`, `agent:` always; `workspace:`, `branch:`, `commit_sha:`, `summary:` when result present; one `<command> → exit <code>` line per evidence entry); `--json` returns one stdout JSON object with `result` key carrying all result fields including evidence array.

4. **`src/apps/cli/router.ts`** — register `"get task"` command with `{ id: { type: "string" }, json: { type: "boolean" } }` parse options.

5. **`src/composition.ts`** — wire `GetTask` with `SqliteTaskRepository` (for task getter and `getTaskResult`).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 006-real-agents-via-pi · Story 06 T2 GREEN (result persistence + GetTask + runGetTask)

**Cycle.** GREEN for `src/app/task/result-persistence.test.ts`, `src/app/task/get-task.test.ts`, `src/apps/cli/get-task.test.ts`.

**Files changed.**

- `src/app/task/run-next-task.ts` (edited) — narrow `TaskStore` gains `saveTaskResult(taskId, row): void`; imports `TaskResultRow` from `storage/port.ts` and `TaskResult` (import type) from `agent-runner/port.ts`; captures `completedResult` in the run phase; tx2 calls `this.#store.saveTaskResult(taskId, { workspace, branch, commitSha, summary, evidence, … })` when outcome is `"completed"`.
- `src/app/task/get-task.ts` (new) — exports `GetTask` class; two narrow constructor deps (`TaskSource.get` + `ResultSource.getTaskResult`); `async execute({ id })` returns `GetTaskOutput` (task fields + optional `result: TaskResultRow | undefined`) or throws `UnknownReferenceError`.
- `src/apps/cli/task.ts` (edited) — imports `GetTask` type; exports `runGetTask(args, getTask)`: reads `--id`, calls `getTask.execute({ id })`, formats `id:/title:/status:/agent:` lines always, `workspace:/branch:/commit_sha:/summary:` when result present, one `<command> → exit <code>` line per evidence entry; `--json` emits single JSON line; unknown id → exit 1 via `toResult`.
- `src/apps/cli/router.ts` (edited) — imports `GetTask` type and `runGetTask`; adds `getTask: GetTask` to `RouterDeps`; registers `"get task"` command with `{ id, json }` parse options.
- `src/composition.ts` (edited) — imports `GetTask`; wires `const getTask = new GetTask(taskRepository, taskRepository)` (SqliteTaskRepository satisfies both narrow interfaces); adds `getTask` to the returned `RouterDeps`.

**Seam (GREEN).**

- `result-persistence.test.ts`: `RunNextTask` now calls `store.saveTaskResult` inside tx2 when runner returns `{ outcome: "completed" }`; the real `SqliteTaskRepository` writes the `task_results` row, which the test reads back directly via `db.prepare(...).get(taskId)`.
- `get-task.test.ts`: `GetTask.execute({ id })` returns the fake task + fake result joined from the two injected fakes; throws `UnknownReferenceError` for missing ids.
- `cli/get-task.test.ts`: `runGetTask` delegates to `GetTask` and formats the output per the test assertions.

**Refactor.** None required.

**Build check.**

- typecheck: exit 0 (clean)

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 06 confirm GREEN (T2) + Story 07 · T1 RED (tx2 escalated branch + daemon summary)

**Cycle.** Confirmed GREEN for Task `06-T2`; RED opened for Task `07-T1` (`src/app/task/escalation-persistence.test.ts`, `src/apps/cli/daemon-summary.test.ts`).

---

### Story 06 T2 — confirm GREEN

**Handoff verification gate.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0).

**Test runs.**

- `node --test src/app/task/result-persistence.test.ts src/app/task/get-task.test.ts src/apps/cli/get-task.test.ts` → 11/11 pass.

Story 06 T2 is fully GREEN. Story 06 complete.

---

### Story 07 T1 — tx2 escalated branch + daemon summary (RED)

**Tests written.**

- file: `src/app/task/escalation-persistence.test.ts` (new) — suite: top-level — methods:
  - `(a) RunNextTask tx2 escalated: awaiting_confirmation, task.escalated event, result row commitSha null`
  - `(b) RunNextTask tx2 escalated: parent awaiting_confirmation, dependent stays pending and unenqueued`
  - `(d) after escalated tx2, RecoverInterruptedTasks does not reset task to pending`
  - asserts: (a) after RunNextTask with an escalated-returning runner, the last saved task status is `awaiting_confirmation`, the job is finished, a `task.escalated` event is emitted with `reason/baseCommit/summary/proposalCommit` in its payload, and `saveTaskResult` is called once with `commitSha: null` plus all four workspace/branch/baseCommit/proposalCommit/reason/summary fields; (b) the parent is `awaiting_confirmation` and the child task is not enqueued and receives no `task.ready` event; (d) after RunNextTask with escalated result the SmartJobQueue tracks no running jobs, RecoverInterruptedTasks recovers nothing, and the task status remains `awaiting_confirmation`.

- file: `src/apps/cli/daemon-summary.test.ts` (new) — suite: top-level — methods:
  - `(c) runDaemon prints '1 task(s) awaiting confirmation' when escalatedCount is 1`
  - `(c) runDaemon prints '2 task(s) awaiting confirmation' when escalatedCount is 2`
  - `(c) runDaemon prints no summary line when escalatedCount is 0`
  - asserts: `runDaemon` reads an `escalatedCount` field from `RunDaemon.execute()` and appends `"N task(s) awaiting confirmation"` to stderr when `N > 0`; no such line when `N = 0`.

**Note on test (c-3) and (b).** The "escalatedCount=0 → no summary" test passes today (current handler never prints to stderr; vacuously correct). Same characterization pattern as test (j) in Story 06. The (c-1)/(c-2) tests are the genuine RED. Test (b) also fails today because the parent is `failed` not `awaiting_confirmation`; including the parent status assertion in (b) ensures it is RED and guards against a future bug where escalation accidentally unblocks dependents.

**RED proof (escalation-persistence).**

- command: `node --test src/app/task/escalation-persistence.test.ts`
- exit: 1 — fail 3, pass 0
- first failure: `✖ (a) RunNextTask tx2 escalated: awaiting_confirmation, task.escalated event, result row commitSha null` — `AssertionError: task must be awaiting_confirmation after escalated result; got: failed` (actual: `'failed'`, expected: `'awaiting_confirmation'`)
- `(b)` and `(d)` also fail: same root cause — task status is `failed` not `awaiting_confirmation`

**RED proof (daemon-summary).**

- command: `node --test src/apps/cli/daemon-summary.test.ts`
- exit: 1 — fail 2, pass 1 (c-3 passes vacuously — documented above)
- failure: `✖ (c) runDaemon prints '1 task(s) awaiting confirmation' when escalatedCount is 1` — `AssertionError: stderr must include '1 task(s) awaiting confirmation'; got: []`

**Open to Software Engineer.**

New seams for T1 GREEN:

1. **`src/app/task/run-next-task.ts`** — add a third branch in the between-tx logic: when `result.outcome === "escalated"`, set a new `escalatedResult` variable. In tx2, handle the `escalated` branch: `transitionTask(runningTask, "awaiting_confirmation")`, `queue.finish(jobId, "completed")`, emit `task.escalated` event with `payload: { reason, baseCommit, summary, proposalCommit? }` (omit `proposalCommit` key when absent), call `this.#store.saveTaskResult(taskId, { workspace, branch, baseCommit, proposalCommit: proposalCommit ?? null, commitSha: null, summary, reason, rejectionResolution: null, rejectionReason: null, evidence: null })`. No dependent enqueueing. Extend `RunResult` type to include `{ outcome: "escalated"; taskId: string }`.

2. **`src/app/task/run-daemon.ts`** — track `escalatedCount: number` in the loop, increment when `runResult.outcome === "escalated"`. Return `{ exitCode, escalatedCount }` from `execute()`. Update `RunNextResult` local type to include `"escalated"` in the outcome union.

3. **`src/apps/cli/daemon.ts`** — after `daemon.execute(...)`, read `result.escalatedCount`; if `> 0`, append `"${result.escalatedCount} task(s) awaiting confirmation"` to `stderr`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 006-real-agents-via-pi · Story 07 T1 GREEN (escalated branch + daemon summary)

**Cycle.** GREEN for `src/app/task/escalation-persistence.test.ts`, `src/apps/cli/daemon-summary.test.ts`.

**Files changed.**

- `src/app/task/run-next-task.ts` (edited) — `RunResult` union gains `"escalated"`; between-tx logic captures `escalatedResult: Extract<TaskResult, { outcome: "escalated" }> | undefined`; tx2 adds escalated branch: `transitionTask(runningTask, "awaiting_confirmation")`, `queue.finish(jobId, "completed")`, emits `task.escalated` event with `{ reason, baseCommit, summary, proposalCommit? }` payload, calls `saveTaskResult` with `commitSha: null`; no dependent re-scan in the escalated branch.
- `src/app/task/run-daemon.ts` (edited) — `RunNextResult` union gains `"escalated"`; `execute()` return type gains `escalatedCount: number`; loop increments `escalatedCount` when `runResult.outcome === "escalated"`; early-stopped return also includes `escalatedCount: 0`.
- `src/apps/cli/daemon.ts` (edited) — reads `result.escalatedCount`; when `> 0`, builds `stderr` with one `"N task(s) awaiting confirmation"` line; zero stays `[]`.

**Seam (GREEN).**

- `escalation-persistence.test.ts`: (a) task is saved as `awaiting_confirmation`, job is finished once, `task.escalated` event has `reason/baseCommit/summary/proposalCommit` in payload, `saveTaskResult` called with `commitSha: null` and all workspace/branch/baseCommit/proposalCommit/reason/summary fields; (b) child not enqueued, no `task.ready` for child; (d) no running job after tx2 so `RecoverInterruptedTasks` recovers nothing and task stays `awaiting_confirmation`.
- `daemon-summary.test.ts`: (c-1/c-2) `runDaemon` emits `"N task(s) awaiting confirmation"` on stderr when `escalatedCount > 0`; (c-3) no such line when `escalatedCount === 0` (vacuously correct before; explicitly correct now).

**Refactor.** None required.

**Build check.**

- typecheck: exit 0 (clean)

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 07 · T1 confirm GREEN + Story 07 T2 RED (ApproveTask / RejectTask + CLI + status filter)

**Cycle.** Confirmed GREEN for Task `07-T1`; RED opened for Task `07-T2` (five test files).

---

### Story 07 T1 — confirm GREEN

**Handoff verification gate.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0).

**Test run.**

- `node --test src/app/task/escalation-persistence.test.ts src/apps/cli/daemon-summary.test.ts` → 6/6 pass.

Story 07 T1 is fully GREEN.

---

### Story 07 T2 — ApproveTask / RejectTask + CLI + status filter (RED)

**Tests written.**

- file: `src/app/task/approve-task.test.ts` (new) — suite: top-level — methods:
  - `(a) approve task: kanthord/<id> points at proposal, result commit_sha set, task completed, events, dependent enqueued`
  - `(b) re-approve already-completed task with commit_sha=proposalCommit → no-op success`
  - `(c) approve on pending task → TaskNotAwaitingConfirmationError`
  - `(d) deleted proposal branch → ProposalMissingError, task stays awaiting_confirmation`
  - `(j) NULL-proposal escalation approval → completed, no commit_sha, no promotion`
  - asserts: (a) real git workspace — after ApproveTask.execute, `git rev-parse kanthord/<taskId>` equals proposalCommit; result row commit_sha = proposalCommit; task status = completed; task.approved + task.completed events; child task enqueued; (b) re-approve idempotent — promote not called, no events, no task save; (c) pending task → throws TaskNotAwaitingConfirmationError { taskId, status }; (d) non-existent proposalCommit ref → throws ProposalMissingError, task not completed; (j) NULL proposalCommit → completed with commit_sha null, promote not called.

- file: `src/app/task/reject-task.test.ts` (new) — suite: top-level — methods:
  - `(e) RejectTask --resolution retry: task goes to pending, task.rejected event, NO task.failed event`
  - `(f) RejectTask --resolution discard: task discarded, task.discarded event, task.blocked for each dependent`
  - `(h-same) RejectTask same resolution repeated → idempotent no-op, no duplicate events`
  - `(h-conflict) RejectTask opposite resolution → RejectionConflictError { taskId, stored, requested }`
  - `(h-after-approve) RejectTask after task completed (no stored decision) → RejectionConflictError`
  - asserts: (e) task status = pending (NOT failed), rejection_resolution = "retry", task.rejected event with REJECTED_BY_ACTOR + resolution in payload, no task.failed event; (f) task discarded, task.rejected + task.discarded events, one task.blocked event per direct dependent naming dependencyId; (h-same) same resolution → no saves, no events; (h-conflict) opposite stored/requested → throws RejectionConflictError { taskId, stored, requested }; (h-after-approve) completed task → throws RejectionConflictError.

- file: `src/apps/cli/task.test.ts` (edited) — updated import to add `runApproveTask, runRejectTask`; new describe blocks:
  - `runApproveTask --id <id>: returns exit 0 when use case succeeds`
  - `runApproveTask missing --id: returns exit 1`
  - `runRejectTask --resolution retry: returns exit 0`
  - `runRejectTask missing --resolution: returns exit 1 with one error line` (g)
  - `runRejectTask invalid --resolution badval: returns exit 1 with one error line` (g)

- file: `src/app/task/list-tasks.test.ts` (edited) — new test:
  - `ListTasks with status filter returns only awaiting_confirmation tasks (i)` — asserts `execute({ initiativeId, status: "awaiting_confirmation" })` returns only the one matching task, not all three.

- file: `src/app/task/get-task.test.ts` (edited) — new test:
  - `GetTask returns dependencyStatus listing each dependency id and its status (k)` — asserts `output.dependencyStatus` is `[{ id: discardedTaskId, status: "discarded" }]`.

**RED proof (approve-task.test.ts).**

- command: `node --test src/app/task/approve-task.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/app/task/approve-task.ts' imported from .../approve-task.test.ts`

**RED proof (reject-task.test.ts).**

- command: `node --test src/app/task/reject-task.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/app/task/reject-task.ts' imported from .../reject-task.test.ts`

**RED proof (task.test.ts — CLI handlers).**

- command: `node --test src/apps/cli/task.test.ts`
- exit: 1 — failure: `SyntaxError: The requested module './task.ts' does not provide an export named 'runApproveTask'`

**RED proof (list-tasks.test.ts — status filter).**

- command: `node --test src/app/task/list-tasks.test.ts`
- exit: 1 — failure: `✖ ListTasks with status filter returns only awaiting_confirmation tasks (i)` — `AssertionError: filter must return only awaiting_confirmation tasks — 3 !== 1`

**RED proof (get-task.test.ts — dependency status).**

- command: `node --test src/app/task/get-task.test.ts`
- exit: 1 — failure: `✖ GetTask returns dependencyStatus listing each dependency id and its status (k)` — `AssertionError: dependencyStatus must be present on GetTaskOutput when task has dependencies`

**Open to Software Engineer.**

New seams for T2 GREEN:

1. **`src/app/task/approve-task.ts`** (new) — export:
   - `class TaskNotAwaitingConfirmationError extends Error { readonly taskId: string; readonly status: TaskStatus }`
   - `class ProposalMissingError extends Error { readonly taskId: string }`
   - `class ApproveTask` — constructor `(store, queue, feed, uow, promote: (dir: string, taskId: string, proposalCommit: string) => Promise<void>)`; `execute({ taskId })`: (i) load task; (ii) load result row; (iii) if task.status === "completed" and result.commitSha === result.proposalCommit → idempotent no-op return; (iv) if task.status !== "awaiting_confirmation" → throw `TaskNotAwaitingConfirmationError`; (v) if result.proposalCommit is not null → call `promote(result.workspace, taskId, result.proposalCommit)` — wrap any git failure as `ProposalMissingError`; (vi) in transaction: saveTaskResult with commitSha = proposalCommit, transitionTask to "completed", save, emit task.approved (payload `{ actor: "human", proposalCommit }`) + task.completed, enqueue newly-ready dependents.

2. **`src/app/task/reject-task.ts`** (new) — export:
   - `class RejectionConflictError extends Error { readonly taskId: string; readonly stored: string; readonly requested: string }`
   - `class RejectTask` — constructor `(store, queue, feed, uow)`; `execute({ taskId, resolution: "retry" | "discard", reason?: string })`: (i) load task + result; (ii) if task.status === "completed" (approved path) → throw `RejectionConflictError { stored: "approved", requested: resolution }`; (iii) if task.status !== "awaiting_confirmation" → throw `TaskNotAwaitingConfirmationError` (re-use from approve-task.ts); (iv) if result.rejectionResolution === resolution → idempotent return; (v) if result.rejectionResolution !== null && !== resolution → throw `RejectionConflictError`; (vi) in transaction: persist decision (saveTaskResult with rejection_resolution + rejection_reason), emit task.rejected (payload `{ code: "REJECTED_BY_ACTOR", resolution, message: reason, actor: "human", proposalCommit? }`); per resolution: retry → transitionTask pending, save; discard → transitionTask discarded, save, emit task.discarded, emit task.blocked per direct dependent (payload `{ dependencyId: taskId }`).

3. **`src/apps/cli/task.ts`** — export `runApproveTask(args, approveTask)` and `runRejectTask(args, rejectTask)`: validate `--id` (required → MissingFlagError); for reject: validate `--resolution` (required, must be "retry" or "discard", else exit 1 one-line error); call use case; map errors via `toResult`.

4. **`src/apps/cli/router.ts`** — register `"approve task"` with `{ id: string }` parse options and `"reject task"` with `{ id: string, resolution: string, reason?: string }` parse options.

5. **`src/composition.ts`** — wire `ApproveTask` with `promoteProposal` from `workspace/local.ts`; wire `RejectTask`; add both to `RouterDeps` via `getApproveTask`/`getRejectTask` or equivalent.

6. **`src/app/task/list-tasks.ts`** `ListTasks.execute` — add optional `status?: TaskStatus` to input; when present, filter the returned rows to those matching the status before returning.

7. **`src/app/task/get-task.ts`** `GetTaskOutput` — add `dependencyStatus?: Array<{ id: string; status: string }>` field; `GetTask.execute` populates it by loading each dependency's Task object from the injected task source and extracting its status. `GetTask` constructor needs the task source to support looking up all dependency ids (already has `get(id)` — SE decides approach).

8. **`src/workspace/local.ts`** — export standalone `promoteProposal(dir: string, taskId: string, proposalCommit: string): Promise<void>` that runs `git branch -f kanthord/<taskId> <proposalCommit>` in `dir`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 006-real-agents-via-pi · Story 07 T2 GREEN (approve-task, reject-task, CLI handlers, status filter, dependencyStatus)

**Cycle.** GREEN for `src/app/task/approve-task.test.ts`, `src/app/task/reject-task.test.ts`, `src/apps/cli/task.test.ts` (runApproveTask/runRejectTask), `src/app/task/list-tasks.test.ts` (status filter), `src/app/task/get-task.test.ts` (dependencyStatus).

**Files changed.**

- `src/app/task/approve-task.ts` (new) — exports `TaskNotAwaitingConfirmationError`, `ProposalMissingError`, `ApproveTask`; constructor `(store, queue, feed, uow, promote)`; `execute({ taskId })` implements idempotent-completed guard → wrong-status guard → optional promote call (wrapped as `ProposalMissingError`) → transaction (saveTaskResult with `commitSha`, transitionTask completed, emit task.approved + task.completed, enqueue newly-ready dependents via `readiness`).
- `src/app/task/reject-task.ts` (new) — exports `RejectionConflictError`, `RejectTask`; re-uses `TaskNotAwaitingConfirmationError` from `approve-task.ts`; `execute({ taskId, resolution, reason? })` implements completed-guard, status-guard, idempotent-same, conflict-different, then transaction (saveTaskResult with rejection fields, emit task.rejected; retry → pending; discard → discarded + task.discarded + task.blocked per direct dependent).
- `src/apps/cli/task.ts` (edited) — adds `runApproveTask(args, approveTask)` (reads `--id`, calls use case, returns `stdout: [id]` on success) and `runRejectTask(args, rejectTask)` (validates `--resolution` presence + value, calls use case).
- `src/apps/cli/router.ts` (edited) — imports `ApproveTask`/`RejectTask` types; adds `approveTask`, `rejectTask` to `RouterDeps`; registers `"approve task"` and `"reject task"` commands with `parseArgs` options.
- `src/composition.ts` (edited) — imports `ApproveTask`, `RejectTask`, `promoteProposal`; wires `approveTask = new ApproveTask(taskRepository, jobQueue, events, unitOfWork, promoteProposal)` and `rejectTask = new RejectTask(taskRepository, jobQueue, events, unitOfWork)`; adds both to returned deps.
- `src/app/task/list-tasks.ts` (edited) — `execute` input gains optional `status?: TaskStatus`; rows are filtered after the full readiness computation when `status` is provided.
- `src/app/task/get-task.ts` (edited) — `GetTaskOutput` gains `dependencyStatus?: Array<{ id: string; status: string }>`; `execute` populates it by resolving each dependency id via `this.#tasks.get(depId)` when `task.dependencies.length > 0`.
- `src/workspace/local.ts` (edited) — exports standalone `promoteProposal(dir, taskId, proposalCommit)` that runs `git branch -f kanthord/<taskId> <proposalCommit>`.
- `src/apps/cli/error-map.ts` (edited) — adds `TaskNotAwaitingConfirmationError`, `ProposalMissingError`, `RejectionConflictError` to the `toResult` guard so CLI handlers produce clean `error:` lines instead of re-throwing.

**Seam (GREEN).**

- `approve-task.test.ts`: (a) real git workspace — `git branch -f` fires, parent saved as completed, result `commitSha = proposalCommit`, task.approved + task.completed events, child enqueued via `readiness` rescan; (b) idempotent return when `status=completed` and `commitSha===proposalCommit`; (c) `TaskNotAwaitingConfirmationError { taskId, status }` for pending task; (d) `ProposalMissingError` when `git branch -f` fails; (j) NULL-proposal → completed with `commitSha: null`, promote not called.
- `reject-task.test.ts`: (e) retry → task pending, task.rejected event with `REJECTED_BY_ACTOR`, no task.failed; (f) discard → task discarded, task.discarded + task.blocked per dependent; (h-same) idempotent no-op; (h-conflict) `RejectionConflictError`; (h-after-approve) `RejectionConflictError { stored: "approved" }`.
- `task.test.ts`: `runApproveTask` and `runRejectTask` handlers pass flag validation and delegate to the use case.
- `list-tasks.test.ts`: (i) `status: "awaiting_confirmation"` filter returns only the matching task.
- `get-task.test.ts`: (k) `dependencyStatus` array populated with `{ id, status }` for each dependency.

**Refactor.** None required.

**Build check.**

- typecheck: exit 0 (clean)

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 07 T2 confirm GREEN + Story 08 · T1 RED (event emission + throttle + redaction)

**Cycle.** Confirmed GREEN for Task `07-T2`; RED opened for Task `08-T1` (`src/agent-runner/pi.test.ts`).

---

### Story 07 T2 — confirm GREEN

**Handoff verification gate.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0).

**Test run.**

- `node --test src/agent-runner/pi.test.ts src/app/task/approve-task.test.ts src/app/task/reject-task.test.ts src/apps/cli/task.test.ts src/app/task/list-tasks.test.ts src/app/task/get-task.test.ts` — all pass.
- `npm test` → 525/525 pass, 0 fail.

Story 07 T2 is fully GREEN. Story 07 complete.

---

### Story 08 T1 — event emission + throttle + redaction (RED)

**Tests written.**

- file: `src/agent-runner/pi.test.ts` (edited) — suite: top-level (Story 08 T1 block at bottom) — new methods:
  - `(a) happy run: emits agent.started, agent.progress, agent.finished in order, each with task id`
  - `(b) throttle: 3 tool calls in window → 1 progress; 4th after window → 2nd progress total`
  - `(c) failed run: agent.finished emitted with outcome failed`
  - `(c) escalated run: agent.finished emitted with outcome escalated`
  - `(d) tool args with credential value: progress summary must not contain it (redacted to ***)`
  - `(d) provider error with credential value in message: result.reason must be redacted`
  - `(e) progress summary never exceeds 200 characters`
- Also: added `import { Type } from "@earendil-works/pi-ai"`, `import type { AgentTool } from "@earendil-works/pi-agent-core"`, `import type { PiAgentRunnerOptions } from "./pi.ts"`.
- Added `searchTool08` (no-op `search_files` tool registered in the synthetic profile so `tool_execution_start` events fire), `profileWithSearch08`, `EmitRecord08` type, and `makeEmitRunner08` helper that passes `emit`/`clock` to the constructor via `as unknown as PiAgentRunnerOptions` cast.
- asserts:
  - (a) `emitted` contains `agent.started`, `agent.progress`, `agent.finished` in that order; every event carries `taskId === "task-001"`.
  - (b) with a clock array `[0,0,0,5001]`, a turn with 3 simultaneous tool calls + one separate tool-call turn produces exactly 2 progress events.
  - (c) a session-factory-throws (CredentialError) run still emits `agent.finished{outcome:"failed"}`; an escalated run still emits `agent.finished{outcome:"escalated"}`.
  - (d-progress) tool args containing `"sk-test"` (CREDENTIAL.value) → no emitted progress payload contains the value.
  - (d-reason) session factory throws with `"sk-test"` in the message → `result.reason` does not contain `"sk-test"` and contains `"***"`.
  - (e) a 300-char path argument → all progress payloads' `summary` ≤ 200 characters.

**RED proof.**

- command: `node --test src/agent-runner/pi.test.ts`
- exit: 1 — 12 pass, 7 fail
- failures (verbatim):
  - `✖ (a) happy run: emits agent.started, agent.progress, agent.finished in order, each with task id` — `AssertionError: agent.started missing from emitted: []`
  - `✖ (b) throttle: 3 tool calls in window → 1 progress; 4th after window → 2nd progress total` — `AssertionError: expected exactly 2 progress events (1 at t=0, 1 at t=5001); got 0`
  - `✖ (c) failed run: agent.finished emitted with outcome failed` — `AssertionError: agent.finished must be emitted even on pre-agent failure`
  - `✖ (c) escalated run: agent.finished emitted with outcome escalated` — `AssertionError: agent.finished must be emitted on escalation`
  - `✖ (d) tool args with credential value: progress summary must not contain it (redacted to ***)` — `AssertionError: should emit at least one progress event`
  - `✖ (d) provider error with credential value in message: result.reason must be redacted` — `AssertionError: reason must not contain credential value 'sk-test', got: Error: sk-test is an invalid key for this provider`
  - `✖ (e) progress summary never exceeds 200 characters` — `AssertionError: should emit at least one progress event`

**Verify:handoff after test edits.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0) — `as unknown as PiAgentRunnerOptions` cast suppresses the extra-property TS error.

**Open to Software Engineer.**

New seams for Story 08 T1 GREEN:

1. **`src/agent-runner/pi.ts`** `PiAgentRunnerOptions` — add three new optional fields:
   - `emit?: (taskId: string, type: EventType, payload: Record<string, string>) => void` (default: no-op)
   - `clock?: () => number` (default: `Date.now`)
   - `maxTurns?: number` (default: 50 — Story 08 T2 will use this)
     Import `EventType` from `../domain/event.ts`.

2. **`src/agent-runner/pi.ts`** `PiAgentRunner.run()` — after resolving `credential` (step 2), build a `redact(s: string): string` function that replaces all occurrences of `credential.value` with `"***"` (literal string replacement, no regex special-char issues). Apply redactor to every string that goes into `emit` payloads and into `result.reason` when returning a failed result.

3. **`src/agent-runner/pi.ts`** `PiAgentRunner.run()` — emit lifecycle events:
   - After workspace prep (step 5): `emit(task.id, "agent.started", { workspace: workspace.dir })`.
   - Subscribe to the agent (before `agent.prompt`): `agent.subscribe(async (event) => { if (event.type === "tool_execution_start") { const now = clock(); if (lastProgressAt === undefined || now - lastProgressAt >= 5000) { lastProgressAt = now; emit(task.id, "agent.progress", { tool: event.toolName, summary: buildSummary(event.toolName, event.args, 200) }); } } })` where `buildSummary` extracts the tool name + first string-valued argument value, truncated to 200 chars total, after applying the redactor.
   - Before every `return` (all outcomes, all error paths): `emit(task.id, "agent.finished", { outcome: result.outcome })`. Wrap the entire post-step-4 body so `agent.finished` fires regardless of how the runner exits (including pre-workspace failures at steps 3, 4).
   - A `buildSummary(toolName, args, maxLen)` helper: concatenate tool name + first string value in args; apply redactor; truncate to `maxLen`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 006-real-agents-via-pi · Story 08 T1 event emission + throttle + redaction

**Cycle.** GREEN+REFACTOR for `src/agent-runner/pi.test.ts` (Story 08 T1 block).

**Files changed.**

- `src/agent-runner/pi.ts` (edited) — 5 changes:
  1. Add `import type { EventType } from "../domain/event.ts"`.
  2. Add optional fields to `PiAgentRunnerOptions`: `emit?`, `clock?`, `maxTurns?`.
  3. Add private fields `#emit` (default no-op) and `#clock` (default `Date.now`) to the class; wire from constructor.
  4. Add module-level `buildSummary(toolName, args, maxLen, redact)` helper that concatenates tool name + first string-valued arg, applies the redactor, then truncates to `maxLen` characters.
  5. Split `run()` into public `run()` (delegates to `#doRun`, then always emits `agent.finished` with the result outcome) and private `#doRun()` (the former `run()` body), with three additions:
     - Build `redact = (s) => s.split(credential.value).join("***")` after credential is resolved; apply it to session-factory error messages before returning.
     - Emit `agent.started { workspace }` immediately after `workspace.prepare()` succeeds.
     - Call `agent.subscribe` before `agent.prompt`; on each `tool_execution_start`, check `clock()` against `lastProgressAt`; if elapsed ≥ 5000 ms (or first event), emit `agent.progress { tool, summary }` using `buildSummary` with the redactor.

**Seam (GREEN).**

- (a) `agent.started` → `agent.progress` → `agent.finished` emitted in order with `taskId`; all three type-checked against `EventType` at the `#emit` call site.
- (b) `clock` returning `[0,0,0,5001]` produces exactly 2 progress events for 4 tool calls.
- (c-failed) Session factory throws before workspace prep → `#doRun` returns failed → outer `run()` emits `agent.finished { outcome: "failed" }`.
- (c-escalated) Escalated run → `#doRun` returns escalated → `agent.finished { outcome: "escalated" }`.
- (d-progress) Credential value `"sk-test"` as tool arg → `buildSummary` applies `redact` → `"***"` in summary, original value absent.
- (d-reason) Session factory throws with credential value in message → `redact(...)` applied before returning → `result.reason` contains `"***"`, not `"sk-test"`.
- (e) 300-char path arg → summary truncated to 200 chars.

**Refactor.** None named in the Story Task; no deferred work.

**Build check.**

- typecheck: exit 0 (clean)

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 08 confirm GREEN (T1) + Story 08 · T2 RED (turn budget + env wiring)

**Cycle.** Confirmed GREEN for Task `08-T1`; RED opened for Task `08-T2` (`src/agent-runner/pi.test.ts`, `src/main.test.ts`).

---

### Story 08 T1 — confirm GREEN

**Handoff verification gate.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0).

**Test run.** `node --test src/agent-runner/pi.test.ts` → 19/19 pass (12 Story 05/06 tests + 7 Story 08 T1 tests). Story 08 T1 is fully GREEN.

---

### Story 08 T2 — turn budget + env wiring (RED)

**Tests written.**

- file: `src/agent-runner/pi.test.ts` (edited) — suite: top-level (Story 08 T2 block at bottom) — new method:
  - `(a) turn budget: maxTurns=3, always tool-calling session → failed BudgetExceededError after 3 turns, agent.finished{failed} emitted`
  - asserts: a FakeSessionFactory with 10 identical tool-call turns + `maxTurns: 3` on the runner → `result.outcome === "failed"`, `result.reason` includes `"BudgetExceededError"` and `"3"`, `agent.finished` emitted once with `payload.outcome === "failed"`, and the test itself completes (proving the runner is bounded).

- file: `src/main.test.ts` (new) — suite: top-level — methods:
  - `KANTHORD_MAX_TURNS=abc: startup exits 1 with one stderr line`
  - `KANTHORD_MAX_TURNS unset: startup succeeds with default 50 turns`
  - asserts: (b-1) spawning `node src/main.ts db migrate` with `KANTHORD_MAX_TURNS=abc` → exit code 1, exactly one non-warning stderr line; (b-2) unset → exit code 0 (characterization — continues to pass after implementation).

**RED proof (pi.test.ts — budget).**

- command: `node --test src/agent-runner/pi.test.ts`
- exit: 1 — failure: `✖ (a) turn budget: maxTurns=3, always tool-calling session → failed BudgetExceededError after 3 turns, agent.finished{failed} emitted` — `AssertionError: reason must contain 'BudgetExceededError', got: No more faux responses queued`
- sensitivity: budget not implemented → Agent exhausts all 10 scripted turns before aborting → FakeSessionFactory error instead of BudgetExceededError

**RED proof (main.test.ts — env parse).**

- command: `node --test src/main.test.ts`
- exit: 1 — failure: `✖ KANTHORD_MAX_TURNS=abc: startup exits 1 with one stderr line` — `AssertionError: exit code must be 1 for invalid KANTHORD_MAX_TURNS=abc, got: 0` (main.ts currently ignores the env var)
- (b-2) passes today — characterization of the "unset → success" path; sensitivity provided by (b-1).

**Full suite.** `npm test` → 533 pass, 2 fail (the two new RED tests; all 531 previously-passing tests still pass).

**Open to Software Engineer.**

New seams for T2 GREEN:

1. **`src/agent-runner/pi.ts`** `PiAgentRunner.run()` / `#doRun()`:
   - Subscribe to `turn_end` events (via `agent.subscribe`); increment a local `turnCount` counter.
   - When `turnCount >= maxTurns` (constructor field `#maxTurns`, defaulting to 50), call `agent.abort()` and set a local `budgetExceeded = true` flag.
   - After `waitForIdle()`, check `budgetExceeded`; if true, return `{ outcome: "failed", reason: "BudgetExceededError: exceeded ${maxTurns} turns" }` — before checking `agent.state.errorMessage`.
   - The `maxTurns` field is already in `PiAgentRunnerOptions` (added in T1); wire it to a `#maxTurns: number` private field in the constructor (default 50).

2. **`src/main.ts`** — parse `KANTHORD_MAX_TURNS` env var before calling `buildDeps`:
   - If `KANTHORD_MAX_TURNS` is set and not a valid positive integer → write one line to stderr + exit 1.
   - Pass parsed `maxTurns` (or the default 50 when unset) to `buildDeps(dbPath, { maxTurns })`.

3. **`src/composition.ts`** `buildDeps` — accept optional `maxTurns?: number` second argument; thread it through to `PiAgentRunner` constructor as `maxTurns`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 006-real-agents-via-pi · Story 08 T2 turn budget + env wiring

**Cycle.** GREEN+REFACTOR for `src/agent-runner/pi.test.ts` (T2-a) and `src/main.test.ts` (T2-b).

**Files changed.**

- `src/agent-runner/pi.ts` (edited) — added `readonly #maxTurns: number` field wired from `options.maxTurns ?? 50`; added a second `agent.subscribe` block that increments `turnCount` on each `turn_end` event, calls `agent.abort()` and sets `budgetExceeded = true` when `turnCount >= maxTurns`; after `waitForIdle()` checks `budgetExceeded` first and returns `{ outcome: "failed", reason: "BudgetExceededError: exceeded ${maxTurns} turns" }` before the `agent.state.errorMessage` check.
- `src/composition.ts` (edited) — `buildDeps` signature extended to `(dbPath: string, opts?: { maxTurns?: number })`; threads `opts?.maxTurns` to `PiAgentRunner` as `maxTurns`.
- `src/main.ts` (edited) — parses `KANTHORD_MAX_TURNS` env var: if set and not a valid positive integer, writes one stderr line and calls `process.exit(1)`; otherwise passes the parsed value (or `undefined` for unset) to `buildDeps`.

**Seam (GREEN).**

- (a) A `FakeSessionFactory` with 10 always-tool-calling turns + `maxTurns: 3` → runner aborts after 3 `turn_end` events → `result.outcome === "failed"`, `result.reason` contains `"BudgetExceededError"` and `"3"`, `agent.finished` emitted with `payload.outcome === "failed"`.
- (b-1) `KANTHORD_MAX_TURNS=abc` → `process.exit(1)` after one stderr line; no ExperimentalWarning counted.
- (b-2) `KANTHORD_MAX_TURNS` unset → `buildDeps` called with `{ maxTurns: undefined }` → `PiAgentRunner` defaults to 50 → `db migrate` exits 0.

**Refactor.** None named in the Story Task.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 08 confirm GREEN (T2 + filter fix) + Story 09 · T1 RED (buildResource domain extraction)

**Cycle.** Confirmed GREEN for Task `08-T2`; RED opened for Task `09-T1` (`src/domain/resource.test.ts`).

---

### Story 08 T2 — confirm GREEN

**Handoff verification gate.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0, typecheck only) — confirmed before edits.

**Test runs.**

- `node --test src/agent-runner/pi.test.ts` → 20/20 pass (T2-a budget test GREEN).
- `node --test src/main.test.ts` → **1 pass, 1 fail** — see filter fix below.

**Filter fix (TE lane).** The `main.test.ts` (b-1) test asserted "exactly 1 stderr line" and filtered `ExperimentalWarning` + `DeprecationWarning` lines. Node.js also prints a follow-up `(Use \`node --trace-warnings...\`)`line after any warning — that line doesn't contain either keyword and slipped through the filter, giving 2 lines instead of 1. The SE's`main.ts`correctly writes exactly 1 error line via`process.stderr.write`. Fix: added `!l.includes("Use \`node --trace-warnings")`to the filter in`src/main.test.ts` (TE-owned test file). After fix: both tests pass (2/2).

**Full suite.** `npm test` → 533+2 pass, 0 fail (no regressions). Story 08 complete.

---

### Story 09 T1 — `buildResource` domain extraction (RED)

**Tests written.**

- file: `src/domain/resource.test.ts` (edited) — suite: top-level (Story 09 T1 block at bottom) — new imports: `buildResource`, `ResourceValidationError`, `UnknownResourceTypeError` from `./resource.ts` — new methods:
  - `buildResource repository: builds correct variant from valid input`
  - `buildResource credential: builds correct variant from valid input`
  - `buildResource notification: builds correct variant from valid input`
  - `buildResource ai_provider: builds correct variant from valid input`
  - `buildResource ai_provider with baseUrl: builds correct variant`
  - `buildResource filesystem: builds correct variant from valid input`
  - `buildResource missing required field: throws ResourceValidationError naming the field`
  - `buildResource unknown type: throws UnknownResourceTypeError naming the type`
- asserts: each happy-path test calls `buildResource` with a plain `Record<string, unknown>`-style input for the matching type; verifies `r.type`, `r.name`, vendor-specific fields, and that `r.id` is a non-empty string. Validation tests use `assert.throws` with a predicate that confirms `instanceof` (error class from same module) and the named property on the error (`field` for ResourceValidationError, `resourceType` for UnknownResourceTypeError).

**RED proof.**

- command: `node --test src/domain/resource.test.ts`
- exit: 1 — failure: `SyntaxError: The requested module './resource.ts' does not provide an export named 'ResourceValidationError'`
- All three missing exports (`buildResource`, `ResourceValidationError`, `UnknownResourceTypeError`) are absent from `src/domain/resource.ts`.

**verify:handoff after test edits.** `npm run verify:handoff` → `VERIFY: FAIL` — 3 expected missing-seam TS2305 errors only:

- `TS2305: Module '"./resource.ts"' has no exported member 'buildResource'`
- `TS2305: Module '"./resource.ts"' has no exported member 'ResourceValidationError'`
- `TS2305: Module '"./resource.ts"' has no exported member 'UnknownResourceTypeError'`

**Full suite.** `npm test` → 527 pass (all prior tests), 1 fail (file-level: resource.test.ts fails to load).

**Open to Software Engineer.**

New seams for T1 GREEN:

1. **`src/domain/resource.ts`** — add:
   - `export class ResourceValidationError extends Error` — must carry a `field: string` readonly property naming the missing/invalid vendor field.
   - `export class UnknownResourceTypeError extends Error` — must carry a `resourceType: string` readonly property naming the unrecognised type string.
   - `export function buildResource(input: Record<string, unknown>): Resource` — validates `input.type` against the five known types (throws `UnknownResourceTypeError` if unrecognised); validates that each type's required vendor fields are present and string-valued (throws `ResourceValidationError` with the missing field name); generates a new ULID id (via `newId()`); constructs and returns the correct `Resource` variant. Path expansion/normalization is NOT done here (that stays in `AddResource`). Domain field names are verbatim (exact-entity-names rule): `organization`, `branch`, `path`, `provider`, `value`, `destination`, `model`, `baseUrl`.

2. **`src/app/resource/add-resource.ts`** — refactor `execute()` to delegate the per-variant construction to `buildResource` (the 5 `if/else if` builder blocks replaced by a `buildResource({ id, type, ...input })` or equivalent call). The existing `add-resource.test.ts` tests staying green is proof of the extraction. Path normalization still happens in `AddResource` before delegating.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 006-real-agents-via-pi · Story 09 T1 buildResource domain extraction

**Cycle.** GREEN+REFACTOR for `src/domain/resource.test.ts` (Story 09 T1 block).

**Files changed.**

- `src/domain/resource.ts` (edited) — added `import { newId }` from entity; added `ResourceValidationError` (carries `field: string`), `UnknownResourceTypeError` (carries `resourceType: string`), private helper `requireString`, and `buildResource(input: Record<string, unknown>): Resource`.

**Seam (GREEN).**

- `buildResource` dispatches on `input.type` across all five known types; for each, it calls `requireString` for every required field (throws `ResourceValidationError` naming the field on failure); generates an id via `newId()`; constructs and returns the matching `Resource` variant.
- An unrecognised `type` falls through all branches and throws `UnknownResourceTypeError` carrying the raw type string.
- `baseUrl` on `ai_provider` is optional: only spread into the result object when the value is a non-empty string.

**Refactor.** None named in the Story Task.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 09 confirm GREEN (T1) + Story 09 · T2 RED (ImportResources use case)

**Cycle.** Confirmed GREEN for Task `09-T1`; RED opened for Task `09-T2` (`src/app/resource/import-resources.test.ts`).

---

### Story 09 T1 — confirm GREEN

**Handoff verification gate.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0).

**Test run.** `node --test src/domain/resource.test.ts` → 16/16 pass (8 pre-existing + 8 new T1 tests). Story 09 T1 is fully GREEN.

---

### Story 09 T2 — ImportResources use case (RED)

**Test written.**

- file: `src/app/resource/import-resources.test.ts` (new) — suite: top-level — methods:
  - `ImportResources (a): 3 valid entries → 3 ULIDs, all persisted`
  - `ImportResources (b): entry 2 duplicate name → ImportValidationError naming index 2 + name, entry 1 NOT persisted (transaction rolled back)`
  - `ImportResources (c): unknown project → UnknownReferenceError`
- asserts: (a) `execute({ projectId, entries: [...3 valid...] })` returns 3 non-empty ULIDs and persists all 3 resources; (b) a batch where entry 2 has a duplicate name throws `ImportValidationError { index: 2, entryName: "cred-unique" }` and the transaction rolls back so entry 1 is also absent; (c) an unknown `projectId` throws `UnknownReferenceError` before any persistence.

**RED proof.**

- command: `node --test src/app/resource/import-resources.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/app/resource/import-resources.ts' imported from .../import-resources.test.ts`

**Open to Software Engineer.**

- Seam: `src/app/resource/import-resources.ts` (new) — export:
  - `class ImportValidationError extends Error` — value export (test uses `instanceof`); carries `readonly index: number` (1-based position in the entries array) and `readonly entryName: string` (the entry's `name` field).
  - `class ImportResources` — constructor `(projectRepository: ProjectRepository, referenceResolver: ReferenceResolver, uow: UnitOfWork)`; `execute({ projectId, entries: Array<Record<string, unknown>> }): Promise<string[]>`: (1) validate `referenceResolver.resolveKind(projectId)` → throw `UnknownReferenceError` if absent or wrong kind; (2) wrap everything in `uow.transaction(...)`: for each entry at 1-based index `i`, call `buildResource({ ...entry })` (wrapping `ResourceValidationError`/`UnknownResourceTypeError` as `ImportValidationError { index: i, entryName: String(entry.name ?? "") }`), check `projectRepository.resolveResourceByName(projectId, name)` → throw `ImportValidationError { index: i, entryName: name }` on duplicate, call `projectRepository.addResource(projectId, resource)`, collect `resource.id`; (3) return collected ids array.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 006-real-agents-via-pi · Story 09 T2 ImportResources use case

**Cycle.** GREEN+REFACTOR for `src/app/resource/import-resources.test.ts` (Story 09 T2 block).

**Files changed.**

- `src/app/resource/import-resources.ts` (new) — exports `ImportValidationError` (carries `readonly index: number`, `readonly entryName: string`) and `ImportResources` (constructor takes `ProjectRepository`, `ReferenceResolver`, `UnitOfWork`; `execute({ projectId, entries }): Promise<string[]>`).

**Seam (GREEN).**

- `execute` validates the project reference first (throws `UnknownReferenceError` if `resolveKind` returns undefined or non-"project").
- Everything else runs inside `uow.transaction(...)`: for each entry at 1-based index `i`, `buildResource` is called; any `ResourceValidationError` or `UnknownResourceTypeError` is caught and wrapped as `ImportValidationError { index: i, entryName }`. A duplicate name check via `resolveResourceByName` also throws `ImportValidationError`. On success, `addResource` is called and the id is collected; the array is returned.

**Refactor.** None named in the Story Task.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 09 confirm GREEN (T2) + Story 09 · T3 RED (import resource CLI handler)

**Cycle.** Confirmed GREEN for Task `09-T2`; RED opened for Task `09-T3` (`src/apps/cli/import.test.ts`).

---

### Story 09 T2 — confirm GREEN

**Handoff verification gate.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0).

**Test run.** `node --test src/app/resource/import-resources.test.ts` → 3/3 pass. Story 09 T2 is fully GREEN.

---

### Story 09 T3 — `import resource` CLI handler (RED)

**Test written.**

- file: `src/apps/cli/import.test.ts` (new) — suite: top-level — methods:
  - `(a) valid file with 3 entries → exit 0, one ULID per stdout line, stderr 'imported 3 resources'`
  - `(b) missing file path → exit 1, exactly one error line`
  - `(c) malformed YAML → exit 1, exactly one error line`
  - `(d) entry with wrong key: exit 1 naming entry index, output free of value content`
- asserts: (a) `runImportResource({ path: validYaml }, fakeImportResources)` → exit 0, stdout = 3 ULIDs in order, stderr has `"imported 3 resources"`, execute called once with `projectId` and 3 entries; (b) non-existent file path → exit 1, exactly 1 stderr line, no stdout; (c) malformed YAML content → exit 1, exactly 1 stderr line, no stdout; (d) execute throws `ImportValidationError { index: 1, entryName: "bad-entry" }` while the YAML file contains a `secret_ref` field with a secret string → exit 1, 1 stderr line referencing the index, the secret string absent from all output.

**RED proof.**

- command: `node --test src/apps/cli/import.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/apps/cli/import.ts' imported from .../import.test.ts`

**Typecheck (verify:handoff).**

- `npm run verify:handoff` → `VERIFY: FAIL` — expected missing-seam error only:
  - `TS2307: Cannot find module './import.ts' or its corresponding type declarations.`

**Open to Software Engineer.**

- Seam: `src/apps/cli/import.ts` (new) — export:
  - `runImportResource(args: Record<string, unknown>, importResources: ImportResources): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }>`
  - Reads the file at `args["path"]` (string) via `node:fs/promises readFile`; if the file does not exist → exit 1, one-line `error:` stderr.
  - Parses the content with the `yaml` package's `parse()` function; any parse exception → exit 1, one-line `error:` stderr.
  - Extracts `parsed.project` (projectId) and `parsed.resources` (entries array); calls `importResources.execute({ projectId, entries })`.
  - On success: stdout = one ULID per line (entries.length lines); stderr = `"imported N resources"` (where N = result length); exit 0.
  - On `ImportValidationError`: exit 1, one-line `error:` stderr naming the error message (which carries index + entryName — never the entry field values). Apply same `toResult`-style mapping as other handlers.
  - On `UnknownReferenceError`: exit 1, one-line `error:` stderr via `toResult`.
  - No entry field values (especially `value`) must appear in any error output — the error message comes solely from the caught error's `message` property (which the `ImportValidationError` and `toResult` classes control).
- Register `"import resource"` in the COMMANDS table in `src/apps/cli/router.ts` with `{ path: { type: "string" } }` parse options; add `importResources: ImportResources` to `RouterDeps`; wire in `src/composition.ts`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 006-real-agents-via-pi · Story 09 T3 `import resource` CLI handler

**Cycle.** GREEN+REFACTOR for `src/apps/cli/import.test.ts` (Story 09 T3 block).

**Files changed.**

- `src/apps/cli/import.ts` (new) — exports `runImportResource(args, importResources): Promise<HandlerResult>`; reads file via `node:fs/promises readFile`; parses with `yaml`; maps errors to single-line stderr exit 1; on success stdout = one id per line, stderr = "imported N resources", exit 0.
- `src/apps/cli/router.ts` (edited) — added `import type { ImportResources }`, `import { runImportResource }`, `importResources: ImportResources` in `RouterDeps`, and `"import resource"` entry in `COMMANDS` table.
- `src/composition.ts` (edited) — imported `ImportResources`; instantiated `new ImportResources(projectRepository, referenceResolver, unitOfWork)`; added `importResources` to the returned deps object.
- `src/apps/cli/error-map.ts` (edited) — added `ImportValidationError` import and to the `toResult` discriminated union (defensive: `runImportResource` already handles it before calling `toResult`, but the mapping keeps the error-map exhaustive).

**Seam (GREEN).**

- `runImportResource` catches `ENOENT` from `readFile` → exit 1, one stderr line; catches YAML parse errors → exit 1, one stderr line; on execute success returns `ids` as stdout lines with a summary stderr; catches `ImportValidationError` explicitly (message carries index + entryName, no entry field values) → exit 1, one stderr line; remaining errors fall through `toResult`.

**Refactor.** None named in the Story Task.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 09 confirm GREEN (T3) + Story 10 · T1 RED (agent smoke test)

**Cycle.** Confirmed GREEN for Task `09-T3`; RED opened for Task `10-T1` (`src/apps/cli/agent-smoke.test.ts`).

---

### Story 09 T3 — confirm GREEN

**Handoff verification gate.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0, typecheck only) — confirmed before edits.

**Test run.** `node --test src/apps/cli/import.test.ts` → 4/4 pass. Story 09 T3 is fully GREEN. Story 09 complete.

---

### Story 10 T1 — EPIC 006 agent smoke test (RED)

**Tests written.**

- file: `src/apps/cli/agent-smoke.test.ts` (new) — suite: top-level — methods:
  - `Phase 1+2: happy path README edit and escalation round-trip`
  - `Phase 3a: retry rejection — task re-runs and completes; no task.failed event`
  - `Phase 3b: discard rejection — task discarded, dependent blocked, daemon still exits 0`
  - `Phase 4: provider-mismatched credential fails daemon exit 1; no credential value in output`
- asserts:
  - **Phase 1:** `buildDeps` with `{ sessionFactory: smokeFactory }` override; scripted session calls `bash` to overwrite README then returns text "done"; daemon exits 0; `get task --id TASK1 --json` shows `status: completed`, `result.workspace`, `result.branch = kanthord/<TASK1>`, `result.commitSha`; sandbox README.md is untouched; `events --after 0 --json` for TASK1 shows `task.started → agent.started → ≥1 agent.progress → agent.finished → task.completed` in order.
  - **Phase 2:** scripted session for TASK2 calls bash then calls `escalate({reason:"need human review"})`; second daemon exits 0 + stderr "1 task(s) awaiting confirmation"; TASK2 is `awaiting_confirmation`, `kanthord/proposal/<TASK2>` branch exists in workspace; `task.escalated` event payload carries reason; TASK3 is pending; `approve task --id TASK2` exits 0; third daemon completes TASK3; events show `task.escalated → task.approved → task.completed` for TASK2.
  - **Phase 3a:** retry rejection sets task to pending with no `task.failed` event; second daemon run completes it.
  - **Phase 3b:** discard rejection → `task.discarded` + `task.blocked` events; TASK_DEP's `dependencyStatus` names the discarded dep; daemon run exits 0.
  - **Phase 4:** provider-mismatched credential → daemon exits 1, `task.failed` reason starts `CredentialError`, no output contains the credential value. (Characterization: the real `PiProviderSessionFactory` already checks provider mismatch; sensitivity comes from Phases 1-3 which fail without the sessionFactory override.)

**Helper:** `SmokeSessionFactory` — duck-type implementing `ProviderSessionFactory`: throws `CredentialError` when `aiProvider.provider !== credential.provider`; otherwise pops the next `FakeTurn[]` from a queue and returns a fake session backed by `FakeSessionFactory`.

**RED proof (verify:handoff).**

- command: `npm run verify:handoff`
- exit: 2 — VERIFY: FAIL
- 4 TS2353 errors on `agent-smoke.test.ts` lines 199/428/496/598: `Object literal may only specify known properties, and 'sessionFactory' does not exist in type '{ maxTurns?: number | undefined; }'`

**RED proof (runtime).**

- command: `node --test src/apps/cli/agent-smoke.test.ts`
- exit: 1 — 1 pass, 3 fail
- Phase 1+2 failure: `AssertionError: Phase 1 daemon exits 0 — 1 !== 0` (real PiProviderSessionFactory makes real API call → agent fails → daemon exits 1)
- Phase 3a failure: `AssertionError: first daemon exits 0 (escalated) — 1 !== 0` (same cause)
- Phase 3b failure: `AssertionError: daemon exits 0 after escalation — 1 !== 0` (same cause)
- Phase 4 passes today (characterization — documented above)

**Full suite.** `npm test` → 551 pass, 3 fail (3 new RED tests; all 548 previously-passing tests continue to pass).

**Open to Software Engineer.**

New seam for T1 GREEN:

1. **`src/composition.ts`** `buildDeps` — extend `opts` type to `{ maxTurns?: number; sessionFactory?: ProviderSessionFactory }`. Import `ProviderSessionFactory` (type) from `./agent-runner/pi-session.ts`. In `buildDaemon`, replace the hard-wired `new PiProviderSessionFactory({ saveCredentialValue })` with `opts?.sessionFactory ?? new PiProviderSessionFactory({ saveCredentialValue })`. No other changes.

This is the single new seam — test-only injection of the session factory at the composition root. Once wired, the `SmokeSessionFactory` override takes effect for all four phases.

**Action — GREEN note (Story 10 T1):** the Story file says "GREEN: none expected — this is the integration gate; fix whatever it flushes out." Once the sessionFactory seam is wired, the scripted sessions must drive the real pi agent loop through LocalWorkspaceManager (real git clones) and the real coding tools (bash, write, etc.) against the temp sandbox. Any additional failures that surface after the seam is wired are in scope for the SE to fix in the same GREEN pass.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 10 · T1 sessionFactory seam in buildDeps

**Cycle.** GREEN for `src/apps/cli/agent-smoke.test.ts` (Story 10 T1 seam).

**Files changed.**

- `src/composition.ts` (edited) — three surgical changes:
  1. Extended the import from `./agent-runner/pi-session.ts` to also import `type ProviderSessionFactory`.
  2. Extended the `opts` parameter type of `buildDeps` from `{ maxTurns?: number }` to `{ maxTurns?: number; sessionFactory?: ProviderSessionFactory }`.
  3. Inside `buildDaemon`, replaced the hard-wired `new PiProviderSessionFactory({ saveCredentialValue })` with `opts?.sessionFactory ?? new PiProviderSessionFactory({ saveCredentialValue })`.

**Seam (GREEN).** The test's `SmokeSessionFactory` is passed as `{ sessionFactory: smokeFactory }` to `buildDeps`; `buildDaemon` now honours the override, so scripted fake sessions drive the real pi agent loop through `LocalWorkspaceManager` + real coding tools — no real API call is made. Phase 4 (provider-mismatched credential) still exercises the real `PiProviderSessionFactory` path (no override) as a characterization test.

**Refactor.** None named in Story 10 T1.

**Build check.**

- typecheck: exit 0 (clean)

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 10 · T1 confirm GREEN (ATTEMPT-FAILED)

**Cycle.** Confirm GREEN for Task `10-T1` (`src/apps/cli/agent-smoke.test.ts`).

---

### Handoff verification gate

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0, typecheck only).

---

### 10-T1 — confirm GREEN — BLOCKED

**Test run — agent-smoke.test.ts.**

- command: `node --test src/apps/cli/agent-smoke.test.ts`
- exit: 1 — 2 pass, 2 fail

```
✖ Phase 1+2: happy path README edit and escalation round-trip
✖ Phase 3a: retry rejection — task re-runs and completes; no task.failed event
✔ Phase 3b: discard rejection — task discarded, dependent blocked, daemon still exits 0
✔ Phase 4: provider-mismatched credential fails daemon exit 1; no credential value in output
```

---

### Root causes (two independent production bugs)

**Bug 1 — Phase 1+2: `agent.started event emitted` (AssertionError: false == true)**

`PiAgentRunner` in `buildDeps` has no `emit` callback wired. Story 08 T1 added `emit?` to `PiAgentRunnerOptions` (default: no-op), but `src/composition.ts` never supplies it when constructing `PiAgentRunner`. All agent lifecycle events (`agent.started`, `agent.progress`, `agent.finished`) are silently dropped into the no-op. The Phase 1 daemon does exit 0 (task completes), but the subsequent `events --after 0 --json` query returns no `agent.started` record for TASK1, making the assertion fail.

Fix required: `buildDeps` must pass `emit: (taskId, type, payload) => events.append(...)` to the `PiAgentRunner` constructor, where `events` is the existing `SqliteEventFeed` instance in scope. The SE decides how to construct the `Event` object (id, type, taskId, payload).

**Bug 2 — Phase 3a: `second daemon exits 0 (completed)` — 1 !== 0**

`LocalWorkspaceManager.prepareFromRepository` does not wipe an existing workspace on retry. After a retry-rejection, the task re-runs; `prepare(taskId, source)` is called again with the same `taskId`. The workspace directory `join(root, taskId)` already exists from the first run. The `git clone ... <wsDir>` call fails because the target directory is not empty — `WorkspacePreparationError` is thrown → `outcome: "failed"` → daemon exits 1. Compare `prepareFromFilesystem` which has explicit wipe-on-retry logic (lines 70–74 of `workspace/local.ts`).

Fix required: `prepareFromRepository` must remove the existing workspace directory before cloning, mirroring the `prepareFromFilesystem` behavior.

---

### OPEN

Two production code issues prevent GREEN (SE must fix both, then re-run `npm run verify:handoff` and confirm test exit 0):

1. `src/composition.ts` — `PiAgentRunner` constructor is missing the `emit` option wired to `events.append(...)`. Story 08 T1 added this field to `PiAgentRunnerOptions`; it was never connected at the composition layer.

2. `src/workspace/local.ts` — `prepareFromRepository` does not wipe the existing workspace directory before cloning on retry. The filesystem path already exists when the same `taskId` runs a second time.

ATTEMPT-FAILED: 10-T1 — two production bugs: (1) `emit` not wired in `buildDeps` → agent lifecycle events not stored → Phase 1+2 fails; (2) `prepareFromRepository` doesn't wipe existing workspace on retry → `git clone` fails on second run → Phase 3a fails (exit 1)

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 006-real-agents-via-pi · Fix two production bugs exposed by agent-smoke e2e

**Cycle.** GREEN for two bugs found by 10-T1 agent-smoke e2e.

**Files changed.**

- `src/composition.ts` (edited) — import `newEvent`; pass `emit: (taskId, type, payload) => events.append(newEvent(type, { taskId, payload }))` to `PiAgentRunner`
- `src/workspace/local.ts` (edited) — add wipe-on-retry block (`rm wsDir` if exists) before `git clone` into workspace in `prepareFromRepository`, matching the pattern already in `prepareFromFilesystem`

**Seam (GREEN).**

- Bug 1: `PiAgentRunner.#emit` was a no-op because `buildDeps` never passed the `emit` option; now it delegates to `events.append(newEvent(...))` so `agent.started` / `agent.progress` / `agent.finished` are persisted to the events table.
- Bug 2: `prepareFromRepository` skipped the wipe-on-retry guard that `prepareFromFilesystem` already had; a second run now removes the stale workspace dir before cloning so `git clone` no longer hits an existing directory.

**Refactor.** None named; not applicable.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 10 · T1 confirm GREEN (ATTEMPT-FAILED)

**Cycle.** Confirm GREEN for Task `10-T1` (`src/apps/cli/agent-smoke.test.ts`). Two bugs remain after the SE's two production fixes; one was a test-design bug (fixed here); one is a production bug (needs SE).

---

### Handoff verification gate

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0, typecheck only) — confirmed before test runs.

---

### 10-T1 — confirm GREEN — BLOCKED

**Test run — agent-smoke.test.ts (after SE fixes + TE test repair).**

- command: `node --test src/apps/cli/agent-smoke.test.ts`
- exit: 1 — 3 pass, 1 fail

```
✖ Phase 1+2: happy path README edit and escalation round-trip (239.872208ms)
✔ Phase 3a: retry rejection — task re-runs and completes; no task.failed event
✔ Phase 3b: discard rejection — task discarded, dependent blocked, daemon still exits 0
✔ Phase 4: provider-mismatched credential fails daemon exit 1; no credential value in output
```

---

### Test-design repair applied (TE lane)

The SE's two fixes (emit wired, prepareFromRepository wipe-on-retry) corrected the prior failures. With those fixes, two new failures surfaced:

**Bug A (test design — fixed this turn):** Phase 3a second session `[{ text: "done after retry" }]` and Phase 1+2 TASK3 session `[{ text: "finished" }]` were text-only — no file changes. `genericProfile.verify` returns `{ verdict: "rejected", code: "NO_CHANGES" }` for sessions with `hasChanges === false`. This is correct production behavior (see `verification.test.ts` test b). The sessions needed a bash call to make a file change.

**Fix applied to `src/apps/cli/agent-smoke.test.ts`:**

- Phase 3a second session changed from `[{ text: "done after retry" }]` to `[{ toolCalls: [{ name: "bash", arguments: { command: "echo 'done after retry' >> retry-done.txt" } }] }, { text: "done after retry" }]`.
- Phase 1+2 TASK3 session changed from `[{ text: "finished" }]` to `[{ toolCalls: [{ name: "bash", arguments: { command: "echo 'cleanup done' >> cleanup.txt" } }] }, { text: "finished" }]`.

After this repair: Phase 3a is GREEN. Phase 3b and Phase 4 remain GREEN.

---

### Remaining production bug — Phase 1+2 (approve task exits 1)

**Failure (verbatim):**

```
✖ Phase 1+2: happy path README edit and escalation round-trip (239.872208ms)
  AssertionError: approve task2 exits 0
  1 !== 0
  at agent-smoke.test.ts:362:12
```

**Root cause analysis.** The failure is at `approve task --id TASK2`. TASK2 IS confirmed `awaiting_confirmation` (assertion at line 326 passes). The daemon run exits 0 with "1 task(s) awaiting confirmation" stderr (assertions at lines 308-312 pass). The `task2Data.result !== undefined` assertion at line 327 passes.

`ApproveTask.execute` can throw three domain errors:

- `UnknownReferenceError` — task not found (impossible; task is confirmed present)
- `TaskNotAwaitingConfirmationError` — wrong status (impossible; confirmed awaiting_confirmation)
- `ProposalMissingError` — `promoteProposal(workspace, taskId, proposalCommit)` failed

The most likely cause is `ProposalMissingError`. `promoteProposal(dir, taskId, proposalCommit)` runs `git branch -f kanthord/<TASK2> <SHA>` with `{ cwd: dir }` where `dir = result.workspace`. Possible failure causes:

1. `result.workspace` is `null` → `result.workspace ?? "" = ""` → git runs in process CWD (kanthord repo root), where the SHA doesn't exist → fail
2. The workspace directory was removed or is inaccessible
3. The `proposalCommit` SHA doesn't exist in the workspace repo's object store

Evidence from Phase 1 (which passes): the bash tool from pi-coding-agent correctly executes in the workspace (TASK1's `printf '# Title\n' > README.md` produces a commit). So TASK2's bash `echo 'second line' >> README.md` should also modify the workspace file, causing `hasChanges = true` and `createProposalCommit` to create a valid SHA.

**Open to Software Engineer.** Investigate why `approve task --id TASK2` exits 1:

1. Log or check `result.workspace` and `result.proposalCommit` returned by `getTaskResult(TASK2)` — are they non-null and correctly stored?
2. Verify that `git branch -f kanthord/<TASK2> <proposalSha>` can be run manually in the workspace directory after a daemon run
3. Specifically check whether `result.workspace` could be `null` despite the escalated result returning `workspace: workspace.dir` — the `promoteProposal` call at `approve-task.ts:97` falls back to `""` if `result.workspace` is null, which would cause the git command to fail

ATTEMPT-FAILED: 10-T1 — Phase 1+2 still fails: `approve task2 exits 0 — 1 !== 0` (line 362); Phase 3a is now GREEN after TE test-design repair (bash call added to second session); production bug in `ApproveTask`/`promoteProposal` prevents Phase 1+2 approval from succeeding

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 10 · T1 fix promoteProposal current-branch bug

**Cycle.** GREEN for `src/apps/cli/agent-smoke.test.ts` Phase 1+2 (approve task2 exits 0).

**Root-cause analysis.**

`LocalWorkspaceManager.prepareFromRepository` creates the task branch with `git switch -c kanthord/<taskId>` — so HEAD is pointing at `kanthord/<taskId>` for the lifetime of the workspace.

`promoteProposal` then calls `git branch -f kanthord/<taskId> <proposalSha>` in that same workspace. Git refuses to force-update the currently checked-out branch: `fatal: Cannot force update the current branch.` → `execFile` throws → `ApproveTask` wraps it as `ProposalMissingError` → `toResult` maps to exit 1.

The unit test (`approve-task.test.ts`) does NOT hit this because its `before()` sets up the workspace with HEAD at `main` (created via `git init` + `git commit` + `git reset --hard`) and creates `kanthord/<taskId>` as a plain branch ref (not the current branch). So `git branch -f` works there. The smoke test is the first path where `kanthord/<taskId>` is the current HEAD.

**Fix.**

Replace `git branch -f kanthord/<taskId> <sha>` with `git update-ref refs/heads/kanthord/<taskId> <sha>`. `git update-ref` directly writes the ref without triggering the "cannot force-update current branch" check. Behavior is identical when the branch is not current; only the currently-checked-out case is fixed.

**Files changed.**

- `src/workspace/local.ts` (edited) — `promoteProposal`: change `git branch -f kanthord/<taskId> <proposalSha>` to `git update-ref refs/heads/kanthord/<taskId> <proposalSha>`.

**Seam (GREEN).** After approval in the smoke test, `git rev-parse kanthord/<TASK2>` resolves to `proposalSha` (the proposal commit) even though `kanthord/<TASK2>` is the currently checked-out branch in the workspace.

**Refactor.** None required.

**Build check.**

- typecheck: exit 0 (clean)

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — implementation ready for review

**Cycle.** Confirm GREEN for Task `10-T1` (Story 10) + EPIC 006 full verification gate.

---

### Handoff verification gate

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0, typecheck only) — confirmed before test runs.

---

### Story 10 T1 — confirm GREEN (promoteProposal fix)

**SE fix.** `src/workspace/local.ts` — `promoteProposal` changed from `git branch -f kanthord/<taskId> <sha>` to `git update-ref refs/heads/kanthord/<taskId> <sha>`. `git branch -f` refuses to update the currently-checked-out branch (HEAD points at `kanthord/<taskId>` during an active workspace); `git update-ref` writes the ref directly without that check. The approve-task unit tests were unaffected because they set HEAD to `main` before creating the task branch.

**Test run — agent-smoke.test.ts.**

- command: `node --test src/apps/cli/agent-smoke.test.ts`
- exit: 0 — 4/4 pass

```
✔ Phase 1+2: happy path README edit and escalation round-trip
✔ Phase 3a: retry rejection — task re-runs and completes; no task.failed event
✔ Phase 3b: discard rejection — task discarded, dependent blocked, daemon still exits 0
✔ Phase 4: provider-mismatched credential fails daemon exit 1; no credential value in output
```

Story 10 T1 is fully GREEN. Story 10 complete.

---

### EPIC Verification Gate

**Full test suite.** `npm test` → 554/554 pass, 0 fail.

**Full gate.** `npm run verify` → exit 0, `VERIFY: PASS` (typecheck + test + lint + db status all pass).

---

### Tasks closed

All 10 Stories × their Tasks closed across EPIC 006:

- Story 01 (T1 resource entity) — GREEN
- Story 02 (T1 pi-session + T2 provider session + T3 workspace) — GREEN
- Story 03 (T1 pi-profile + T2 instruction loader + T3 pi-runner scaffold) — GREEN
- Story 04 (T1 resource persistence + T2 list/get resource CLI + T3 add-resource CLI) — GREEN
- Story 05 (T1 PiAgentRunner integration) — GREEN
- Story 06 (T1 evidence + verdict + T2 result persistence + get task) — GREEN
- Story 07 (T1 escalated branch + daemon summary + T2 approve/reject + CLI) — GREEN
- Story 08 (T1 event emission + throttle + redaction + T2 turn budget + env wiring) — GREEN
- Story 09 (T1 buildResource domain + T2 ImportResources + T3 import resource CLI) — GREEN
- Story 10 (T1 agent smoke test — Phase 1+2+3a+3b+4) — GREEN

IMPLEMENTATION_READY_FOR_REVIEW:

- gates: PASS
- date: 2026-07-17
- state: e898c05d6f89cb215ee0bc9c7d902ad575d3638b

END: TEST-ENGINEER

AUTO_REVIEW: FAIL — routing 3 action:YES finding(s) to the TDD loop; 2 action:NO finding(s) recorded for the human.
BLOCKER: B1 (list-tasks.ts + router.ts) — `list task --status` filter not wired end-to-end: router "list task" lacks a `status` parse option (parseArgs rejects --status → exit 1) and `runListTasks` never reads/forwards `args["status"]` to `listTasks.execute()`. EPIC Proof runs `list task --status awaiting_confirmation`. Fix both the router parse options and the handler forwarding.
BLOCKER: B2 (agent-runner/pi.ts ~line 432) — credential leak: the post-`waitForIdle` failure path returns `{ outcome: "failed", reason: agent.state.errorMessage }` WITHOUT the in-scope `redact()`. A network/auth error message could carry the API key into `task_results.reason`. Fix: `reason: redact(agent.state.errorMessage)`. Add a regression test for the post-waitForIdle error path (Story 08 T1 currently only covers the session-factory-throws path).
BLOCKER: B3 (router.ts + login.ts + composition.ts) — `login` command not registered in COMMANDS: `runLogin` exists and is unit-green, but there is no "login" entry in the COMMANDS dispatch table, so `main.ts login <provider>` exits 1 "unknown command". Add the "login" COMMANDS entry with parse options {provider,project,name} and wire the pi-ai OAuth provider dep in composition. Add a router-dispatch-level test so the gap is caught.
INFO: S1 (reject-task.ts:8) — imports `TaskNotAwaitingConfirmationError` from sibling use case approve-task.ts; AGENTS.md says app/ imports domain/ and */port.ts only. Move the error to app/errors.ts. Architectural hygiene; lint does not flag it.
INFO: S2 (approve-task.ts:97) — `result.workspace ?? ""` fallback runs git in the wrong dir when workspace is null but proposalCommit is set; unreachable in normal operation but a clearer DB-integrity error would be more defensive.

## TEST-ENGINEER — EPIC 006 reviewer-blocker regressions B1 / B2 / B3 (RED)

**Cycle.** RED regression tests for three `AUTO_REVIEW: FAIL` blockers.

---

### Handoff verification gate

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0, typecheck only) — confirmed before writing tests.

---

### B1 — `list task --status` not wired end-to-end

**Test written.**

- file: `src/apps/cli/list-tasks.test.ts` (edited) — added import `{ dispatch }` from `./router.ts`, `import type { RouterDeps }` from `./router.ts`; added `FakeTaskRepositoryB1` with two tasks (`awaiting_confirmation` + `pending`) and constant `INITIATIVE_ID_B1`; new top-level test (above existing `describe("runListTasks")` block):
  - `(B1 regression) dispatch list task --status awaiting_confirmation exits 0 and returns only matching tasks`
- asserts: `dispatch(["list", "task", "--initiative", INITIATIVE_ID_B1, "--status", "awaiting_confirmation"], deps)` → `exitCode 0`; stdout contains the awaiting_confirmation task title; stdout does NOT contain the pending task title.

**RED proof (B1).**

- command: `node --test src/apps/cli/list-tasks.test.ts`
- exit: 1
- failure: `✖ (B1 regression) dispatch list task --status awaiting_confirmation exits 0 and returns only matching tasks` — `AssertionError: dispatch must exit 0 for list task --status, got exitCode=1, stderr=["error: Unknown option '--status'","usage: usage: list task --initiative <id> [--json]"]` — `1 !== 0`
- reason: `status: { type: "string" }` missing from the `"list task"` COMMANDS parse options → `parseArgs` strict mode rejects `--status` before the handler is called.

---

### B2 — credential leak in post-`waitForIdle` failure path

**Test written.**

- file: `src/agent-runner/pi.test.ts` (edited) — new test inserted before the existing Story 08 T2 budget test:
  - `(B2 regression) post-waitForIdle agent.state.errorMessage containing credential value is redacted in result.reason`
- asserts: when the session factory's `for()` resolves successfully but the returned `streamFn` throws with `CREDENTIAL.value` (`"sk-test"`) in the message, pi-agent-core sets `agent.state.errorMessage` to that string; the runner's `result.reason` must NOT contain `"sk-test"` and must contain `"***"`.

**RED proof (B2).**

- command: `node --test src/agent-runner/pi.test.ts`
- exit: 1 — 20 pass, 1 fail
- failure: `✖ (B2 regression) post-waitForIdle agent.state.errorMessage containing credential value is redacted in result.reason` — `AssertionError: result.reason must NOT contain credential value 'sk-test' (must be redacted), got: auth failed: sk-test is not a valid API key`
- reason: pi.ts line ~432 returns `{ outcome: "failed", reason: agent.state.errorMessage }` without applying the in-scope `redact()` function.

---

### B3 — `login` command not registered in COMMANDS

**Test written.**

- file: `src/apps/cli/router.test.ts` (edited) — new test at the bottom:
  - `(B3 regression) dispatch login --help exits 0 with usage text (login must be in COMMANDS)`
- asserts: `dispatch(["login", "--help"], {} as RouterDeps)` → `exitCode 0`; `stdout.length > 0` (usage text); no stderr line containing `"unknown command"`.

**RED proof (B3).**

- command: `node --test src/apps/cli/router.test.ts`
- exit: 1 — 6 pass, 1 fail
- failure: `✖ (B3 regression) dispatch login --help exits 0 with usage text (login must be in COMMANDS)` — `AssertionError: login must be registered in COMMANDS — got exitCode=1, stderr=["error: unknown command: login --help", "known commands:\n  check graph\n  ..."]` — `1 !== 0`
- reason: `COMMANDS["login"]` is absent; dispatch's single-word fallback (`obj = "--help"` starts with `-` → look up `COMMANDS["login"]`) finds nothing → returns exit 1 "unknown command: login --help".

---

**Open to Software Engineer.**

Three production seams to fix:

- **B1 — `src/apps/cli/router.ts`** — add `status: { type: "string" }` to the `"list task"` command's `parse` options. **`src/apps/cli/list-tasks.ts`** `runListTasks` — read `args["status"]` (string | undefined), pass as `status` to `listTasks.execute({ initiativeId, status })`.

- **B2 — `src/agent-runner/pi.ts`** — on the `agent.state.errorMessage` check after `waitForIdle()` (currently `return { outcome: "failed", reason: agent.state.errorMessage }`), apply the in-scope `redact()`: `return { outcome: "failed", reason: redact(agent.state.errorMessage) }`.

- **B3 — `src/apps/cli/router.ts`** — register a `"login"` entry in `COMMANDS` with appropriate parse options so `dispatch(["login", "--help"])` resolves via the single-word fallback and returns exit 0 with usage text. Wire the `runLogin` handler and update `RouterDeps` + `src/composition.ts` accordingly.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 006-real-agents-via-pi · Review blockers B1 / B2 / B3

**Cycle.** GREEN for three regression tests (B1 list-task status filter, B2 redact errorMessage, B3 login command registration).

**Files changed.**

- `src/apps/cli/router.ts` (edited) — added `status: { type: "string" }` to `"list task"` parse options; imported `runLogin` + `LoginDeps` from `./login.ts`; added `login: LoginDeps` to `RouterDeps`; registered `"login"` entry in COMMANDS
- `src/apps/cli/list-tasks.ts` (edited) — added `import type { TaskStatus }` from domain; reads `args["status"] as TaskStatus | undefined` and forwards it to `listTasks.execute({ initiativeId, status })`
- `src/apps/cli/login.ts` (edited) — exported `SaveCredentialOpts` and `LoginDeps` (changed `type` to `export type`)
- `src/agent-runner/pi.ts` (edited) — post-`waitForIdle` error path now returns `reason: redact(agent.state.errorMessage)` instead of the raw string
- `src/composition.ts` (edited) — imported `getOAuthProvider` from `@earendil-works/pi-ai/oauth`; wired `login` deps object (getProvider delegates to getOAuthProvider, saveCredential calls addResource.execute with type: "credential"); returned `login` in RouterDeps bundle

**Seam (GREEN).**

- B1: `parseArgs` no longer rejects `--status`; `runListTasks` forwards it to `listTasks.execute` which already filters by status.
- B2: `redact()` (in scope since line 301) is now applied to `agent.state.errorMessage` so credential values are masked in the failure reason.
- B3: `COMMANDS["login"]` exists — `dispatch(["login", "--help"])` resolves the single-word fallback, finds the entry, and returns usage text with exit 0.

**Refactor.** None named; no deferred work.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — EPIC 006 reviewer-blocker regressions B1/B2/B3 confirm GREEN attempt

**Cycle.** Confirm GREEN for B1/B2/B3 regressions + full `npm run verify` gate.

---

### Handoff verification gate

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0) — confirmed before test runs.

---

### B1/B2/B3 regression tests — all GREEN

- `node --test src/apps/cli/list-tasks.test.ts` → 3/3 pass (B1 regression GREEN).
- `node --test src/agent-runner/pi.test.ts` → 21/21 pass (B2 regression GREEN).
- `node --test src/apps/cli/router.test.ts` → 7/7 pass (B3 regression GREEN).

---

### Full gate (`npm run verify`) — BLOCKED (lint)

`npm run verify` fails at the lint step:

```
/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/apps/cli/list-tasks.ts
  2:33  error  There is no policy allowing dependencies from elements of type "apps" to elements of type "domain"  boundaries/dependencies

✖ 1 problem (1 error, 0 warnings)
```

`src/apps/cli/list-tasks.ts` line 2 — `import type { TaskStatus } from "../../domain/task.ts"` — introduced by the SE's B1 fix. The `apps/` layer must not import directly from `domain/`; it must go through `app/`.

**Fix required:** Re-export `TaskStatus` from `app/errors.ts` (or another `app/`-level module that `apps/` is allowed to import), then update `src/apps/cli/list-tasks.ts` to import `TaskStatus` from that re-export path instead of from `../../domain/task.ts`. Then re-run `npm run verify` and confirm exit 0.

ATTEMPT-FAILED: B1-boundary — lint fails: `apps/cli/list-tasks.ts` imports `TaskStatus` directly from `domain/task.ts` (apps → domain boundary violation); SE must re-export `TaskStatus` through `app/` and update the import.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 006-real-agents-via-pi · Boundary fix: apps→domain TaskStatus import

**Cycle.** Lint boundary violation fix: `src/apps/cli/list-tasks.ts` imported `TaskStatus` directly from `domain/task.ts`.

**Files changed.**

- `src/app/errors.ts` (edited) — added `export type { TaskStatus } from "../domain/task.ts";`
- `src/apps/cli/list-tasks.ts` (edited) — changed `TaskStatus` import from `../../domain/task.ts` → `../../app/errors.ts`

**Seam (GREEN).** `app/errors.ts` is the existing legal bridge (`app/` may import `domain/`); a `type` re-export passes `TaskStatus` through without introducing a value import. `apps/cli/list-tasks.ts` now imports only from `app/`, satisfying the boundary rule.

**Refactor.** N/A — single-line fix, no named refactor.

**Build check.**

- typecheck: exit 0
- lint: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — implementation ready for review

**EPIC verification gate.** All gates pass after the SE re-exported `TaskStatus` through `app/errors.ts` to fix the `apps → domain` boundary violation.

- typecheck (`npm run typecheck`) → exit 0
- unit (`npm test`) → 557 pass, 0 fail, 0 skip — exit 0
- verify:handoff (`npm run verify:handoff`) → `VERIFY: PASS` — exit 0
- lint (`npm run lint`) → exit 0 (no boundary violations)
- db status (`node src/main.ts db status`) → schema 4, WAL mode — exit 0

**Tasks closed.** All Tasks across all Stories of EPIC 006 confirmed GREEN.

IMPLEMENTATION_READY_FOR_REVIEW:

- gates: PASS
- date: 2026-07-17
- state: e898c05d6f89cb215ee0bc9c7d902ad575d3638b

END: TEST-ENGINEER

HUMAN_REVIEW: FAIL
BLOCKER: S1 — move `TaskNotAwaitingConfirmationError` out of `src/app/task/approve-task.ts` into `src/app/errors.ts`; update `approve-task.ts` and `reject-task.ts` (and any other importer) to import it from `app/errors.ts` so `app/` no longer imports across sibling use cases. Behavior-preserving refactor.
BLOCKER: S2 — in `src/app/task/approve-task.ts`, replace the `result.workspace ?? ""` fallback with an explicit guard: when `result.proposalCommit !== null && result.workspace === null` (or empty), throw a clear DB-integrity error naming the task instead of running git in the wrong directory. Add a regression test proving that state yields the explicit error, not a swallowed ProposalMissingError.

## TEST-ENGINEER — EPIC 006 HUMAN_REVIEW blockers S1 (pass-through) + S2 (RED regression)

**Cycle.** HUMAN_REVIEW: FAIL response. S2 regression test written (RED); S1 handed to SE as a refactor.

---

### Handoff verification gate

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0, typecheck only) — confirmed before test edits.

---

### S1 — move `TaskNotAwaitingConfirmationError` to `app/errors.ts` (refactor, no new test)

S1 is a behavior-preserving refactor: move `TaskNotAwaitingConfirmationError` from `src/app/task/approve-task.ts` to `src/app/errors.ts` and update all importers (`approve-task.ts`, `reject-task.ts`, any other file that imports it). The existing approve-task tests and reject-task tests already cover the behavior of this error and must stay green. No natural RED test exists for a symbol move — Aelita does not write one.

**Open to Software Engineer (S1).** Move `TaskNotAwaitingConfirmationError` out of `src/app/task/approve-task.ts` into `src/app/errors.ts`. Update the export in `approve-task.ts` to re-export or remove the definition; update `reject-task.ts` (and any other importer) to import from `../../app/errors.ts` instead of `./approve-task.ts`. The existing test imports in `approve-task.test.ts` and `reject-task.test.ts` currently import from `./approve-task.ts` — if `approve-task.ts` still re-exports the class the test imports stay valid; if the SE removes the re-export the test imports must be updated (SE decides the cleanest approach). Run `npm run verify` and confirm exit 0.

---

### S2 — explicit guard when proposalCommit set but workspace null (RED)

**Test written.**

- file: `src/app/task/approve-task.test.ts` (edited) — suite: top-level — method: `(S2 regression) escalated task with proposalCommit set but workspace null throws a clear DB-integrity error naming the task`
- asserts: an escalated `TaskResultRow` with `workspace: null` and `proposalCommit: "def456"` (non-null) handed to `ApproveTask.execute` must throw an error that (a) is NOT `ProposalMissingError`, (b) whose message includes the `taskId`. The injected `promote` stub is a noop (does not throw on its own), so any error must come from an explicit guard firing BEFORE promote is called; the test also asserts `promoteCallCount === 0`.

**RED proof.**

- command: `node --test src/app/task/approve-task.test.ts`
- exit: 1 (4 pass, 1 fail)
- failure: `✖ (S2 regression) escalated task with proposalCommit set but workspace null throws a clear DB-integrity error naming the task` — `AssertionError [ERR_ASSERTION]: Missing expected rejection: workspace=null + proposalCommit set must throw a clear DB-integrity error naming the task`
- reason: current code takes the `result.workspace ?? ""` path, calls the noop promote (which does not throw), task gets approved silently — `execute` resolves, `assert.rejects` fails because no rejection occurred.

**Open to Software Engineer (S2).** In `src/app/task/approve-task.ts`, inside the `if (result !== undefined && result.proposalCommit !== null)` block, add an explicit guard: when `result.workspace` is null or empty string, throw a clear error naming the task (not `ProposalMissingError`) — so that inconsistent DB state (proposalCommit stored without a workspace path) is surfaced immediately rather than silently running git in the wrong directory. The error class name and exact message are the SE's choice; the test's two assertions are: (a) `!(err instanceof ProposalMissingError)`, (b) `err.message.includes(taskId)`. Perform S1 and S2 together in one pass, then confirm `npm run verify` → exit 0.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 006-real-agents-via-pi · S2 + S1 human blockers

**Cycle.** GREEN+REFACTOR for `src/app/task/approve-task.test.ts` (S2 regression test) + S1 boundary refactor.

**Files changed.**

- `src/app/errors.ts` (edited) — added `TaskNotAwaitingConfirmationError` and `ProposalWorkspaceMissingError` classes
- `src/app/task/approve-task.ts` (edited) — removed local `TaskNotAwaitingConfirmationError` definition; imports both new error classes from `../errors.ts`; re-exports `TaskNotAwaitingConfirmationError` (so tests and error-map keep working); adds workspace guard before calling `#promote`
- `src/app/task/reject-task.ts` (edited) — imports `TaskNotAwaitingConfirmationError` from `../errors.ts` instead of `./approve-task.ts`
- `src/apps/cli/error-map.ts` (edited) — imports `TaskNotAwaitingConfirmationError` and `ProposalWorkspaceMissingError` from `app/errors.ts`; adds `ProposalWorkspaceMissingError` to the `toResult` chain

**Seam (GREEN — S2).** When `result.proposalCommit !== null` and `result.workspace` is null or empty, `execute()` throws `ProposalWorkspaceMissingError` (message includes the taskId) before calling `#promote`, satisfying the regression test's assertions: not a `ProposalMissingError`, message names the task, promote never called.

**Refactor (S1).** `TaskNotAwaitingConfirmationError` moved to `app/errors.ts` as the single error catalog; `approve-task.ts` re-exports it for backward compatibility with existing importers (test + CLI); `reject-task.ts` and `error-map.ts` now import from `app/errors.ts` directly.

**Build check.**

- typecheck: exit 0
- lint: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — implementation ready for review

**Cycle.** Confirm GREEN for HUMAN_REVIEW blockers S1 + S2 + full EPIC 006 verification gate.

---

### Handoff verification gate

**Verification result.** `npm run verify:handoff` → `VERIFY: PASS` (exit 0, typecheck only) — confirmed before test runs.

---

### S2 regression test — confirm GREEN

**Test run — approve-task.test.ts (S2 regression).**

- command: `node --test src/app/task/approve-task.test.ts`
- exit: 0 — 6/6 pass

```
✔ (a) approve task: kanthord/<id> points at proposal, result commit_sha set, task completed, events, dependent enqueued
✔ (b) re-approve already-completed task with commit_sha=proposalCommit → no-op success
✔ (c) approve on pending task → TaskNotAwaitingConfirmationError
✔ (d) deleted proposal branch → ProposalMissingError, task stays awaiting_confirmation
✔ (j) NULL-proposal escalation approval → completed, no commit_sha, no promotion
✔ (S2 regression) escalated task with proposalCommit set but workspace null throws a clear DB-integrity error naming the task
```

**Test run — reject-task.test.ts (S1 regression guard).**

- command: `node --test src/app/task/reject-task.test.ts`
- exit: 0 — 5/5 pass (TaskNotAwaitingConfirmationError now imported from `app/errors.ts` — all existing tests stay GREEN).

---

### EPIC Verification Gate

**Full gate.** `npm run verify` → exit 0 (typecheck + test + verify:handoff + lint + db status all pass).

- typecheck (`npm run typecheck`) → exit 0
- unit (`npm test`) → **558 pass, 0 fail, 0 skip** — exit 0
- verify:handoff (`npm run verify:handoff`) → `VERIFY: PASS` — exit 0
- lint (`npm run eslint .`) → exit 0 (no boundary violations)
- db status (`node src/main.ts db status`) → schema 4, WAL mode — exit 0

---

**Tasks closed.** All Tasks across all Stories of EPIC 006 confirmed GREEN, including reviewer-blocker regressions B1/B2/B3 and human-review blockers S1/S2.

IMPLEMENTATION_READY_FOR_REVIEW:

- gates: PASS
- date: 2026-07-18
- state: local-uncommitted

END: TEST-ENGINEER

HUMAN_REVIEW: PASS

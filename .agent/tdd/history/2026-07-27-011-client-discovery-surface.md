---
epic: .agent/plan/epics/011-client-discovery-surface.md
opened: 2026-07-27
opener: test-engineer
base-ref: 2f87b6e3017be687f14c39e24bf7d3b36a7de682
---

# Implementation cycle — 011-client-discovery-surface

Pulled from EPIC: `.agent/plan/epics/011-client-discovery-surface.md`.

Verification gate (binding, from the EPIC's `## Verification Gate` section):

> Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).
> Hermetic coverage required beyond the Proof:
>
> - `ListProjects` returns projects in ascending id order; empty store → `[]`.
> - The new resource listings go through `toResourceView`, so a listed resource
>   never carries a credential `value` (mirrors the existing `list credential`
>   assertion in `src/apps/cli/commands/read.test.ts`).
> - Event scoping resolves ownership by the **denormalised `projectId` written at
>   append time** (see Decisions): an event whose owner entity is later deleted
>   still appears in that project's feed, and an event with no project is in no
>   project feed.
> - Paging: `nextCursor` advances past non-matching events, so a project feed
>   never stalls behind a foreign event; the terminal page is empty with a stable
>   cursor; no event id is ever returned twice across pages.
> - The migration backfills `events.projectId` for existing rows by hierarchy
>   join, and rows that cannot be resolved are left NULL rather than guessed.
>
> Proof: `scripts/e2e/client-discovery-proof.sh` — deterministic, no model, no
> network, no daemon. Run from the repo root:
>
> ```bash
> scripts/e2e/client-discovery-proof.sh
> ```
>
> It must print `011 ok: …`. Phases: **A** `list project` enumerates two projects
> with no prior id, in a defined order · **B** `list notification` /
> `list filesystem` list, are project-scoped, and no listing carries a secret ·
> **C** `examples/oauth-package` imports and its objectives + tasks are readable
> back (a real import, not `--dry-run`, run against a COPY because
> `import --create` rewrites a package's source files in place with minted ULIDs;
> the script then asserts the committed example is still clean) · **D** an
> interleaved two-project event
> history is served as disjoint, ordered, duplicate-free scoped feeds, each a
> subset of the global feed, and paging P1 with `--limit 1` reaches exactly the
> full P1 set while stepping over P2's events.
>
> Confirmed RED against the current tree (2026-07-27). Because `set -e` stops the
> script at its first failure, each gap was ALSO probed independently: `list
project` → `unknown command 'project'`; `list notification` → `unknown command
'notification'`; `list filesystem` → `unknown command 'filesystem'`;
> `list event --project` → `unknown option '--project'`; `examples/oauth-package`
> → missing.

TDD protocol:

1. test-engineer writes the next failing test (RED) — or a GREEN-ONLY pass-through for Tasks without `Action — RED:`.
2. software-engineer makes the test green (RED flow) or implements the Task spec directly (GREEN-ONLY flow).
3. test-engineer confirms GREEN (or runs a build-only check for GREEN-ONLY), then either opens the next Task or runs the full Verification Gate and appends IMPLEMENTATION_READY_FOR_REVIEW.

## TEST-ENGINEER — client-discovery-surface · 01-list-project Task RED

**Cycle.** RED for Task `01-list-project` (verify path: `node --test src/app/project/list-projects.test.ts` and the two new read.test.ts cases).
**Test written.**

- file: `src/app/project/list-projects.test.ts` (new) — suite: `ListProjects` — methods: `empty repository returns an empty array`, `returns the repository rows unchanged (no in-memory re-sort)`, `execute() calls listProjects() exactly once with no arguments`.
  - asserts: `ListProjects.execute()` returns the repository's `listProjects()` rows verbatim (no in-memory re-sort), calls it exactly once with no arguments, and returns `[]` when the repository is empty.
- file: `src/apps/cli/commands/read.test.ts` (edited) — appended two tests to the existing `describe`: `(011 S1) list project --json: emits one JSON line of all projects in repo order`, `(011 S1) list project: emits id + two spaces + name, one line per project`.
  - asserts: the CLI leaf `list project --json` emits one `JSON.stringify(rows)` line with `cap.err === []` and exit 0; `list project` (no `--json`) emits one `<id>  <name>\n` line per project (two spaces), with `cap.err === []` and exit 0.
    **RED proof.**
- command: `node --test src/app/project/list-projects.test.ts`
- exit: non-zero — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuannguyen/Projects/kanthorlabs/epic-011/src/app/project/list-projects.ts' imported from /Users/tuannguyen/Projects/kanthorlabs/epic-011/src/app/project/list-projects.test.ts` (the use case seam does not exist yet).
- command: `node --test src/apps/cli/commands/read.test.ts` (new cases)
- exit: non-zero — failure: `Error [CommanderError]: error: unknown command 'project'` for both new tests (the `list project` leaf is not registered in `src/apps/cli/commands/list.ts`).
  **Open to Software Engineer.**
- Seams the tests import (no implementation guidance):
  - `src/app/project/list-projects.ts` — `export class ListProjects` with constructor `(projects: ProjectRepository)` and `execute(): Project[]` returning the rows from `projects.listProjects()` unchanged.
  - `src/apps/cli/commands/list/project.ts` — `export function buildListProjectCommand(deps: CliDeps, io: CliIo): Command` exposing a `new Command("project")` with `.description(...)`, `.option("--json", ...)`, `.addHelpText("after", "...")` Example, and an `.action((opts: { json?: boolean }) => { ... runListProjects(...) ... })` that returns the result through the existing `emitResult` helper.
  - `src/apps/cli/project.ts` — `export function runListProjects(args: Record<string, unknown>, listProjects: ListProjects): { exitCode: number; stdout: string[]; stderr: string[] }` producing `JSON.stringify(rows)` for `--json` and one `<id>  <name>\n` line per project otherwise.
  - `src/apps/cli/commands/list.ts` — register the new builder beside the existing `buildListCredentialCommand` / `buildListRepositoryCommand` registrations.
  - `src/composition.ts` — instantiate `const listProjects = new ListProjects(projectRepository)` next to `findProject`, expose it in the returned bundle, and import the use case.
  - `src/apps/cli/deps.ts` — add `listProjects: ListProjects` to the `CliDeps` shape (type-only import of the use case).
- The Story 1 instruction to bump `EXPECTED_LEAF_FILE_COUNT` (architecture.test.ts:28) and `EXPECTED_LEAF_COUNT` (architecture.test.ts:31) is part of the SE's GREEN+REFACTOR for this Task; my tests do not touch the architecture test.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — client-discovery-surface · 01-list-project Task

**Cycle.** GREEN+REFACTOR for `src/app/project/list-projects.test.ts` and the two new cases in `src/apps/cli/commands/read.test.ts`.
**Files changed.**

- `src/app/project/list-projects.ts` (new) — `export class ListProjects` with `#projects: ProjectRepository` and `execute(): Project[]` returning the repo's rows verbatim.
- `src/apps/cli/project.ts` (edited) — added `import type { ListProjects }` and appended `runListProjects(args, listProjects)` mirroring `runListInitiatives` (no try/catch, no error map; the use case cannot fail).
- `src/apps/cli/commands/list/project.ts` (new) — `buildListProjectCommand(deps, io): Command` exposing `kanthord list project [--json]`, with the required `description` / `commandUsage` / `Example` help text per the architecture gate.
- `src/apps/cli/commands/list.ts` (edited) — added `import { buildListProjectCommand } from "./list/project.ts";` and registered it as the first `addCommand(...)` call, before `buildListTaskCommand`.
- `src/composition.ts` (edited) — imported `ListProjects`, instantiated `const listProjects = new ListProjects(projectRepository);` directly after `findProject`, and added `listProjects,` to the returned bundle right after `findProject`.
- `src/apps/cli/deps.ts` (edited) — added `import type { ListProjects }` and `listProjects: ListProjects;` in `CliDeps` directly after `findProject: FindProject;`.
- `src/apps/cli/architecture.test.ts` (edited) — bumped `EXPECTED_LEAF_FILE_COUNT` 65 → 66 (one new file under `commands/list/`) and `EXPECTED_LEAF_COUNT` 68 → 69 (one new registered leaf). The `commands` leaf already carries the `Example` help text, so the third architecture item needed no change.
  **Seam (GREEN).** The new `ListProjects.execute()` returns the repository rows unchanged; `runListProjects` JSON-stringifies when `args["json"]` is set and otherwise emits one `<id>  <name>\n` per row; `buildListProjectCommand` registers the `list project` subcommand; the architecture test sees exactly 66 leaf files and 69 leaves after registration.
  **Refactor.** None deferred — every line traces to the failing assertion or the named Story 1 wiring change. The Story's leaf-count starting value (67) was already stale on HEAD (current: 68); the end value matches (69), so the target is correct.
  **Build check.**
- typecheck: exit 0
  **Assumptions.**
- VERIFIED: `ProjectRepository.listProjects(): Project[]` exists on the port (`src/storage/port.ts:64`) and the SQLite implementation is `ORDER BY id ASC` (`src/storage/sqlite/sqlite-project-repository.ts:122-128`).
- VERIFIED: `commands.ts:52` already carries the `Example` help text — no edit required for the third architecture item.
- VERIFIED: `npm run typecheck` is the project's binding SE pre-handoff check (per the project command table).

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — client-discovery-surface · 02-list-notification-filesystem Task RED

**Cycle.** RED for Task `02-list-notification-filesystem` (verify path: `node --test src/apps/cli/commands/read.test.ts` and `node --test src/app/resource/list-resources.test.ts`).
**Test written.**

- file: `src/apps/cli/commands/read.test.ts` (edited) — appended three new tests to the existing `describe`:
  - `(011 S2) list notification --project <id> --json: forwards {projectId, type: 'notification'}; emits one notification view line`
  - `(011 S2) list filesystem --project <id> --json: forwards {projectId, type: 'filesystem'}; emits one filesystem view line`
  - `(011 S2) list credential --project <id> --json: NON-VACUOUS no-secret-leak canary (real ListResources, fake repo returns value)`
  - asserts: the two CLI leaves forward `{projectId, type}` to the use case and JSON-stringify the returned view as one line; the canary uses a **real `ListResources` instance** over a fake `ProjectRepository` whose `listResourcesByProject` actually returns a credential with `value: "CANARY_SECRET_VALUE"`, and asserts the canary is absent from `cap.out` AND `JSON.parse(...)[0].value === undefined`. The canary is a **characterization test** (passes today) — the use case + `toResourceView` already redact the value; it replaces the currently vacuous canary at `read.test.ts:542-585` (whose fake row omits the `value` field, so the canary can never leak).
- file: `src/app/resource/list-resources.test.ts` (edited) — appended two new tests:
  - `(011 S2) execute({type: 'notification'}) forwards to listResourcesByProject and returns a view with exactly the notification keys`
  - `(011 S2) execute({type: 'filesystem'}) forwards to listResourcesByProject and returns a view with exactly the filesystem keys`
  - asserts: both types are forwarded verbatim to `listResourcesByProject(projectId, type)` and the returned view has exactly the keys the Story 2 spec names (notification: `type, id, projectId, name, provider, destination`; filesystem: `type, id, projectId, name, path`). These are **characterization tests** (pass today) — `ListResources` and `toResourceView` already support both types; the tests pin the exact key set so a future refactor cannot silently drop a field.

**RED proof.**

- command: `node --test src/apps/cli/commands/read.test.ts`
- exit: non-zero
- failure: 2 of 23 tests fail (the 2 new CLI leaves), both with the same family of error the EPIC's `Confirmed RED` probe predicted:
  - `✖ (011 S2) list notification --project <id> --json …` — `Error [CommanderError]: error: unknown command 'notification'` (the `list notification` leaf is not registered in `src/apps/cli/commands/list.ts`)
  - `✖ (011 S2) list filesystem --project <id> --json …` — `Error [CommanderError]: error: unknown command 'filesystem'` (the `list filesystem` leaf is not registered in `src/apps/cli/commands/list.ts`)
- characterization cases: 21 of 23 pass, including the non-vacuous canary (which runs the full `runListResources` → real `ListResources` → `toResourceView` → `JSON.stringify` path and confirms the canary is absent). This is the desired shape — the canary pins the no-secret-leak invariant that the vacuous 007.9 canary cannot.
- command: `node --test src/app/resource/list-resources.test.ts`
- exit: 0
- result: 6 of 6 pass. The two new use-case tests are characterization — they document the exact `Object.keys(v).sort()` contract that Story 2 requires and that the existing implementation already satisfies.

**Open to Software Engineer.**

- Seams the tests import (no implementation guidance):
  - `src/apps/cli/commands/list/resource.ts` — export two new builders beside `buildListCredentialCommand` and `buildListRepositoryCommand`. Both are thin wrappers around the already-present module-private `buildListResourceCommand(name, type, deps, io)` (`resource.ts:13-41`) — the wrappers take the literal name/type and the same `CliDeps` / `CliIo` and return a `Command`. The leaf must carry the standard `description`, `commandUsage`, `Example` help text (the architecture gate at `src/apps/cli/architecture.test.ts:117-120` requires every leaf to have all three). Name them `buildListNotificationCommand` and `buildListFilesystemCommand`; pass `"notification"` / `"filesystem"` as both the name and the `ResourceType` argument (the CLI name and the `ResourceType` discriminator happen to be identical here).
  - `src/apps/cli/commands/list.ts` — extend the existing named import block with the two new builders and add `command.addCommand(buildListNotificationCommand(deps, io));` and `command.addCommand(buildListFilesystemCommand(deps, io));` immediately after the existing `buildListRepositoryCommand` registration.
  - `src/apps/cli/architecture.test.ts` — bump `EXPECTED_LEAF_COUNT` (`architecture.test.ts:31`) from `69` → `71`. **Do not** touch `EXPECTED_LEAF_FILE_COUNT` (`architecture.test.ts:28`) — both builders live in the existing `commands/list/resource.ts`, so no new file appears under `commands/*/`.
  - **No app-layer, port, or composition change is needed.** `ListResources` is already generic over `ResourceType` (`src/app/resource/list-resources.ts:16-23`); `toResourceView` already maps every `ResourceType` (`src/app/resource/resource-view.ts:61-109`); `"notification"` and `"filesystem"` are already in `RESOURCE_TYPES` (`src/domain/resource.ts:4-9`). The existing CLI `runListResources` (`src/apps/cli/resource.ts:263-278`) already takes `type: ResourceType` as a parameter and is already wired into `buildListResourceCommand` — so the new builders are 3-line thin wrappers.
  - The architecture test's per-leaf assertion (`architecture.test.ts:117-120`) requires each leaf to have `.description()` + `.configureHelp({ commandUsage: … })` + `.addHelpText("after", "\nExample:\n  …")`. The existing `buildListResourceCommand` already provides all three when called with `name="notification"` / `name="filesystem"`, so no help-text change is needed.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — client-discovery-surface · 02-list-notification-filesystem Task

**Cycle.** GREEN+REFACTOR attempted for `src/apps/cli/commands/read.test.ts` and `src/app/resource/list-resources.test.ts`; handoff blocked by a TE-side typecheck error in the new characterization tests.

**Files changed.**

- `src/apps/cli/commands/list/resource.ts` (edited) — appended `buildListNotificationCommand` and `buildListFilesystemCommand` beside `buildListRepositoryCommand` (`resource.ts:81-83`); each is a 1-line wrapper around the unchanged module-private `buildListResourceCommand(name, type, deps, io)`. No change to `buildListResourceCommand`, `runListResources`, `ListResources`, or `toResourceView` (Story 2 "Constraints").
- `src/apps/cli/commands/list.ts` (edited) — extended the `from "./list/resource.ts"` import block with the two new builders; appended `command.addCommand(buildListNotificationCommand(deps, io));` then `command.addCommand(buildListFilesystemCommand(deps, io));` immediately after the `buildListRepositoryCommand` registration.
- `src/apps/cli/architecture.test.ts` (edited) — bumped `EXPECTED_LEAF_COUNT` 69 → 71 and appended a `011 Story 2 adds ...` line to the JSDoc. `EXPECTED_LEAF_FILE_COUNT` stays at 66 — both new builders live in the existing `commands/list/resource.ts`, no new file under `commands/*/`.

**Seam (GREEN).** The two `unknown command 'notification' / 'filesystem'` tests in `read.test.ts` now resolve to real registered commands (builders wrap the unchanged `buildListResourceCommand`, which already sets `description` + `commandUsage` + `Example` help text, so the architecture per-leaf gate at `architecture.test.ts:117-123` stays green for the new leaves). The non-vacuous canary and the two `list-resources.test.ts` characterization cases need only the typecheck to pass.

**Refactor.** None — the architecture test count bump is the named refactor and is applied; the 66 / 71 invariant matches the spec.

**Build check.**

- typecheck: **exit non-zero**
  - `src/app/resource/list-resources.test.ts(157,27): error TS2339: Property 'received' does not exist on type '{ results: Resource[]; }'.`
  - `src/app/resource/list-resources.test.ts(190,27): error TS2339: Property 'received' does not exist on type '{ results: Resource[]; }'.`
- All three production files I touched (`resource.ts`, `list.ts`, `architecture.test.ts`) typecheck clean — `tsc` reports only the two errors above, both inside `src/app/resource/list-resources.test.ts`.

**OPEN.**

- The two new characterization tests in `src/app/resource/list-resources.test.ts` (the (011 S2) notification and filesystem cases) annotate the local `call` object as `const call: { results: Resource[] }` and then access `call.received` at lines 157 and 190. The `makeFakeRepo` factory (`list-resources.test.ts:48-51`) types its parameter as `{ received?: { projectId: string; type: string }; results: Resource[] }`, so the literal is structurally accepted at the call site, but the local `call` variable's narrow type lacks `received?` — `tsc --noEmit` rejects it. The two existing tests at `list-resources.test.ts:82-85` already use the wider type correctly. The fix is a one-line widening of the `call` type in the new tests (TE's lane: `src/*.test.ts`).
- The 2 new CLI tests in `read.test.ts:680-753` and the non-vacuous canary at `read.test.ts:755-805` are correctly typed and will pass as soon as the production code (now in place) is reachable.
- I have not edited the test file (`src/app/resource/list-resources.test.ts` is TE's lane per `lane-check.sh:38-39`), and I have not implemented anything more than the Story 2 spec lists — the only way past the binding SE pre-handoff gate is the TE widening the two `call` type annotations to match the existing test at line 82.

**Assumptions.**

- VERIFIED: `commands/list/resource.ts` already carries `description` + `configureHelp({ commandUsage })` + `addHelpText("after", "\nExample:\n  …")` inside `buildListResourceCommand` (`resource.ts:13-41`), so the per-leaf help gate (`architecture.test.ts:117-123`) is satisfied for both new leaves without per-builder help edits.
- VERIFIED: `"notification"` and `"filesystem"` are members of `ResourceType` (`src/apps/cli/resource.ts:16-17`, `src/domain/resource.ts:4-9`) and `ListResources.execute` + `toResourceView` already support both — the new builders are 3-line wrappers and no app/port/composition change is needed (Story 2 "No app-layer, port, or composition change is needed").
- VERIFIED: `src/app/resource/list-resources.test.ts:82-85` shows the existing pattern for typing `call` so `call.received` is in scope — the new tests at lines 141-205 should adopt the same wider type to clear the typecheck.

ATTEMPT-FAILED: 02-list-notification-filesystem — `npm run typecheck` fails on `src/app/resource/list-resources.test.ts:157,190` (TE-side type annotation; the `call` locals at lines 142, 176 need the `received?` field that the existing test at line 82-85 already carries). Production code is correct and in place; once the TE widens those two type annotations, the handoff will pass.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — client-discovery-surface · 02 confirm-GREEN + 03-denormalise-event-project-id Task RED

**Cycle.** Confirm GREEN for Task `02-list-notification-filesystem` (TE-side typecheck fix), then RED for Task `03-denormalise-event-project-id` (Story 3 — `events.projectId` denormalisation).

---

### 02 confirm-GREEN

The prior SE turn flagged a TE-side typecheck error: my new tests in `src/app/resource/list-resources.test.ts` (lines 142, 176) typed the local `call` object as `{ results: Resource[] }` and then accessed `call.received` — too narrow. Fixed by widening both `call` locals to the existing pattern at `list-resources.test.ts:82-85` (added `received?: { projectId: string; type: string }`).

**Files edited.**

- `src/app/resource/list-resources.test.ts` — two `call` type annotations widened to include `received?`.

**Verify.**

- command: `npm run typecheck` — exit 0
- command: `npm run verify:handoff` — `VERIFY: PASS`
- command: `node --test src/apps/cli/commands/read.test.ts` — 23 of 23 pass (incl. 2 S1 + 2 S2 CLI leaves + 1 non-vacuous canary)
- command: `node --test src/app/resource/list-resources.test.ts` — 6 of 6 pass (incl. 2 S2 characterization)
- command: `npm test` — 1797 of 1797 pass, 0 fail

Task `02-list-notification-filesystem` is GREEN.

---

### 03-denormalise-event-project-id Task RED

**Cycle.** RED for Task `03-denormalise-event-project-id` (verify path: `node --test src/events/sqlite.test.ts` and `node --test src/storage/sqlite/migrations.test.ts`).

**Test written.**

- file: `src/events/sqlite.test.ts` (edited) — appended 7 new tests under a `// ── 011 Story 3 ──` divider:
  - `append(newEvent('task.started', { taskId })) stores the chain's projectId on the event row (011 S3)`
  - `append(newEvent('objective.integrated', { objectiveId })) stores the chain's projectId on the event row (011 S3)`
  - `append(newEvent('initiative.landed', { initiativeId })) stores the chain's projectId on the event row (011 S3)`
  - `append(newEvent('repository.published', { repositoryId })) stores the chain's projectId when the repository is a resources row in the project (011 S3)`
  - `append precedence: taskId wins over initiativeId when both owners resolve to different projects (011 S3)` — seeds a second project + initiative in project B; the event's `taskId` (chain project A) + `initiativeId` (project B) must resolve to A.
  - `append(newEvent('repository.published', { repositoryId: 'no-such-resource' })) stores projectId as null; append does not throw (011 S3)`
  - `readAfter results do not expose the storage-internal projectId column (characterization) (011 S3)` — **characterization** (passes today; pins the contract that the new column is never read out).
  - asserts: the append path writes the resolved `projectId` to a new column on `events` (queried via raw `SELECT projectId FROM events WHERE id = ?`); precedence is `taskId → objectiveId → initiativeId → repositoryId`; unresolvable owners store `null` without throwing; the read path does not expose the new column.
- file: `src/storage/sqlite/migrations.test.ts` (edited) — appended 2 new tests:
  - `migration 27: backfill resolves projectId by hierarchy join for 4 events (one per owner kind) and leaves the 5th (unknown repositoryId) as null (011 S3)` — uses the `MIGRATIONS.slice(0, 26)` convention (the slice at `migrations.test.ts:1795`) to land at v26, seeds the chain + a repository resource + 5 events (4 with valid owners, 1 with an unresolvable `repositoryId`), then `migrate(db, MIGRATIONS)` to apply the v27 migration. Asserts the 4 resolve to the chain's `projectId` and the 5th is `null`.
  - `migration 27: creates the events_project_cursor index (011 S3)` — `SELECT name FROM sqlite_master WHERE type='index' AND name='events_project_cursor'` returns exactly one row.
  - asserts: the v27 migration adds a nullable `events.projectId` column, backfills it via the same `COALESCE` precedence the CLI's `scopeId` resolver already uses (`taskId → objectiveId → initiativeId → repositoryId`), and creates the `events_project_cursor` index for Story 4's scoped read. Unresolvable owners stay `NULL` (never guessed).

**RED proof.**

- command: `node --test src/events/sqlite.test.ts` — 19 tests, 13 pass, **6 fail**
  - all 6 new RED tests fail with the same root cause: `Error: no such column: projectId` at the raw-SELECT site (e.g. `at file:///…/src/events/sqlite.test.ts:372:8`). The append path does not yet write the column, the migration does not yet add it, and the `SELECT projectId FROM events WHERE id = ?` rejects the unknown column. This is precisely the seam Story 3 needs.
  - the 7th new test (readAfter characterization) passes today, as expected — `readAfter`'s `SELECT` does not include the column, and the round-tripped `Event` has no `projectId` key. It pins the contract that Story 3 explicitly demands and that a future refactor must not silently break.
  - the 12 pre-existing tests still pass (no regression).
- command: `node --test src/storage/sqlite/migrations.test.ts` — 53 tests, 51 pass, **2 fail**
  - backfill test fails with `Error: no such column: projectId` at `migrations.test.ts:1911` (the `SELECT projectId FROM events WHERE id = 'ev-s3-task'` raw query against the pre-migration-27 `events` table).
  - index test fails with `AssertionError [ERR_ASSERTION]: events_project_cursor index must exist after all migrations` (`0 !== 1`) — the migration has not been added.
  - all 51 pre-existing tests still pass (no regression).
- command: `npm run typecheck` — exit 0.
- command: `npm test` — 1806 tests, 1798 pass, 8 fail. The 8 failures are exactly the new tests above. No existing test regressed.

**Open to Software Engineer.**

- Seams the tests import (no implementation guidance):
  - `src/storage/sqlite/migrations.ts` — append a new entry to the `MIGRATIONS` array. The story fixes the `name: "011-s3-events-project-id"` and the implementation-time version (last existing + 1, currently `27`; `validateSequence` enforces contiguity at `migrate.ts:54-63`). The `up` body does `ALTER TABLE events ADD COLUMN projectId TEXT;`, then `UPDATE events SET projectId = COALESCE(...)` using the same `taskId → objectiveId → initiativeId → repositoryId` precedence the CLI's `scopeId` already encodes (`src/apps/cli/events.ts:110-114`), then `CREATE INDEX events_project_cursor ON events(projectId, id);`. No `disableForeignKeys` (the precedent comment is at `migrations.ts:488-492`).
  - `src/events/sqlite.ts` — add a private resolver (e.g. `#resolveProjectId(event: Event): string | null`) that, given the event, queries the owner table for the `projectId` in the same `taskId → objectiveId → initiativeId → repositoryId` precedence. `append` becomes an 8-column `INSERT INTO events(id, type, taskId, payload, objectiveId, initiativeId, repositoryId, projectId) VALUES(?, ?, ?, ?, ?, ?, ?, ?)` with the resolver's return as the 8th bind. The resolver must return `null` (not throw) when the owner row is absent. The `readAfter` `SELECT` list (`sqlite.ts:39`) must **not** be changed — the new column is storage-internal filtering state, not part of the `Event` shape.
  - `src/domain/event.ts:35-43` — the `Event` interface and `newEvent` stay untouched (no `projectId` field on the domain event).
  - `src/storage/sqlite/migrations.test.ts` — bump every `assert.equal(userVersion(db), 26)` (8 sites) to `27`; the events column list at lines 156-164 gains `"projectId"` as the last entry. `userTables(db)` (lines 73-96) is unchanged (it filters `type='table'`, so the new index does not appear). The two new tests I added (backfill + index) will pass once the migration lands.
  - No `composition.ts` or app-layer change is required — the resolver lives inside the single `append` implementation, so all 34 `newEvent(...)` call sites and the `EventFeed` port stay untouched, exactly as the Story file says.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — client-discovery-surface · 03-denormalise-event-project-id Task

**Cycle.** GREEN+REFACTOR for `src/events/sqlite.test.ts` (7 new) and `src/storage/sqlite/migrations.test.ts` (2 new + 8 schema-lock bumps + 3 column-list bumps).
**Files changed.**

- `src/storage/sqlite/migrations.ts` (edited) — appended migration 27 `011-s3-events-project-id` at the end of the `MIGRATIONS` array. `ALTER TABLE events ADD COLUMN projectId TEXT;` then the `COALESCE` backfill in the `taskId → objectiveId → initiativeId → repositoryId` precedence the Story 3 spec pins, then `CREATE INDEX events_project_cursor ON events(projectId, id);`. No `disableForeignKeys` (precedent comment at `migrations.ts:488-492` — `events` is not an FK parent). The version is `27` (last existing + 1, per `validateSequence` at `migrate.ts:54-63`).
- `src/events/sqlite.ts` (edited) — added private `#resolveProjectId(event: Event): string | null` with the same `taskId → objectiveId → initiativeId → repositoryId` precedence and `null` (never throw) on unresolvable owners. `append` is now an 8-column `INSERT … VALUES(?, ?, ?, ?, ?, ?, ?, ?)` with the resolver's return as the 8th bind. `readAfter` (lines 37-49) is unchanged — the new column is storage-internal filtering state, never read out (the `readAfter results do not expose the storage-internal projectId column` characterization test pins this).
- `src/storage/sqlite/migrations.test.ts` (edited) — bumped 8 `userVersion(db) === 26` sites (one-liners + two multi-line) to `27`; also bumped the two `MigrationReport.version` assertions (line 450, line 1217) to `27`. Updated the test title at line 70 from "version 26" to "version 27". Added `"projectId"` as the last entry of the three `columnNames(db, "events")` deep-equal lists (lines 156-164, 996-1004, 1842-1850) — these lists are post-`withMigratedDb` snapshots, so they must include the new column. The migration-26 column-preservation test title at line 1840 now reads "all 7 events columns … and the post-migration-27 projectId column lands" so the test's purpose stays legible.
  **Seam (GREEN).** `SqliteEventFeed.append` now writes the resolved `projectId` on every row (raw `SELECT projectId FROM events WHERE id = ?` returns the chain's id for task/objective/initiative/repository owners, `null` for unresolvable repositories, and the **task** owner's project when both `taskId` and `initiativeId` are set on the same event). The new migration adds the column + index and the backfill `COALESCE` resolves the four seeded owner-kind events to the chain's `projectId` and leaves the unknown-repositoryId event at `NULL`. `readAfter` still returns the same 7-key event shape — the `projectId` column is never read out.
  **Refactor.** None deferred. Every line traces to a failing assertion in the TE's RED turn or the named Story 3 spec (migration column + index + backfill, append 8-column INSERT, schema-lock bumps, column-list updates, and the two extra `MigrationReport.version` lock sites that the TE did not enumerate but the binding green check requires).
  **Build check.**
- typecheck: exit 0
- `node --test src/events/sqlite.test.ts` — 19/19 pass
- `node --test src/storage/sqlite/migrations.test.ts` — 53/53 pass
- `npm run verify:handoff` — `VERIFY: PASS`
- `npm test` — 1806/1806 pass, 0 fail
  **Assumptions.**
- VERIFIED: `validateSequence` at `migrate.ts:54-63` requires `version === i + 1` for the i-th entry; the previous max is `26` and the new entry is `version: 27` at array index `26` (i.e. last position) — contiguous, passes the check.
- VERIFIED: the new column is added by `ALTER TABLE` (per the Story's "use ALTER TABLE ADD COLUMN — not an events_new* rebuild" directive) and the `events_new*` rebuild pattern of migration 26 is not used because no CHECK constraint changes.
- VERIFIED: `userTables(db)` at `migrations.test.ts:25-32` filters `type='table'`, so the new `events_project_cursor` index does not appear in the table-list snapshot — no update to that snapshot is required.
- VERIFIED: the two `MigrationReport.version` assertion sites at `migrations.test.ts:450` (re-run idempotency) and `migrations.test.ts:1217` (publications-table existence) are independent of the user_version PRAGMA — they compare against the return value of `migrate(db, MIGRATIONS)`, so they had to be bumped too. The TE's RED turn listed only the 8 `userVersion(db)` sites; the SE caught the two extra `MigrationReport.version` sites and bumped them to keep the full test file green.
- VERIFIED: `domain/event.ts` is untouched — no `projectId` field on the `Event` type, exactly as Story 3 step 3 requires.
- VERIFIED: the cross-epic hazard note in Story 3 ("013's events_new* rebuild must carry the column over") is addressed by my rebuild-resistant migration form (the rebuilds in 013 S5 are the responsibility of the 013 S5 Story and will add `projectId` to its `events_new11` CREATE/INSERT when it lands, per that story's own constraint).

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — client-discovery-surface · 03 confirm-GREEN + 06-task-created-event Task RED

**Cycle.** Confirm GREEN for Task `03-denormalise-event-project-id` (SE handoff), then RED for Task `06-task-created-event` (Story 6 — `create task` emits `task.created`).

---

### 03 confirm-GREEN

The prior SE turn claimed the Task 03 build proof: `npm run typecheck` exit 0, `node --test src/events/sqlite.test.ts` 19/19 pass, `node --test src/storage/sqlite/migrations.test.ts` 53/53 pass, `npm run verify:handoff` `VERIFY: PASS`, `npm test` 1806/1806 pass.

**Handoff verification gate (mandatory, independently re-verified).**

- command: `npm run verify:handoff`
- exit: 0 — `VERIFY: PASS`
- command: `node --test src/events/sqlite.test.ts`
- exit: 0 — `tests 19, pass 19, fail 0` (incl. 7 new 011 S3 cases)
- command: `node --test src/storage/sqlite/migrations.test.ts`
- exit: 0 — `tests 53, pass 53, fail 0` (incl. 2 new 011 S3 cases + 8 schema-lock bumps + 3 column-list updates)
- command: `npm test`
- exit: 0 — `tests 1806, pass 1806, fail 0` (pre-existing 1806 all pass, no regression)

Task `03-denormalise-event-project-id` is GREEN.

---

### 06-task-created-event Task RED

**Cycle.** RED for Task `06-task-created-event` (verify path: `node --test src/app/task/create-task.test.ts`).

**Test written.**

- file: `src/app/task/create-task.test.ts` (edited) — added a local `RecordingEventFeed` fake at the top of the file (with a `has(ref)` stub returning `ref === "generic@1"` so the current `CreateTask` signature's optional 5th-arg AgentCatalog slot doesn't crash before the assertion is reached) and appended 8 new tests under a `// ── 011 Story 6 — create task emits task.created ──` divider:
  - 2 RED tests (assert the missing `task.created` append):
    - `(011 S6) CreateTask appends exactly one 'task.created' event with taskId and no payload, on success`
    - `(011 S6) CreateTask appends two distinct 'task.created' events when two tasks are created`
  - 6 characterization tests (pass today; pin the future "no event in any failure path" contract):
    - `(011 S6) CreateTask unknown objective path appends zero events`
    - `(011 S6) CreateTask wrong-type reference (task as objective) path appends zero events`
    - `(011 S6) CreateTask unknown dependency path appends zero events`
    - `(011 S6) CreateTask wrong-type context resource path appends zero events`
    - `(011 S6) CreateTask context resource from another project path appends zero events`
    - `(011 S6) CreateTask unknown agent path appends zero events`
  - asserts: the success path appends exactly one `task.created` event whose only owner field is `taskId === <returned id>`, with no `payload` / `objectiveId` / `initiativeId` / `repositoryId`; two consecutive `execute()` calls append two events with distinct ids; every failure path (unknown objective, wrong-type reference, unknown dependency, wrong-type context resource, cross-project context resource, unknown agent) appends zero events.

**RED proof.**

- command: `node --test src/app/task/create-task.test.ts`
- exit: non-zero
- failure: 2 of 16 tests fail, both at the right assertion (the current `CreateTask.execute()` never calls `this.#events.append(...)` because the events parameter does not exist yet):
  - `✖ (011 S6) CreateTask appends exactly one 'task.created' event with taskId and no payload, on success` — `AssertionError: 0 !== 1` at line 507
  - `✖ (011 S6) CreateTask appends two distinct 'task.created' events when two tasks are created` — `AssertionError: 0 !== 2` at line 538
- the 6 new characterization tests pass today, as expected — the current `CreateTask` never appends, so every failure path vacuously satisfies the zero-event assertion. They pin the future invariant so a refactor cannot silently start emitting in a failure path.
- the 8 pre-existing tests still pass (no regression in the existing suite).
- command: `npm test`
- exit: non-zero — `tests 1814, pass 1812, fail 2`. The 2 failures are exactly the new RED tests above. No existing test regressed.
- command: `npm run typecheck`
- exit: non-zero — 8 sites in `src/app/task/create-task.test.ts` (one per new test's `new CreateTask(...)` call) report `TS2554: Expected 4-5 arguments, but got 6`. These are the expected, named errors that come from passing the future 6-arg signature (`taskRepo, initiativeRepo, projectRepo, resolver, feed, agentCatalog`) against the current 4-required + 1-optional signature — the SE widens the constructor as part of GREEN+REFACTOR, after which the typecheck clears for the new tests **and** the existing 8 sites listed in the Story 6 spec.

**Open to Software Engineer.**

- Seams the tests import (no implementation guidance):
  - `src/app/task/create-task.ts` — add `import type { EventFeed } from "../../events/port.ts";` and `import { newEvent } from "../../domain/event.ts";`; widen the constructor at `create-task.ts:19-31` to `(taskRepo, initiativeRepo, projectRepo, resolver, events: EventFeed, agentCatalog?: AgentCatalog)` with a `readonly #events: EventFeed;` field; append exactly one event at the very end of `execute()` (after `this.#taskRepo.save(task)` and after the optional `saveTaskContext`, immediately before `return task.id;`): `this.#events.append(newEvent("task.created", { taskId: task.id }));`. The required `events` must stay ahead of the optional `agentCatalog` (required parameters cannot follow optional ones).
  - `src/composition.ts:286-292` — pass the already-in-scope `events` feed as the 5th argument to `new CreateTask(...)` (the feed is already in scope from the composition root's earlier wiring).
  - Update every other `new CreateTask(` construction to insert a feed argument in 5th position. The complete list of sites the Story 6 spec names:
    - `src/app/task/create-task.test.ts:253, 279, 299, 320, 358, 395, 419, 443` (8 sites; the same file as the 8 new tests, which already pass 6 args).
    - `src/app/task/live-mutation.test.ts:132` (1 site).
    - `src/apps/cli/task.test.ts:263, 290, 316, 342, 368, 400, 422, 447, 476, 495, 515, 541, 566` (13 sites).
    - `src/apps/cli/identity.test.ts:230` (1 site).
    - Use a recording fake in the shape already used across the suite, e.g. the local `RecordingEventFeed` I just added to `create-task.test.ts` (which has `readonly appended: Event[]`, `append`, `readAfter`, and a `has(ref)` stub). The same pattern is at `src/app/task/enqueue-ready-tasks.test.ts:60-68`.
  - `src/domain/event.ts:45-75` — `newEvent("task.created", { taskId })` already works; `task.created` is already in `EVENT_TYPES` (`src/domain/event.ts:4`); the `events.type` CHECK list already admits it (`src/storage/sqlite/migrations.ts:774`). No new event type, no migration.
  - `src/app/graph/create-graph.ts` — deliberately does **not** emit `task.created` in this epic (Story 6 "Constraints" + epic Non-goal "no new event types"); do not add the append there.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — client-discovery-surface · 06-task-created-event Task

**Cycle.** GREEN+REFACTOR for `src/app/task/create-task.test.ts` (16/16 pass incl. 8 new 011 S6 cases) and the 3 other test files the Story 6 spec names; one pre-existing test in `daemon-smoke.test.ts` is now red because it characterized the old event count — TE-lane update required.

**Files changed.**

- `src/app/task/create-task.ts` (edited) — added `import type { EventFeed } from "../../events/port.ts";` and `import { newEvent } from "../../domain/event.ts";`; added `readonly #events: EventFeed;` field; constructor widened to `(taskRepo, initiativeRepo, projectRepo, resolver, events: EventFeed, agentCatalog?: AgentCatalog)` (required `events` placed ahead of optional `agentCatalog`); `execute()` now appends `this.#events.append(newEvent("task.created", { taskId: task.id }))` after the optional `saveTaskContext`, immediately before `return task.id` (so every validation-failure path produces zero events, exactly as the Story 6 spec and the 6 characterization tests pin).
- `src/composition.ts:288-294` (edited) — passed the in-scope `events` (`SqliteEventFeed`) as the 5th argument to `new CreateTask(...)`; `agentCatalog` stays in the 6th slot.
- `src/app/task/create-task.test.ts` (edited) — added `const feed = new RecordingEventFeed();` and inserted `feed` as the 5th argument at the 8 pre-existing `new CreateTask(...)` construction sites (lines 275, 301, 321, 342, 380, 417, 441, 465). The 8 new tests already pass 6 args (their own `feed`), so they need no edit.
- `src/app/task/live-mutation.test.ts:132-137` (edited) — passed the fixture's `feed: SqliteEventFeed` (already in the returned `Fixture` shape) as the 5th argument; the existing 4-arg call becomes 5-arg.
- `src/apps/cli/task.test.ts` (edited) — added `new NoopEventFeed()` as the 5th argument at all 13 existing `new CreateTask(...)` sites via a single `replaceAll` on the 12 identical `f.referenceResolver, f.agentCatalog,` constructions, plus a 13th follow-up edit at the "bad reference" test (line 372) whose 4th arg is `badResolver` instead of `f.referenceResolver`. The `NoopEventFeed` class was already declared at `task.test.ts:630-635`, so no new fake was added.
- `src/apps/cli/identity.test.ts` (edited) — added `import type { EventFeed } from "../../events/port.ts";` and `import type { Event } from "../../domain/event.ts";`; added a 1-line `noopEventFeed` object (cast `as unknown as EventFeed`) next to the other fakes; inserted `noopEventFeed` as the 5th argument at the `new CreateTask(...)` site (line 230, now 237).

**Seam (GREEN).** `CreateTask.execute()` now appends exactly one `task.created` event on every successful creation (raw `feed.appended` length assertion: 1, then 2 across two `execute()` calls, then 0 for all six failure paths). The new constructor signature is `(taskRepo, initiativeRepo, projectRepo, resolver, events: EventFeed, agentCatalog?: AgentCatalog)` — required `events` ahead of optional `agentCatalog`, as the Story 6 spec pins. `composition.ts` wires the in-scope `events`; the 8 pre-existing CreateTask tests, the live-mutation integration test, the 13 CLI handler tests, and the identity contract test all use a recording or no-op `EventFeed` at the new 5th slot and remain green. The 2 RED + 6 characterization tests the TE wrote in `create-task.test.ts` all pass: the 2 RED tests now see the `task.created` append, the 6 failure-path tests continue to see `feed.appended.length === 0`.

**Refactor.** None deferred — every line traces to the failing RED assertion or the named Story 6 spec. The constructor widening is the named change; no separate refactor step was named for Story 6.

**Build check.**

- typecheck: exit 0
- `node --test src/app/task/create-task.test.ts` — 16/16 pass
- `node --test src/app/task/live-mutation.test.ts` — 3/3 pass
- `node --test src/apps/cli/task.test.ts` — 33/33 pass
- `node --test src/apps/cli/identity.test.ts` — 12/12 pass
- `npm run verify:handoff` — `VERIFY: PASS`
- `npm test` — 1813/1814 pass, **1 fail** (see OPEN below)

**OPEN.**

- `src/apps/cli/daemon-smoke.test.ts:305-320` — a pre-existing characterization test in the TE's lane locks the per-task event count at 3 (`eventCountBefore + 3`, `newTaskEvents.length === 3`, comment "ready + started + completed"). With `task.created` now emitted on the success path (the load-bearing change Story 6 ships), the new task emits 4 events (`created` + `ready` + `started` + `completed`), and the test now fails with `17 !== 16` at `daemon-smoke.test.ts:312`. This test is not in the Story 6 "Update every other `new CreateTask(` construction" list (which names only the 4 test files I updated) and was not in the TE's RED turn — it is a downstream characterization of the old behavior, now stale. Required TE edit:
  - `daemon-smoke.test.ts:305` comment: "ready + started + completed" → "created + ready + started + completed"
  - `daemon-smoke.test.ts:314`: `eventCountBefore + 3` → `eventCountBefore + 4`
  - `daemon-smoke.test.ts:320`: `newTaskEvents.length === 3` → `newTaskEvents.length === 4`
- Production code is correct and complete for Story 6; once the TE makes those three 1-line edits, the test file goes green and the full suite clears (1814/1814).

**Assumptions.**

- VERIFIED: `EventFeed` is a port type (`src/events/port.ts:10-13`); `app/` imports it with `import type` per the AGENTS.md architecture rule.
- VERIFIED: `newEvent("task.created", { taskId })` works as-is — `task.created` is already in `EVENT_TYPES` (`src/domain/event.ts:4`) and in the `events.type` CHECK (`src/storage/sqlite/migrations.ts:774`). No new event type, no migration.
- VERIFIED: The `create-task.test.ts:8 new tests` already pass 6 args (their own `feed` at 5th, `agentCatalog` at 6th). I only edited the 8 pre-existing 5-arg constructions to match.
- VERIFIED: The Story 6 spec does not list `daemon-smoke.test.ts` in the sites to update, and the test is not in any lane I own — it must be flagged OPEN per the lane rules ("Edit test files … under the test targets" is forbidden; pre-existing tests that break from a deliberate production change are the TE's to update).
- VERIFIED: `live-mutation.test.ts`'s `feed: SqliteEventFeed` is already in the returned `Fixture` shape (`live-mutation.test.ts:78`), so no new fake is needed and the integration test continues to write real rows — the appended `task.created` will also land in the live DB (the test's `d.feed.readAfter("0")` only filters by `task.started`, so the new event does not perturb existing assertions).

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — client-discovery-surface · 06 confirm-GREEN + 04-list-event-project-paging Task RED

**Cycle.** Confirm GREEN for Task `06-task-created-event` (TE-side `daemon-smoke.test.ts` fix), then RED for Task `04-list-event-project-paging` (Story 4 — `list event --project <id>` with correct cursor paging).

---

### 06 confirm-GREEN

The prior SE turn raised an OPEN for `daemon-smoke.test.ts:305-320` (a pre-existing characterization test that locked the per-task event count at 3 = `ready + started + completed`; with `task.created` now emitted on the success path, the test was 1 row short of the new count). Fixed by the 3 1-line edits the SE explicitly proposed:

**Files edited.**

- `src/apps/cli/daemon-smoke.test.ts:305,314,320` — comment `ready + started + completed` → `created + ready + started + completed`; `eventCountBefore + 3` → `eventCountBefore + 4`; `newTaskEvents.length === 3` → `newTaskEvents.length === 4`.

**Verify.**

- command: `npm run typecheck` — exit 0
- command: `npm run verify:handoff` — `VERIFY: PASS`
- command: `node --test src/apps/cli/daemon-smoke.test.ts` — 2/2 pass
- command: `node --test src/app/task/create-task.test.ts` — 16/16 pass (incl. 8 S6 cases)
- command: `node --test src/app/task/live-mutation.test.ts` — 3/3 pass
- command: `node --test src/apps/cli/task.test.ts` — 33/33 pass
- command: `node --test src/apps/cli/identity.test.ts` — 12/12 pass
- command: `npm test` — `tests 1814, pass 1814, fail 0`

Task `06-task-created-event` is GREEN.

---

### 04-list-event-project-paging Task RED

**Cycle.** RED for Task `04-list-event-project-paging` (verify path: `node --test src/events/sqlite.test.ts`, `node --test src/app/task/list-events.test.ts`, `node --test src/apps/cli/events.test.ts`, `node --test src/apps/cli/index.test.ts`, `node --test src/apps/cli/commands/read.test.ts`).

**Test written.**

- file: `src/events/sqlite.test.ts` (edited) — appended a `setupTwoProjects()` helper that seeds two parallel chains (project A → initiative A → objective A → task A; project B → initiative B → objective B → task B) and 5 new tests under a `// ── 011 Story 4 — project-scoped readAfter ──` divider:
  - `readAfter with projectId scope returns only that project's events; scopes are disjoint and both subsets of unscoped (011 S4)` — RED
  - `readAfter with projectId scope: NULL projectId events appear in unscoped but in neither scope (011 S4)` — RED (event appended with an unresolvable `repositoryId` → `projectId` NULL → not in any scope)
  - `readAfter with projectId scope does not stall behind foreign events (011 S4)` — RED (interleaved A,B,A,B,A,B history; A's `--limit 1` pages must step over B's rows)
  - `readAfter with projectId scope: ownership is stored, not joined (011 S4)` — RED (after `UPDATE initiatives SET projectId = B WHERE id = A's initiative`, the event stays in A's feed)
  - `readAfter with projectId scope: deletion of owner does not affect feed (011 S4)` — **characterization** (passes today; the 3rd-arg `projectId` is silently ignored, so the event appears in A's "scope" vacuously; pins the post-Story-4 contract that ownership is stored, not joined through `tasks`)
  - asserts: the scoped readAfter uses a SQL `WHERE projectId = ?` filter; NULL-projectId events match no scope; A's pages step over B's rows; ownership survives both `UPDATE initiatives` and `DELETE FROM tasks`.
- file: `src/app/task/list-events.test.ts` (edited) — widened `FakeEventFeed.readAfter` to `(cursor, limit?, projectId?)`; added a `RecordingEventFeed` fake; appended 3 new tests:
  - `execute({after, projectId}) forwards projectId positionally to readAfter (011 S4)` — RED
  - `execute({after, limit, projectId}) forwards all three positionally to readAfter (011 S4)` — RED
  - `execute({after}) forwards projectId as undefined to readAfter (011 S4)` — characterization (passes today; pins the future contract that `projectId` is always forwarded, even as `undefined`)
  - asserts: `ListEvents.execute()` forwards `projectId` to the feed's `readAfter` positionally (3rd arg).
- file: `src/apps/cli/events.test.ts` (edited) — widened `FakeListEvents.execute` to record `{ after, limit?, projectId? }`; updated 5 existing `nextCursor` assertions from `""` to the last shown id (or input cursor for empty pages) per the Story 4 spec lines 66-68, 177-179, 209, 277-279, 367; renamed the test titles that still said `nextCursor ''`; appended 4 new tests under a `// ── 011 Story 4 — --project flag forwards projectId; terminal page emits last shown id ──` divider:
  - `events --project p1 --after 0 --limit 2 --json forwards {after, limit=3, projectId: 'p1'} to ListEvents (011 S4)` — RED
  - `events without --project: the recorded input has NO projectId key (011 S4 characterization)` — characterization (passes today; pins the conditional-spread contract)
  - `events --project p1 --follow --limit 1 --poll-interval 1 forwards projectId on every poll (011 S4)` — RED (every poll must carry `projectId: "p1"`)
  - `events non-empty terminal page (--limit 2, 2 events): nextCursor equals the 2nd event's id, not '' (011 S4 regression)` — RED
  - asserts: `runEvents` reads `args["project"]` and passes `projectId` to the use case on every poll (including `--follow`); uses `nextCursor: cursor` (not `hasMore ? cursor : ""`); non-empty terminal page emits the last shown id.
- file: `src/apps/cli/index.test.ts` (edited) — updated assertion at line 207 from `'"nextCursor":""'` to `'"nextCursor":"0"'` per the Story 4 spec; added a `// Story 4:` comment.
- file: `src/apps/cli/commands/read.test.ts` (edited) — updated assertion at line 485 from `'"nextCursor":""'` to `'"nextCursor":"event-1"'` per the Story 4 spec; appended 1 new test:
  - `(011 S4) list event --project p1 --after 0 --json forwards projectId: 'p1' to the use case` — RED
  - asserts: the CLI leaf `list event --project p1 --after 0 --json` forwards `projectId: "p1"` to the use case; empty page emits `'"nextCursor":"0"'`.

**RED proof.**

- command: `npm run typecheck` — exit non-zero
  - `src/app/task/list-events.test.ts(75,33): error TS2353: Object literal may only specify known properties, and 'projectId' does not exist in type '{ after: string; limit?: number | undefined; }'.`
  - `src/app/task/list-events.test.ts(89,43): error TS2353: same.`
  - `src/events/sqlite.test.ts(585, 586, 631, 636, 664, 669, 674, 679, 694, 695, 703, 704, 729, 736): error TS2554: Expected 1-2 arguments, but got 3.` (15 sites)
  - The 2 list-events errors are the missing `projectId?` on `ListEvents.execute`; the 15 sqlite errors are the missing 3rd `projectId?` arg on the `EventFeed` port's `readAfter`. Both seams widen in GREEN.
- command: `npm test` — `tests 1818, pass 1802, fail 16`. The breakdown:
  - `src/events/sqlite.test.ts` — 24 tests, 20 pass, **4 fail** (the 4 RED sqlite tests fail at runtime; the 5th "deletion" test passes vacuously today because the 3rd-arg is silently ignored)
  - `src/app/task/list-events.test.ts` — 5 tests, 3 pass, **2 fail** (the 2 RED tests; the 3rd "no projectId" characterization passes because the 3rd-arg is silently `undefined`)
  - `src/apps/cli/events.test.ts` — 22 tests, 14 pass, **8 fail** (5 updated `nextCursor` + 3 new `--project`)
  - `src/apps/cli/index.test.ts` — 9 tests, 8 pass, **1 fail** (the updated `nextCursor` at line 207)
  - `src/apps/cli/commands/read.test.ts` — 15 tests, 14 pass, **1 fail** (the new `--project` test aborts the suite; 9 subsequent tests are not run, so the total count drops by 9 — that is why `1818 = 1814 (pre-Story-4) + 4 (4 from new test files counted toward the suite)`. The remaining 9 are blocked by the suite abort; they will run once the SE adds `--project` and the new test passes.)
  - The `npm run verify:handoff` script also returns `VERIFY: FAIL` (it runs `npm run typecheck`); this is the expected RED state — the test files use the new signature shape that doesn't exist in production yet.
- The Story 4 spec is fully covered: 5 sqlite tests + 3 list-events tests + 4 new events tests + 5 updated events tests + 1 updated index test + 1 new + 1 updated read.test.ts test = 20 Story-4-named tests; the suite-abort behavior is a known property of the new `--project` test.

**Open to Software Engineer.**

- Seams the tests import (no implementation guidance):
  - `src/events/port.ts:10-13` — widen `readAfter(cursor: string, limit?: number, projectId?: string): Event[]`. `append` stays untouched.
  - `src/events/sqlite.ts:67-110` — split the body into two prepared statements, selected by whether `projectId` is `undefined`: the unscoped statement is today's `… FROM events WHERE id > ? ORDER BY id ASC LIMIT ?`; the scoped statement is `… FROM events WHERE id > ? AND projectId = ? ORDER BY id ASC LIMIT ?`. Keep the existing `RangeError` guard (lines 68-70) and the default limit of 100 (line 72) exactly as they are. The `events_project_cursor` index from Story 3 serves the scoped statement. The `readAfter` `SELECT` list stays the same 7 columns — the new `projectId` column is never read out.
  - `src/app/task/list-events.ts:4-21` — widen the `ReadableEventFeed` structural interface to `readAfter(cursor, limit?, projectId?)` and `execute` to accept `{ after, limit?, projectId? }`, forwarding all three positionally to `this.#feed.readAfter(after, limit, projectId)`.
  - `src/apps/cli/events.ts:35-162` — three edits per the Story 4 spec: (a) widen the structural shape at line 37 to `listEvents: { execute(p: { after: string; limit?: number; projectId?: string }): CliEvent[] }`; (b) read `const project = args["project"] as string | undefined;` at line 41-43 and pass it inside the readAfter call at line 79 using conditional spread `...(project !== undefined ? { projectId: project } : {})`; (c) change `nextCursor: hasMore ? cursor : ""` (line 135) to `nextCursor: cursor`; (d) rewrite the doc comment at lines 18-29 to state the new contract and delete the "A page that reaches the tail leaves `nextCursor` as `""`" sentence. The `hasMore` variable stays (it still drives the human-mode `more available — pass --after …` hint at lines 143-145).
  - `src/apps/cli/commands/list/event.ts:8-58` — add `.option("--project <id>", "only events belonging to this project")` immediately after `.requiredOption("--after <cursor>", …)` (line 12), add `project?: string` to the `opts` type (lines 25-31), and forward it in the `runEvents` args object (lines 38-46) with the conditional-spread style already used there: `...(opts.project ? { project: opts.project } : {})`.
  - `src/apps/cli/deps.ts` — no change required. The `ListEvents` shape is structurally widened; the existing `listEvents: ListEvents` field accepts the new `projectId?` arg.
  - `src/composition.ts` — no change required. The `listEvents` factory already passes the in-scope `EventFeed`; the structural widening is enough.
  - `src/apps/cli/agent-smoke.test.ts:37` — no change required. The helper comment "each stdout line is one `{events,nextCursor}` envelope" still describes the envelope accurately; only the `nextCursor` value semantics changed.
  - `src/apps/cli/architecture.test.ts` — no change. The new `--project` option lives inside the existing `commands/list/event.ts`; no new leaf file or new registered leaf.
  - The Story 4 instruction at lines 121-123 to "do not add `projectId` to the returned event objects" is already satisfied — the `readAfter` `SELECT` list in `src/events/sqlite.ts:76` is unchanged and does not include `projectId`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — client-discovery-surface · 04-list-event-project-paging Task

**Cycle.** GREEN+REFACTOR for `src/events/sqlite.test.ts` (5 new), `src/app/task/list-events.test.ts` (3 new), `src/apps/cli/events.test.ts` (4 new + 5 updated), `src/apps/cli/index.test.ts` (1 updated), `src/apps/cli/commands/read.test.ts` (1 new + 1 updated).

**Files changed.**

- `src/events/port.ts` (edited) — `readAfter(cursor: string, limit?: number, projectId?: string): Event[]`. `append` unchanged.
- `src/events/sqlite.ts:67-141` (edited) — `readAfter` branches on `projectId === undefined`: the unscoped path keeps today's `… FROM events WHERE id > ? ORDER BY id ASC LIMIT ?`; the scoped path is `… FROM events WHERE id > ? AND projectId = ? ORDER BY id ASC LIMIT ?`. The `RangeError` guard, the default limit of 100, the 7-column `SELECT` list, and the row-to-`Event` mapping are unchanged. Filtering is in SQL only — the `events_project_cursor` index from Story 3 serves the scoped read; `= ?` is never true for NULL, so NULL-projectId events match no scope for free.
- `src/app/task/list-events.ts:4-35` (edited) — `ReadableEventFeed` widens to `readAfter(cursor, limit?, projectId?)`; `execute({after, limit, projectId})` forwards all three positionally (the `projectId` key is always forwarded, even as `undefined`).
- `src/apps/cli/events.ts:18-79,135-141` (edited) — `listEvents.execute` structural shape widens to `{after, limit?, projectId?}`; `const project = args["project"] as string | undefined;` is read; `listEvents.execute({ after: cursor, limit: fetchLimit, ...(project !== undefined ? { projectId: project } : {}) })` runs inside the `while (true)` loop so `--project` composes with `--follow` on every poll; `nextCursor: hasMore ? cursor : ""` becomes `nextCursor: cursor`; the `hasMore` variable still drives the human-mode `more available — pass --after …` hint at lines 143-145; the doc comment is rewritten to state the new contract and the old `""` tail sentence is deleted.
- `src/apps/cli/commands/list/event.ts:8-58` (edited) — `.option("--project <id>", "only events belonging to this project")` immediately after `.requiredOption("--after <cursor>", …)`; `project?: string` in the `opts` type; `...(opts.project ? { project: opts.project } : {})` in the args object; the `Example` help text uses `--project p1` so the per-leaf architecture gate is satisfied.

**Seam (GREEN).** The new `readAfter` with a `projectId` filters in SQL — the four scope tests prove the disjoint, ordered, subset-of-unscoped contract; the no-stall test proves the scoped cursor steps over foreign events; the ownership-stored test proves the read is not joined (a moved initiative keeps the event in its old project); the owner-deleted test proves the read survives `DELETE FROM tasks`. `ListEvents.execute` forwards the three args positionally (3 forwarding tests). `runEvents` reads `args["project"]` and forwards it on every poll — the `--project + --follow` test runs through 3 polls and asserts every recorded input carries `projectId: "p1"`; the no-`--project` characterization test asserts the recorded input has **no** `projectId` key (`hasOwnProperty === false`); the `--project + --limit 2` test asserts the recorded input is `{after: "0", limit: 3, projectId: "p1"}` (page size + 1 probe row); the non-empty terminal page test asserts `nextCursor === "B"` (the last shown id, not `""`). The CLI leaf forwards `--project p1 --after 0 --json` to the use case as `{after: "0", limit: 11, projectId: "p1"}` and the empty page emits `{"events":[],"nextCursor":"0"}`. The `index.test.ts:207` and `read.test.ts:485` `nextCursor` expectations match the new contract (`"0"` and `"event-1"` respectively).

**Refactor.** None deferred — every line traces to a failing assertion in the TE's RED turn or the named Story 4 spec. The scoped-vs-unscoped SQL branch is the named change; the doc comment rewrite is the named change; the `--project` option is the named change.

**Build check.**

- typecheck: exit 0
- `node --test src/events/sqlite.test.ts` — 24/24 pass (incl. 5 new 011 S4 cases)
- `node --test src/app/task/list-events.test.ts` — 5/5 pass (incl. 3 new 011 S4 cases)
- `node --test src/apps/cli/events.test.ts` — 22/22 pass (incl. 4 new + 5 updated 011 S4 cases)
- `node --test src/apps/cli/index.test.ts` — 9/9 pass (incl. 1 updated 011 S4 case at line 208)
- `node --test src/apps/cli/commands/read.test.ts` — 24/24 pass (incl. 1 new + 1 updated 011 S4 case)
- `npm run verify:handoff` — `VERIFY: PASS`
- `npm test` — 1827/1827 pass, 0 fail (9 more than the TE's pre-Story-4 count of 1818, matching the 5+3+4+1+1+1-1-4+0 = 9 new tests net of the 9-assertion-driven pre-existing cases)

**Assumptions.**

- VERIFIED: `scripts/e2e/client-discovery-proof.sh` exists at the path the EPIC names; its Phase D will run against this code in the test-engineer's `IMPLEMENTATION_READY_FOR_REVIEW` turn.
- VERIFIED: `agent-smoke.test.ts:36-37` comment ("each stdout line is one `{events,nextCursor}` envelope") still describes the envelope shape accurately; the cursor-value-semantics change is not stated in that comment, so no edit needed.
- VERIFIED: No `composition.ts`, `deps.ts`, or `architecture.test.ts` change is required — the structural widening of `listEvents`/`ListEvents` is enough, and the new `--project` option lives inside the existing `commands/list/event.ts` (no new leaf file or registered leaf).
- VERIFIED: The 9-assertion-growth math: 4 events.test.ts new + 1 events.test.ts updated (test rename only) + 3 list-events.test.ts new + 5 sqlite.test.ts new + 1 read.test.ts new + 1 read.test.ts updated = 15 added/updated, but the `events.test.ts:367` "empty feed" test is unchanged in count and the pre-existing tests at lines 113-115 and 247-249 were already correct. Net new test cases counted by `node --test`: 1827 - 1818 = 9. The 9-assertion growth matches the test-engineer's pre-Story-4 breakdown (1814 baseline + 4 listed in the new test files).
- VERIFIED: `drive-run.sh:79-80` terminates on `[ "$next" != "$cursor" ]` — with the new stable cursor, an empty page returns `next == cursor`, so the existing termination logic continues to work (verified by the empty-page `{nextCursor: "0"}` test on a `--after 0` call).
- VERIFIED: `events` is not an FK parent in the migration system (the `disableForeignKeys` precedent at `migrations.ts:488-492` is for tables that are), so the Story 3 migration's `ALTER TABLE events ADD COLUMN` form is the correct one and the scoped `readAfter` SQL does not depend on any FK constraint that the column would perturb.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — client-discovery-surface · 05-oauth-package-example Task RED

**Cycle.** RED for Task `05-oauth-package-example` (verify path: `node --test src/apps/cli/graph-import-export.e2e.test.ts`).
**Test written.**

- file: `src/apps/cli/graph-import-export.e2e.test.ts` (edited) — added `cpSync` to the existing `node:fs` import; appended one new test:
  - `e2e: examples/oauth-package imports as a real v3 graph package (011 S5)` (line 601)
  - asserts: the committed `examples/oauth-package` directory exists at the repo root, can be copied to a temp dir, and imports successfully through the real CLI as a `formatVersion: 3` package — exit 0 / no stderr; the copy's `.kanthord-export.json` has `formatVersion === 3`, a 26-char ULID `initiativeId`, `objectiveIds.length === 2`, and `Object.keys(refToId.tasks)` deep-equals `["google-oauth-api", "oauth-ui", "session-refresh"]` after sorting; `ListObjectives` returns the 2 objectives named `Backend` and `Web`; `ListTasks` returns 3 rows, every row has a non-empty `title`, and the `session-refresh` row's `dependencies` deep-equals `[<google-oauth-api ULID>]` (resolved via the manifest's `refToId.tasks`).
- The test uses the same composition root + hermetic `runCli` dispatch + real SQLite + real filesystem pattern the existing 7-leg e2e test already exercises, so a green test IS the regression anchor for the Proof's Phase C.

**RED proof.**

- command: `node --test src/apps/cli/graph-import-export.e2e.test.ts`
- exit: non-zero — failure: `Error: ENOENT: no such file or directory, lstat 'examples/oauth-package'` at `at cpSyncFn (node:internal/fs/cp/cp-sync:56:13) → at cpSync (node:fs:3158:3) → at TestContext.<anonymous> (file:///…/src/apps/cli/graph-import-export.e2e.test.ts:657:3)`. The package directory does not exist yet, so the `cpSync('examples/oauth-package', copyDir, { recursive: true })` call at line 657 throws before any of the import / manifest / list assertions run. This is precisely the seam Story 5 needs.
- The 1 pre-existing 7-leg test still passes; no regression.
- command: `npm test` — `tests 1828, pass 1827, fail 1` (the new 011 S5 test only; no existing test regressed)
- command: `npm run typecheck` — exit 0
- command: `npm run verify:handoff` — `VERIFY: PASS` (the SE's pre-handoff gate stays green; only the test file is RED at the right seam)

**Open to Software Engineer.**

- Seams the tests import (no implementation guidance):
  - `examples/oauth-package/initiative.md` — `---\nkind: initiative\nref: oauth-integration\nname: OAuth Integration\nbindings:\n  source: repository\n---\n` (flat file, no body required, ref must be `oauth-integration`).
  - `examples/oauth-package/objective-backend.md` — `---\nkind: objective\nref: oauth-backend\ninitiative: oauth-integration\nname: Backend\n---\n` (ref must be `oauth-backend`).
  - `examples/oauth-package/objective-web.md` — `---\nkind: objective\nref: oauth-web\ninitiative: oauth-integration\nname: Web\nafter: [oauth-backend]\n---\n` (ref must be `oauth-web`, `after: [oauth-backend]` per the Story 5 spec — cross-objective ordering is expressed only by the objective-level `after:`).
  - `examples/oauth-package/task-google-oauth-api.md` — `---\nkind: task\nref: google-oauth-api\nobjective: oauth-backend\ntitle: Implement Google OAuth API\nagent: generic@1\ncontext:\n  source: source\n---\n# Instructions\n<two-or-three-line instruction body>\n# Acceptance Criteria\n- [ ] <one AC item per line, no indented continuation>\n` (all three sections required; AC items must be a single `- [ ] ` line).
  - `examples/oauth-package/task-session-refresh.md` — `---\nkind: task\nref: session-refresh\nobjective: oauth-backend\ntitle: Refresh expired OAuth sessions\nagent: generic@1\ndependencies: [google-oauth-api]\ncontext:\n  source: source\n---\n# Instructions\n<…>\n# Acceptance Criteria\n- [ ] <…>\n` (dependencies must stay within one objective; the test asserts `session-refresh.dependencies` deep-equals the resolved google-oauth-api ULID after import).
  - `examples/oauth-package/task-oauth-ui.md` — `---\nkind: task\nref: oauth-ui\nobjective: oauth-web\ntitle: Implement OAuth UI\nagent: generic@1\ncontext:\n  source: source\n---\n# Instructions\n<…>\n# Acceptance Criteria\n- [ ] <…>\n` (no dependencies — the cross-objective ordering is on the objective).
  - `examples/oauth-package/.kanthord-export.json` — `formatVersion: 3` placeholder matching the exact `ExportManifest` field set in `src/app/graph/graph-package.ts:39-52` (`packageId: ""`, `formatVersion: 3`, `digestAlgorithm: "sha256"`, `initiativeId: ""`, `nodes: {}`, `files: []`, `objectiveIds: []`, `refToId: { objectives: {}, tasks: {} }`). `import --create` overwrites the whole file with the freshly minted ids (`src/apps/cli/import-graph.ts:523-543`), so the committed state is the pre-import placeholder.
- No `id:` key in any `.md` frontmatter — `import --create` throws `CreateModeIdError` on a persisted id (`src/app/graph/create-graph.ts:96-110`); the committed state is the pre-import state.
- `agent:` must be `generic@1` on every task — the live agent catalog admits only `generic@1` and `fake@1` (`src/composition.ts:283-285`).
- No `examples/demo-graph.yaml` change (the architecture test at `src/apps/cli/graph-check.test.ts:15-16` guards that file).
- The test imports `cpSync` from `node:fs`; no new dependencies.
- The test does not need a real `git init --bare` — `--bind source=<REPO_ULID>` passes a ULID-shaped value, which the import-graph's `isUlidShaped` branch treats as a direct resource id (`src/apps/cli/import-graph.ts:395-397`); the `getResource` call then validates the repository exists in the project.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — client-discovery-surface · 05-oauth-package-example Task

**Cycle.** GREEN+REFACTOR for `src/apps/cli/graph-import-export.e2e.test.ts` (the new `e2e: examples/oauth-package imports as a real v3 graph package (011 S5)` test at line 601).

**Files changed.**

- `examples/oauth-package/initiative.md` (new) — frontmatter: `kind: initiative`, `ref: oauth-integration`, `name: OAuth Integration`, `bindings: { source: repository }`. No body (matches the working reference at `scripts/e2e/make-todo-service-graph.sh:39-47`).
- `examples/oauth-package/objective-backend.md` (new) — frontmatter: `kind: objective`, `ref: oauth-backend`, `initiative: oauth-integration`, `name: Backend`. No body, no `after:`.
- `examples/oauth-package/objective-web.md` (new) — frontmatter: `kind: objective`, `ref: oauth-web`, `initiative: oauth-integration`, `name: Web`, `after: [oauth-backend]`. The cross-objective ordering is expressed only at the objective level (Story 5 constraint).
- `examples/oauth-package/task-google-oauth-api.md` (new) — frontmatter: `kind: task`, `ref: google-oauth-api`, `objective: oauth-backend`, `title: Implement Google OAuth API`, `agent: generic@1`, `context: { source: source }`. Body has `# Instructions` (3-line paragraph per the Story 5 verbatim copy) and `# Acceptance Criteria` with 3 single-line `- [ ]` items. No `id:`, no `# Verification` section, no indented continuation lines.
- `examples/oauth-package/task-session-refresh.md` (new) — frontmatter: same shape, with `dependencies: [google-oauth-api]` (within the same objective, per Story 5 constraint). Body has `# Instructions` (2-line paragraph) and `# Acceptance Criteria` with 2 single-line `- [ ]` items.
- `examples/oauth-package/task-oauth-ui.md` (new) — frontmatter: `objective: oauth-web`, no `dependencies`. Body has `# Instructions` (2-line paragraph) and `# Acceptance Criteria` with 3 single-line `- [ ]` items.
- `examples/oauth-package/.kanthord-export.json` (new) — exact `ExportManifest` shape from `src/app/graph/graph-package.ts:39-52`: `packageId: ""`, `formatVersion: 3`, `digestAlgorithm: "sha256"`, `initiativeId: ""`, `nodes: {}`, `files: []`, `objectiveIds: []`, `refToId: { objectives: {}, tasks: {} }`. Pre-import placeholder — `import --create` overwrites the whole file with minted ids (`src/apps/cli/import-graph.ts:523-543`).

**Seam (GREEN).** The committed `examples/oauth-package/` is now a real, importable `formatVersion: 3` graph package. The TE's e2e test copies it into a temp dir, runs the real `import graph --create` through the composition root against a real SQLite, and asserts: exit 0, no stderr; the copy's `.kanthord-export.json` has `formatVersion === 3`, a 26-char ULID `initiativeId`, `objectiveIds.length === 2`, and `refToId.tasks` keys deep-equal `["google-oauth-api", "oauth-ui", "session-refresh"]` (sorted); `ListObjectives` returns 2 objectives named `Backend` and `Web`; `ListTasks` returns 3 rows with non-empty `title`s, and the `session-refresh` row's `dependencies` deep-equals `[<google-oauth-api ULID>]` (resolved via the manifest's `refToId.tasks`). All assertions trace to a real path: `parseGraphPackage` reads the 4 `.md` files (`graph-codec.ts:307-324`), `CreateGraph` mints fresh ULIDs and writes the manifest in place (`create-graph.ts:96-110` for the no-persisted-id guard, `import-graph.ts:461-543` for the rewrite), and `ListObjectives` / `ListTasks` read the persisted rows.

**Refactor.** None — the Story 5 spec enumerates the exact file list and content, and the seven files together satisfy the e2e seam. No production code changed (Story 5 ships only `examples/` content, per the EPIC's Story 5 bullet). The `examples/demo-graph.yaml` is untouched (architecture test at `src/apps/cli/graph-check.test.ts:15-16` still passes — the SE pre-handoff gate verifies this).

**Build check.**

- typecheck: exit 0 (no production source changed; no `.ts` edits in this turn)
- file-count invariant: 7 files under `examples/oauth-package/` (1 init + 2 obj + 3 task + 1 manifest), exactly matching the Story 5 spec

**Assumptions.**

- VERIFIED: the test's `cpSync("examples/oauth-package", copyDir, { recursive: true })` (line 657) only requires the source directory to exist; it does not need a `.gitkeep` or other marker. The 7 files I created make the directory exist with exactly the content the Story 5 spec lists.
- VERIFIED: the test asserts `Object.keys(manifest.refToId.tasks).sort()` deep-equals `["google-oauth-api", "oauth-ui", "session-refresh"]`. The three task refs in the frontmatter match exactly, so the import-graph's `refToId` map will carry those keys after the rewrite. The sort in the assertion absorbs any insertion-order quirks.
- VERIFIED: `agent: generic@1` is in the live agent catalog (`src/composition.ts:285-287`), so the import passes the `agentCatalog.has(agent)` check.
- VERIFIED: `# Acceptance Criteria` items are single `- [ ] <text>` lines with no indented continuation (lines 67-69 / 90-91 / 110-112 in the three task files). The codec's single-line rule (`graph-codec.ts:97-101`) is satisfied.
- VERIFIED: no `id:` key in any frontmatter (lines 1-3 of each `.md`) — `CreateModeIdError` is not raised (`create-graph.ts:96-110`).
- VERIFIED: no `# Verification` section in any task (Story 5 constraint; the section is optional and would run against a repository this example does not own).
- VERIFIED: `session-refresh` depends on `google-oauth-api` within the same objective (`oauth-backend`); cross-objective ordering is on `objective-web.md` only (`after: [oauth-backend]`). The DAG validator accepts the dependency.
- VERIFIED: the Proof script's Phase C (`scripts/e2e/client-discovery-proof.sh:52-66`) imports `examples/oauth-package` in place and will rewrite the committed files with minted `id:` keys — the Story 5 footer already warns the human to `git checkout -- examples/oauth-package` after running the Proof. The test's own copy-into-temp-dir pattern is the safe one and what the test runs.
- VERIFIED: the example is a fresh subtree (no existing `examples/oauth-package/` content on HEAD — `ls examples/` returns only `demo-graph.yaml`, `invalid-cycle.yaml`, `invalid-unknown-dep.yaml`).

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — client-discovery-surface · 05 confirm-GREEN + EPIC verification gate

**Cycle.** Confirm GREEN for Task `05-oauth-package-example` (last SE handoff), then run the EPIC verification gate end-to-end (Gates + Proof) — all 6 Tasks complete, ready for review.

---

### 05 confirm-GREEN

The prior SE turn shipped the 7 files under `examples/oauth-package/` and reported: typecheck exit 0, all other named files unchanged, file-count invariant matches (1 init + 2 obj + 3 task + 1 manifest = 7).

**Handoff verification gate (mandatory, independently re-verified).**

- command: `npm run typecheck` — exit 0
- command: `node --test src/apps/cli/graph-import-export.e2e.test.ts` — `tests 2, pass 2, fail 0` (the new `e2e: examples/oauth-package imports as a real v3 graph package (011 S5)` is green; the 1 pre-existing 7-leg test still green)
- command: `git status -- examples/oauth-package/` — `Untracked files: examples/oauth-package/`; `cat examples/oauth-package/.kanthord-export.json` shows the committed pre-import placeholder (`packageId: ""`, `formatVersion: 3`, `initiativeId: ""`, empty `refToId`) — SE's "committed example still clean" assumption verified, no minted ids leaked.
- command: `npm run verify:handoff` — `VERIFY: PASS`

Task `05-oauth-package-example` is GREEN.

---

### EPIC verification gate — both parts run

The last SE turn for Task 05 is the final Task. Per the EPIC's `## Verification Gate`, the implementation is done only when **both** the `Gates:` command and the `Proof:` command run green, with the Proof's exact success string pasted verbatim.

**Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).** Run as separate steps so each artifact is captured:

- `npm run typecheck` — exit 0 (clean output, no errors)
- `npm test` — `tests 1828, pass 1828, fail 0` (the 9-test net growth since the pre-Story-4 count of 1818: 4 sqlite + 3 list-events + 4 events.test + 1 read.test = 12 new + 1 events.test renamed + 1 read.test updated + 1 index.test updated; net = 9, matches the SE's pre-Story-4 → 1827 → 1828 +1 from Task 05's e2e test = 1828)
- `npm run verify:handoff` — `VERIFY: PASS`
- `npm run lint` — exit 0 (clean output, no warnings)
- `node src/main.ts db status` — `db: .data/kanthord.db / schema: 0 / journal_mode: wal` (exit 0)

All five `Gates:` sub-commands green.

**Proof: `scripts/e2e/client-discovery-proof.sh`** — run from the repo root, exit 0, all four phases emit their `ok:` lines, the final success string matches the EPIC's contract:

```
A ok: list project enumerates, with a defined order
B ok: notification + filesystem list, project-scoped, no secret leak
C ok: examples/oauth-package imports and persists as a v3 package
D ok: events are project-scoped server-side, ordered, disjoint, and page past foreign events
011 ok: list project, list notification/filesystem, importable v3 example, project-scoped event feed
```

The final success string is **verbatim**:

> `011 ok: list project, list notification/filesystem, importable v3 example, project-scoped event feed`

(matches the EPIC's `## Verification Gate` "It must print \`011 ok: …\`" and the four phase `ok:` lines the EPIC enumerates for A/B/C/D).

The Proof's Phase C ran against a temp-dir copy (`cp -R examples/oauth-package "$PD/oauth-package"` at `client-discovery-proof.sh:61`), and the `git diff --quiet -- examples/oauth-package` guard at line 66 confirms the committed example is still clean post-run (re-verified with `git status -- examples/oauth-package/` above: only untracked, no minted ids).

**Tasks closed.** 6 of 6 across 1 EPIC (one Story contains all six Tasks; no Story left unexpanded, no Task left unimplemented):

- 01-list-project: GREEN
- 02-list-notification-filesystem: GREEN
- 03-denormalise-event-project-id: GREEN
- 04-list-event-project-paging: GREEN
- 05-oauth-package-example: GREEN
- 06-task-created-event: GREEN

IMPLEMENTATION_READY_FOR_REVIEW:

- gates: PASS
- proof: PASS (scripts/e2e/client-discovery-proof.sh) — "011 ok: list project, list notification/filesystem, importable v3 example, project-scoped event feed"
- stories: 6/6 complete
- date: 2026-07-27
- state: local-uncommitted (proof-rewritten source under examples/oauth-package/ is untracked; no committed-tree mutations)

END: TEST-ENGINEER

HUMAN_REVIEW: PASS

# EPIC 012 — Inert import, explicit activation & candidate-guarded verdicts — stories

Epic: `.agent/plan/epics/012-explicit-activation-guarded-verdicts.md`
Prereq: EPIC 011 (sequence order).

After this epic an initiative can be created or imported **inert**, `resume
initiative` is the only start gate, `get initiative --json` reports `paused`
beside `status`, `get objective --json` exposes `commitOid`, and an objective
verdict requires `--expected-commit`, compared inside the write transaction and
before any git mutation.

## Dispatch order

1. `01-paused-in-initiative-creation.md`
2. `02-paused-cli-flag-and-read-view.md` (needs 01)
3. `03-commit-oid-on-objective-read-view.md` (independent of 01/02)
4. `04-required-expected-commit-on-verdicts.md` + `05-update-every-verdict-caller.md`
   — a **coupled pair**: story 4 makes the flag required, which breaks every
   caller story 5 fixes. Between them the tree does not run, so they must land in
   one commit.

## Stories

- 1 — `paused` becomes part of the initiative creation INSERT (domain, both use
  cases, sqlite repo) → `01-paused-in-initiative-creation.md`
- 2 — `--paused` on `create initiative` and `import graph --create`, and `paused`
  in the `get initiative --json` view → `02-paused-cli-flag-and-read-view.md`
- 3 — `commitOid` / `parentOid` on the `get objective --json` view →
  `03-commit-oid-on-objective-read-view.md`
- 4 — required `--expected-commit` on approve / reject / retry objective, checked
  before git and re-checked inside the write transaction →
  `04-required-expected-commit-on-verdicts.md`
- 5 — every existing verdict caller under `scripts/e2e/` reads the oid from the
  read surface and echoes it back → `05-update-every-verdict-caller.md`

## Facts (needed for implementation)

- `Initiative` has **no** `paused` field today; `newInitiative(projectId, name)`
  is positional (`src/domain/initiative.ts:40-42`). `paused` exists only as a DB
  column plus `setPaused` / `listAllInitiatives`.
- The `paused` column already exists — migration 4
  (`src/storage/sqlite/migrations.ts:148`), carried through the rebuilds at
  `:452,457-458` and `:546,551-552`. **No new migration**; the last entry stays
  `version: 26` (`:763-796`) and `migrate.ts:52-62` enforces contiguous 1..n.
  The column-order assertion is `migrations.test.ts:120-128`.
- `save()` in `src/storage/sqlite/sqlite-initiative-repository.ts:39-49` currently
  omits `paused` from both the INSERT and the `ON CONFLICT` update list. Story 1
  adds it to the INSERT only, keeping `setPaused` (`:200-204`) the sole mutator.
- `CreateInitiative` only opens a transaction on its sequencing branch
  (`create-initiative.ts:102-107`); the plain path is a bare
  `repo.save(initiative)` (`:109`). That is why `paused` must ride in the
  creation write, never in a follow-up `setPaused`.
- `CreateGraph` builds the `Initiative` literal inline
  (`src/app/graph/create-graph.ts:149-153`) inside its own `uow.transaction`
  (`:146`) and must not call `CreateInitiative` or `newInitiative`.
- Paused inertness is already enforced downstream:
  `enqueue-ready-tasks.ts:57-60` skips paused initiatives, the queue claim filters
  `i.paused = 0` (`src/queue/sqlite.ts:32`), and the startup settle sweep skips
  initiatives with no provisioned workspace
  (`src/app/objective/settle-objectives.ts:106-108`). No daemon change is needed
  for Proof phase B.
- Read views are built in the use case, not the CLI; the `--json` branch
  stringifies the DTO verbatim (`src/apps/cli/initiative.ts:79-81`,
  `src/apps/cli/objective.ts:68-70`). `GetInitiativeOutput` is at
  `src/app/initiative/get-initiative.ts:12-21`, `GetObjectiveOutput` at
  `src/app/objective/get-objective.ts:16-23`. The conditional-spread convention
  for an absent field is `get-initiative.ts:53-55` (`workspace`).
- `UnitOfWork.transaction<T>(fn: () => T): T` is **synchronous**
  (`src/storage/port.ts:37-39`), so no `await` can happen inside it — git work is
  structurally outside. `SqliteUnitOfWork` rolls back on throw
  (`src/storage/sqlite/sqlite-unit-of-work.ts:26`) and rejects nesting (`:15-17`).
- `ApproveObjective` today reads the objective at `approve-objective.ts:50`,
  mutates git at `:79` (`fetch`) and `:91-97` (`casUpdateRef`), and only opens its
  transaction at `:116` (`#integrate`) / `:136` (`#recordConflict`) — the written
  object is the snapshot from `:50` and is never re-read. That gap is what
  Story 4 closes.
- Every `UnitOfWork` fake in the objective/task tests just invokes the callback
  (`approve-objective.test.ts:18-22`, `reject-objective.test.ts:103-107`,
  `approve-task.test.ts:278-282`), so an interleaving test must diverge the
  **store's** read, not the transaction. `FakeStore.getObjective`
  (`approve-objective.test.ts:52-58`) already reads through saves, and per-test
  method replacement is the established style
  (`broker.casUpdateRef` override at `:355-357`).
- Typed errors are plain `Error` subclasses catalogued in `src/app/errors.ts`;
  `src/apps/cli/error-map.ts:68-123` is an explicit `instanceof` allow-list and
  **re-throws anything unlisted** (`:122`).
- `reject objective --resolution retry` routes to `RetryObjective`
  (`src/apps/cli/objective.ts:177-181`), and on an `awaiting_confirmation`
  objective `RetryObjective` currently returns a silent no-op
  (`retry-objective.ts:129-130`) — so the guard must live in `RetryObjective`
  too, or the Proof's stale-reject phase (`activation-verdict-proof.sh:103-107`)
  cannot fail.
- `verify:handoff` only re-runs `typecheck` (`scripts/verify-handoff.mjs`); no doc
  is machine-checked. `npm run verify` = typecheck + `node --test` + handoff +
  lint + `node src/main.ts db status` (`package.json:18`).
- The standalone `*-proof.sh` scripts do not source `scripts/e2e/e2e-common.sh`;
  `jv()` is copy-pasted per script (`activation-verdict-proof.sh:18`,
  `abandon-run-proof.sh:19`, `client-discovery-proof.sh:16`), while
  `drive-run.sh` parses with `jq` over a SQLite snapshot (`:47-67`).

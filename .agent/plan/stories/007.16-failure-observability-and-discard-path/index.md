# EPIC 007.16 — Failure observability + a terminal discard path — stories

Epic: `.agent/plan/epics/007.16-failure-observability-and-discard-path.md`
Prereq: EPIC 007.15 (sequence order).

A failed task explains itself, terminal commands report their outcome truthfully,
and failed work can be discarded so an initiative can reach a terminal state.

## Dispatch order

1. `01-discard-state-contract.md` — **design only, no product code.** Must land
   before Story 05. Produces `contract.md` in this directory.
2. `02-failed-task-reason.md` — independent; dispatch in parallel with 01.
3. `03-truthful-terminal-commands.md` — independent.
4. `04-event-repository-subject.md` — independent (migration 18).
5. `05-terminal-discard-path.md` — **coupled to 01**; do not start until
   `contract.md` exists (migration 19).
6. `06-docs-and-small-surface.md` — independent.
7. `07-run-scoped-daemon-summary.md` — LAST. Cut it rather than guess if the
   "run scope" definition cannot be pinned (see the story's abort clause).

Stories 02, 03, 04, 06 are mutually independent and touch disjoint files.

## Stories

- 1 — Discard state contract (design artifact only) → `01-discard-state-contract.md`
- 2 — Persist + render a failed task's reason → `02-failed-task-reason.md`
- 3 — Truthful approve / publish outcomes → `03-truthful-terminal-commands.md`
- 4 — `repositoryId` subject on `repository.published` → `04-event-repository-subject.md`
- 5 — Terminal discard path + cascade → `05-terminal-discard-path.md`
- 6 — Docs + small surface fixes → `06-docs-and-small-surface.md`
- 7 — Run-scoped daemon summary → `07-run-scoped-daemon-summary.md`

## Facts (needed for implementation)

Verified against the tree at `d5fb074` and against the E2E DB
`.data/e2e-00716/kanthord.db`.

- **`discarded` already exists** — `src/domain/task.ts:4-11` (`TASK_STATUSES`),
  reachable today only via `awaiting_confirmation->discarded`
  (`src/domain/task.ts:85-94`, `LEGAL_TRANSITIONS`). Its only writer is
  `src/app/task/reject-task.ts:138`. The `task.discarded` event type already
  exists at `src/domain/event.ts:13`. **Do not add an `abandoned` status.**
- **No `task_results` row is written on the failure path.** Confirmed empirically:
  `select * from task_results where task_id='01KYB1RG40N6TT6HFBCR51QVJQ'` (a real
  failed task) returns **zero rows**. The failure site is
  `src/app/task/run-next-task.ts:385-393`; it saves the task and appends
  `task.failed` but never calls `saveTaskResult`. `TaskResultRow.reason` already
  exists (`src/storage/port.ts:156`) and the `task_results` table already has a
  `reason` column — **no migration is needed for Story 02.**
- **`attempts` is not a human-retry count.** `src/app/task/run-next-task.ts:193`
  is an in-run provider transient-retry counter, never persisted. The epic
  deliberately ships **no** `attempts:` line.
- **`approve objective` early-returns on `integrated`** —
  `src/app/objective/approve-objective.ts:49-51`:
  `if (objective.status === "integrated") { return; }`. This is the exact site of
  the false-success no-op.
- **Publish already suppresses the duplicate event correctly** —
  `src/app/repository/publish-repository.ts:96-99` computes `isRealTransition` and
  guards the `feed.append`. The gap is only that `PublishOutcome`
  (`publish-repository.ts:28-31`) has no `already_published` kind, so the CLI
  cannot render a distinct message.
- **`resolveTargetOID` is where the unknown-ref crash originates** —
  `publish-repository.ts:81` awaits it before publishing; the injected
  implementation shells out to `git rev-parse` and lets `execSync` throw raw.
- **`events` table columns are `id, type, taskId, payload, objectiveId,
initiativeId`** — no `repositoryId`. `src/domain/event.ts:32-39` (`Event`) and
  `:41-49` (`newEvent`) must both gain the field.
- **Migrations** live in a single array in `src/storage/sqlite/migrations.ts`;
  the highest existing version is **17** (`007.15-s2-initiative-landed-status`,
  line 384). Next free versions: **18** (Story 04), **19** (Story 05). The
  `events` table is rebuilt by DROP+RENAME (see the version-16 migration at
  `migrations.ts:~370-381` for the pattern to copy).
- **Three SQL `CHECK (status IN (…))` constraints exist** and must be widened by
  Story 05: `tasks.status` (already includes `'discarded'` — verify, likely no
  change), `objectives.status` (`'building','awaiting_confirmation','conflict',
'integrated'`), `initiatives.status` (`'building','landed'`). Rebuilding
  `initiatives` needs `disableForeignKeys: true` — copy the comment and flag from
  the version-17 migration (`migrations.ts:377-383`).
- **`readiness()` is the dependency gate** — `src/domain/graph.ts:156-177`. It
  skips any node whose status is not `"pending"` (line 164) and treats a dep as
  satisfied only when `statusMap.get(dep) === "completed"` (line 167). So a
  `discarded` dependency _already_ blocks its dependents forever — the cascade in
  Story 05 is new code, and `readiness()` itself needs **no** change.
- **CLI `get task` text renderer** — `src/apps/cli/task.ts:296-315`; the
  `summary:` line is at `:308`. Its test file is
  `src/apps/cli/get-task.test.ts` (see `:151-152` for the `summary:` assertion
  pattern to mirror).
- **CLI daemon summary** — `src/apps/cli/daemon.ts:81-89`. `initiativesLanded` /
  `objectivesAwaitingConfirmation` come from `RunDaemon`'s optional
  `InitiativeCounts` dep (`src/app/task/run-daemon.ts:37-41`), which walks
  `listAllInitiatives()` — i.e. the **whole DB**, which is the bug. Existing test:
  `src/apps/cli/daemon-summary.test.ts`.
- **CLI retry objective** — `src/apps/cli/objective.ts:105-117`; it calls
  `retryObjective.execute({ objectiveId: id })` and accepts no `--note`. Compare
  `retry task`, which already threads a note into `Task.note`
  (`src/domain/task.ts:24`).
- **Test convention** — `node:test` + `node:assert/strict`, one `*.test.ts` beside
  the unit. Domain/use-case tests use hand-written fakes implementing the ports;
  CLI tests call the `run*` handler functions directly and assert on
  `{exitCode, stdout, stderr}`. SQLite/migration tests use a real temp DB.

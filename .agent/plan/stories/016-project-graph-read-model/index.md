# EPIC 016 — Initiative graph read model & project overview — stories

Epic: `.agent/plan/epics/016-project-graph-read-model.md`
Prereq: EPIC 015 (sequence order). **Hard capability dependency: EPIC 011 stories
3 and 4** — `events.projectId` and the project-scoped event query. Stories 5 and 6
read that column directly.

After these seven stories, `get graph --initiative <id> --json` returns an
initiative's whole task DAG in one call — per-node status, blocking reason with
permanence, downstream fan-out, candidate identity, full detail except the diff,
objectives as groups with their repositories, the remaining critical path, and a
scoped action on every element — and `get overview --project <id> --json` returns
initiative counts, repository lanes, a ranked decision list, and an activity
digest that only `ack project` ever advances.

## Dispatch order

Strictly sequential — each story compiles against the previous one:

1. `01-task-edge-permanence-and-critical-path.md` — domain, pure.
2. `02-actionability-domain-module.md` — domain, pure. Consumes Story 1's facts as
   inputs, not as imports, so 1 and 2 could run in parallel; keep them sequential
   because Story 3 needs both and the shared `UnsatisfiedEdge` type is easier to
   review in order.
3. `03-get-initiative-graph-use-case.md` — the assembly, plus the `eventTimeMs`
   domain helper and the first adapter-only event reader.
4. `04-get-graph-cli-leaf.md` — makes Proof phases A–G runnable.
5. `05-project-ack-cursor.md` — migration + `ack project`.
6. `06-get-project-overview.md` — needs Stories 2, 3 and 5.
7. `07-get-task-reuses-graph-functions.md` — the anti-divergence story. Last,
   because its cross-check test compares against Story 3's finished use case.

**Coupled pair:** Stories 4, 5 and 6 each bump the same two constants in
`src/apps/cli/architecture.test.ts` (lines 28 and 33). The values are pinned per
story — 66/69, then 67/70, then 68/71 — so they must land in that order. Do not
run them concurrently.

## Stories

- 1 — task-edge permanence (`unsatisfiedTaskEdges`, `permanentlyBlockedTasks`) and
  `longestRemainingChain` → `01-task-edge-permanence-and-critical-path.md`
- 2 — `src/domain/actionability.ts`, the single action authority →
  `02-actionability-domain-module.md`
- 3 — `GetInitiativeGraph` use case + wiring →
  `03-get-initiative-graph-use-case.md`
- 4 — `get graph --initiative` CLI leaf → `04-get-graph-cli-leaf.md`
- 5 — `project_acks` table, `AckProject`, `ack project` CLI group →
  `05-project-ack-cursor.md`
- 6 — `GetProjectOverview` + `get overview --project` CLI leaf →
  `06-get-project-overview.md`
- 7 — `get task` reuses the same functions →
  `07-get-task-reuses-graph-functions.md`

## Facts (needed for implementation)

- **Migration version is derived, never hardcoded.** Head is 26
  (`src/storage/sqlite/migrations.ts:763`); EPIC 011 s3, EPIC 013 s1/s5 and EPIC
  014 s3 all append. `validateSequence` (`src/storage/sqlite/migrate.ts:54-63`)
  requires `1..n` contiguous, so a wrong number fails loudly. Pin the **name**
  (`016-s5-project-acks`), derive the number.
- **Appending a migration means five edits in
  `src/storage/sqlite/migrations.test.ts`**: the title at `:70`, the version at
  `:72`, `:449`, `:1215`, `:1818`, plus the `userTables` array at `:73-96`. There
  is no `MIGRATIONS.length` assertion.
- **`paused` is not on the `Initiative` entity.** The only reader is
  `InitiativeRepository.listAllInitiatives(): Array<{id, paused}>`
  (`src/storage/port.ts:88`), used exactly this way at
  `src/app/task/enqueue-ready-tasks.ts:58-60`. Do not add a port method.
- **`getTaskResult` is not on the `TaskRepository` port.** It exists only on
  `SqliteTaskRepository` (`:531`) and is consumed through use-case-local
  structural interfaces — the pattern at `src/app/task/get-task.ts:6-20`. All new
  adapter-only readers in Stories 3 and 6 follow it; nothing is added to
  `src/events/port.ts` (which stays `append` + `readAfter`, `:10-13`).
- **Per-command verification results live only in `task_results.evidence`**
  (`Array<{command, exitCode, output}> | null`, `src/storage/port.ts:174`),
  written from the runner's `completed` outcome
  (`src/app/task/run-next-task.ts:399`) and `null` on every other path
  (`:430`, `:466`, `:506`, `:549`). The `task.verification` **events** carry only
  `verifierKind`, `phase`, `exitClass`, `durationMs`, `timedOut`
  (`src/agent-runner/pi.ts:730,738`) — no command, exit code, or output.
- **Both list orders are deterministic:** `listByInitiative` is `ORDER BY t.id ASC`
  (`src/storage/sqlite/sqlite-task-repository.ts:324`), `listObjectives` is
  `ORDER BY id ASC` (`src/storage/sqlite/sqlite-initiative-repository.ts:139`).
  Never re-sort in the use cases.
- **`UnknownReferenceError`'s message is `no <kind> with id <id>`**
  (`src/domain/errors.ts:24`), which is what Proof phase A greps for. New error
  classes must be added to `toResult`'s `instanceof` chain
  (`src/apps/cli/error-map.ts:69-119`) or they crash instead of exiting 1.
- **`reject task` refuses a `pending` task** — only `awaiting_confirmation`, or
  `failed` with `resolution: "discard"` (`src/app/task/reject-task.ts:86-92`);
  `retry task` requires `failed` (`src/app/task/retry-task.ts:129-130`). A
  permanently blocked pending task's only reachable action is `remove dependency`,
  legal because `assertDependenciesEditable` requires `pending`
  (`src/domain/task.ts:139-148`).
- **`retry task --note` is silently dropped on the `failed` branch**
  (`src/app/task/retry-task.ts:133-140`; the note is applied only on the
  `awaiting_confirmation` branch at `:102`). So the `retry` action must not
  advertise a `note` input.
- **`discarded` is terminal** for tasks — no `discarded->*` entry in
  `LEGAL_TRANSITIONS` (`src/domain/task.ts:96-107`). That is what makes
  `neverSatisfies` sound.
- **CLI leaf template:** `src/apps/cli/commands/get/initiative.ts` (27 lines) —
  leaf maps opts to a sparse args record, calls a `run*` handler in
  `src/apps/cli/<entity>.ts`, then `emitResult`. Formatting and `--json` live in
  the handler, never the leaf. `CliIo` / `emitResult` at
  `src/apps/cli/commands/action.ts:7-26`.
- **New top-level group template:** `src/apps/cli/commands/pause.ts` (19 lines) +
  `pause/initiative.ts` (23 lines); register in `src/apps/cli/index.ts` as
  `const ack = buildAckCommand(deps, io).name("ack")` then `.addCommand(ack)`. The
  `.name()` re-set is required because group builders set `.name("kanthord <group>")`
  internally.
- **Architecture test requirements** (`src/apps/cli/architecture.test.ts`): bump
  `EXPECTED_LEAF_FILE_COUNT` (`:28`, currently 65) and `EXPECTED_LEAF_COUNT`
  (`:33`, currently 68); every leaf needs a non-empty `.description()`, `Usage:`
  in its help (via `configureHelp({commandUsage})`) and the literal `Example`
  (via `addHelpText("after", …)`); the program is built with
  `noopDeps = {} as unknown as CliDeps` (`:49`), so a leaf must not dereference
  `deps` outside `.action()`; `index.ts` must contain no `.option(`/`.action(`
  (`:57-65`).
- **Test conventions:** `node:test` + `node:assert/strict`, flat `test(...)` in
  domain files (`src/domain/sequencing.test.ts:1-11`), a hand-rolled `capture()`
  io plus `buildXCommand(deps, io).parseAsync([leaf, ...flags], {from:"user"})`
  for command tests (`src/apps/cli/commands/read.test.ts:8-57`), and
  `mkdtempSync` + `openDatabase` + `migrate(db, MIGRATIONS)` for SQLite adapter
  tests (`src/storage/sqlite/publication.test.ts:15-21`). Runner: `npm test` is
  `node --test`; `npm run verify` is typecheck + test + verify:handoff + lint + db
  status (`package.json:12-19`).
- **Arrow-wrap every function-shaped source** passed into a use case. A bare
  method reference loses `this` and crashes on the adapter's `#private` fields
  (AGENTS.md); see `src/composition.ts:759,763-764` for the existing style.
- **Adapters already built in `composition.ts`:** `events` `:176`,
  `sequencingRepository` `:180`, `publicationRepository` `:223`,
  `landingRepository` `:371`. `getTask` is constructed at `:372-377`,
  `getInitiative`/`getObjective` at `:758-766`, and the returned bundle spans
  `:850-920`.

## Planning defects / open questions

- **B1 - action:YES - RESOLVED - epic field table named the wrong verification
  source -** The EPIC's field-to-source table mapped `verificationResults` to
  `task.verification` **event** payloads. Those events carry no command, exit code,
  or output (`src/agent-runner/pi.ts:730,738`); the per-command results live only
  in `task_results.evidence` (`src/storage/port.ts:174`, written at
  `src/app/task/run-next-task.ts:399`). The EPIC row now names `evidence` and
  carries an explicit note; Story 3 rule 14 agrees with it. No action left.
- **B2 - action:YES - RESOLVED - edge direction was unpinned -**
  `scripts/e2e/initiative-graph-proof.sh` phase B asserted
  `v.edges.every(e=>e.to===ROOT_A)`, which is backwards: Story 3 rule 7 pins
  `from` = dependency and `to` = dependent. The script now asserts
  `e.from === ROOT_A` plus four distinct `to` values, and the EPIC's phase-B prose
  pins the direction so a count alone can no longer pass with the direction
  reversed. No action left.
- **S1 - action:NO - cross-repo group is hermetic-only -** No CLI writes per-task
  repository context, so a single objective spanning two repositories cannot be
  built through real commands. The EPIC already records this under "Not provable
  at program level"; Story 3's unit test covers it. No action needed now.
- **S2 - action:NO - `latestActionableEventIds` initiativeId fallback -**
  Story 6 §B notes that `task.failed` / `task.escalated` events carry `taskId` but
  may not carry `initiativeId`, so the query may need a join through `tasks`. The
  story pins the degraded behaviour (`actionableSince: null`) so this cannot block
  implementation, and the ranking stays a total order either way.

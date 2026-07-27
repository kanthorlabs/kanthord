# Story 6 — `GetDecisionQueue` + the `queue` CLI verb

Epic: `.agent/plan/epics/017-decision-workbench.md`
Depends on: Story 5 (`projectDecisions`, `rankDecisions`).
Depends on: EPIC 011 story 1 (`ListProjects`) — if `src/app/project/list-projects.ts`
does not exist, this story reads `listProjects()` through its own structural
source instead (see A.2); it does **not** author 011's use case.

## Change

### A. `src/app/project/get-decision-queue.ts`

New file. `app/` may import `src/domain/*` and `src/*/port.ts` only
(`eslint.config.js:60-73`); the repo convention is to declare **use-case-local
structural sources** rather than importing port interfaces wholesale — mirror
`src/app/task/get-task.ts:6-20` and `src/app/objective/get-objective.ts:8-14`.

1. Output type:

```ts
export interface GetDecisionQueueOutput {
  items: DecisionItem[];
  counts: { total: number; byKind: Record<string, number> };
  truncated: boolean;
}
```

2. Structural sources, in this constructor argument order:

```ts
interface QueueProjectSource {
  listProjects(): Array<{ id: string; name: string }>;
}
interface QueueInitiativeSource {
  listInitiatives(projectId: string): Initiative[];
  listObjectives(initiativeId: string): Objective[];
}
interface QueueTaskSource {
  listByInitiative(initiativeId: string): Task[];
}
interface QueuePublicationSource {
  getLatestPublication(
    repoId: string,
  ): { state: PublicationStateName; remoteOID: string | null } | undefined;
}
interface QueueActivitySource {
  /** Latest actionable-event id per element id. */
  latestActionableEventIds(elementIds: readonly string[]): Map<string, string>;
}
interface QueueEvidenceSource {
  getTaskResult(taskId: string): TaskResultRow | undefined;
  resolveHomeDir(repoId: string): string;
  resolveInitiativeRepository(initiativeId: string): string | undefined;
}
interface QueueCandidateSource {
  /** Tasks with a persisted landing candidate — the `cause` discriminator. */
  getCandidateByTask(taskId: string): { id: string } | undefined;
}
```

`QueueCandidateSource` is the seventh constructor argument. Build
`candidateTaskIds` by calling it once per `awaiting_confirmation` task only —
never for every task. It is the same fact `ApproveTask` keys on
(`src/app/task/approve-task.ts:169-171`).

`PublicationStateName` and `TaskResultRow` come from `src/storage/port.ts:222`
and `:12` — a port type import, which `app/` is allowed.

3. `execute(input: { limit?: number }): Promise<GetDecisionQueueOutput>`:

- For every project from `listProjects()`, in its returned order (already
  `ORDER BY id ASC`, `src/storage/sqlite/sqlite-project-repository.ts:124`), build
  one `QueueProjectInput` and call `projectDecisions`.
- Concatenate all projects' items, then call `rankDecisions` **once** over the
  whole set. Ranking after concatenation is what makes it cross-project.
- `counts.total` is the count of **all** items before truncation.
  `counts.byKind` aggregates all items by `kindLabel`, also before truncation, so
  both stay true at any size.
- `limit` defaults to `50`. `items` is the first `limit` ranked items;
  `truncated` is `items.length < counts.total`.

4. Evidence identity per item:

- task items: `homeDir = resolveHomeDir(resolveInitiativeRepository(initiativeId))`
  when the repository resolves, else `null`; `baseOid = result.baseCommit`,
  `headOid = result.commitSha ?? result.proposalCommit`.
- objective items: the same `homeDir`; `baseOid = objective.parentOid`,
  `headOid = objective.commitOid`.
- publication items: all three `null`.

5. `actionableEventIds`: collect every candidate element id first, then make **one**
   `latestActionableEventIds(ids)` call. Do not query per element.

**Read-only.** The use case takes no `UnitOfWork`, no `EventFeed`, and calls no
`save*` method.

### B. Adapter support for `latestActionableEventIds`

`src/storage/sqlite/sqlite-event-feed.ts` — add an **adapter-only** method (do
**not** widen the `EventFeed` port, which stays `append` + `readAfter`,
`src/events/port.ts:10-13` — the same decision EPIC 016 story 03 makes for
`latestEventIdByTask`):

```ts
latestActionableEventIds(elementIds: readonly string[]): Map<string, string>
```

One statement, parameterised over the id list, selecting `MAX(id)` grouped by the
owning column, restricted to the actionable event types:

- `task.failed` and `task.escalated` keyed by `taskId`;
- `objective.awaiting_confirmation` and `objective.conflict` keyed by `objectiveId`;
- `initiative.landed` keyed by `initiativeId`.

All five types already exist in the `events.type` CHECK list
(`src/storage/sqlite/migrations.ts:770-783`). **Add no new event type and do not
touch the `events` table** — the hazard notes in
`.agent/plan/stories/011-client-discovery-surface/03-denormalise-event-project-id.md:19-24`
and `.agent/plan/stories/013-lease-fenced-run-recovery/05-task-abandoned-event-type-and-migration.md:33-44`
are binding.

### C. CLI — the new `queue` verb

`queue` is a **single top-level leaf**, not a group: the epic specifies
`kanthord queue [--json]` with no subcommand, and Commander resolves a group with
no default subcommand as a usage error. Create exactly one new file,
`src/apps/cli/commands/queue.ts`, directly in `commands/` — the shape
`src/apps/cli/commands/commands.ts:49-51` uses. Do **not** create a
`commands/queue/` subdirectory and do **not** add a `list` subcommand.

Leaf, mirroring `src/apps/cli/commands/get/objective.ts:8-27`:

```ts
export function buildQueueCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("queue")
    .description("List every decision waiting on a human, ranked by impact.")
    .configureHelp({ commandUsage: () => "kanthord queue" })
    .option("--json", "print the queue as JSON")
    .option("--limit <n>", "maximum items to print")
    .addHelpText("after", "\nExample:\n  kanthord queue --json\n")
    .action(async (opts: { json?: boolean; limit?: string }) => {
      emitResult(
        await runQueueList(
          {
            ...(opts.json ? { json: true } : {}),
            ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
          },
          deps.getDecisionQueue,
        ),
        io,
      );
    });
}
```

Because it is a leaf and not a group, there is **no** `preSubcommand` /
`copyInheritedSettings` hook.

Register the group in `src/apps/cli/index.ts`'s `buildProgram`. That file must
contain no `.action(`, `.option(`, `.requiredOption(` or `.argument(`
(`src/apps/cli/architecture.test.ts:36,57-65`).

New handler `runQueueList` in a new `src/apps/cli/queue.ts`:

- Reject a `--limit` that is not a positive integer: exit 1,
  `error: --limit must be a positive integer, got: <raw>` (mirror
  `src/apps/cli/daemon.ts:30-34`).
- `--json` → stdout is the single element `JSON.stringify(output)`
  (`emitResult` appends `"\n"` per element, `src/apps/cli/commands/action.ts:23`).
- Text form, one line per item, then a trailing count line:
  ```
  <kindLabel> <projectName> <elementId> downstream=<n> verdicts=<kind,kind>
  ```
  and `total: <n>` plus `truncated: <true|false>`.

**Proof note.** The Proof invokes `kanthord queue --json`, which the top-level
leaf above satisfies with no change to the Proof script.

### D. Wiring

- `src/apps/cli/deps.ts` — add `getDecisionQueue: GetDecisionQueue;` to
  `CliDeps` (`:131-211`) with an `import type` at the top.
- `src/composition.ts` — construct it in `buildDeps` and add `getDecisionQueue,`
  to the returned literal (`:850-920`). Pass **arrow wrappers**, never bare
  method references, which lose `this` and crash on `#private` fields:
  ```ts
  const getDecisionQueue = new GetDecisionQueue(
    { listProjects: () => projectRepository.listProjects() },
    {
      listInitiatives: (p) => initiativeRepository.listInitiatives(p),
      listObjectives: (i) => initiativeRepository.listObjectives(i),
    },
    { listByInitiative: (i) => taskRepository.listByInitiative(i) },
    {
      getLatestPublication: (r) =>
        publicationRepository.getLatestPublication(r),
    },
    { latestActionableEventIds: (ids) => events.latestActionableEventIds(ids) },
    {
      getTaskResult: (t) => taskRepository.getTaskResult(t),
      resolveHomeDir,
      resolveInitiativeRepository,
    },
    { getCandidateByTask: (t) => landingRepository.getCandidateByTask(t) },
  );
  ```
  `landingRepository` is the same instance passed to `GetConflict` (`:591-596`).
  `publicationRepository` is at `:223`, `resolveHomeDir` and
  `resolveInitiativeRepository` at `:683-696`.

## Constraints

- **No use case calls another use case.** Shared logic is story 5's domain
  projection.
- Read-only: no `UnitOfWork`, no event append, no `save*`.
- One `latestActionableEventIds` call per `execute`, not one per element.
- `counts` aggregates before truncation; `items` is the capped page.
- Do not widen `src/events/port.ts`.
- Do not add a migration.

## Verify

- New `src/app/project/get-decision-queue.test.ts` — `node:test` +
  `node:assert/strict`; hand-written in-memory sources, mirroring
  `src/app/task/get-task.test.ts`.
  - `(017-S6-cross-project)` two projects, one decision each → both appear, and
    the higher-`downstream` item is first.
  - `(017-S6-ranked-once)` project B's item outranks project A's when its
    `downstream` is higher, proving ranking happens after concatenation, not
    per project.
  - `(017-S6-counts-before-truncation)` nine items with `limit: 2` →
    `items.length === 2`, `counts.total === 9`, `byKind` sums to `9`,
    `truncated === true`.
  - `(017-S6-not-truncated)` `limit` above the item count → `truncated === false`.
  - `(017-S6-no-writes)` sources whose `save*`/`append`/`transaction` methods
    throw → `execute` resolves.
  - `(017-S6-one-activity-call)` a counting activity source → exactly one call.
  - `(017-S6-empty)` no projects → `items: []`, `counts.total: 0`, `byKind: {}`,
    `truncated: false`.
  - `(017-S6-cause-source)` an `awaiting_confirmation` task with a candidate row →
    item `cause === "candidate"`; without one → `"escalation"`. A counting
    candidate source proves it is queried only for `awaiting_confirmation` tasks,
    never for `failed` or `pending` ones.
  - `(017-S6-evidence-identity)` a task item's `inspect.args` uses the resolved
    `homeDir` and `baseCommit..commitSha`; an objective item's uses
    `parentOid..commitOid`; a publication item's `inspect` is `null`.
- New `src/apps/cli/queue.test.ts` — `runQueueList` with a fake use case:
  `--json` stdout is one JSON element; `--limit abc` exits 1 with the exact
  message; `--limit 0` exits 1; text form contains one line per item plus
  `total:`.
- `node --test src/apps/cli/architecture.test.ts` — **must stay green.** Adding a
  single top-level leaf at `src/apps/cli/commands/queue.ts` (not in a
  subdirectory) leaves `EXPECTED_LEAF_FILE_COUNT` (`:28`) unchanged and requires
  `EXPECTED_LEAF_COUNT` (`:33`) to be **incremented by one relative to the value
  on disk** — EPIC 016 also adds leaves, so do not hardcode `69`. The leaf needs a
  non-empty `.description(...)`, help containing `Usage:` and the literal
  `Example`, and must build with `deps = {}` (no eager `deps.x.y` dereference).
- `node --test src/apps/cli/index.test.ts` — root `--help` still matches its
  existing regexes (`:40-45`); optionally add `assert.match(help, /queue/)`.
- `node --test src/storage/sqlite/sqlite-event-feed.test.ts` —
  `latestActionableEventIds` returns the **max** id per element across several
  events, ignores non-actionable types, returns an empty map for an empty id
  list, and omits ids with no matching event.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/decision-workbench-proof.sh` phases **C**, **D**, **I**, and
  the `queue --json` invocations in phase **J**.

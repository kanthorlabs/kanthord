# Story 04 — Read verbs `get` / `find` / `list` (12 leaves)

Epic: `.agent/plan/epics/007.2-migrate-cli-to-commander-js.md`
Requires: Story 01 (shell). Independent of Stories 02–03.

## Goal

Migrate every read route to Commander leaves under `get`, `find`, and `list`
parents, wired into `buildProgram`. This story applies **two of the five
renames**: `events` → `list event` (keeping `--follow` + SIGINT cancellation)
and `get models` → `list model`. Same handlers, same values, Commander only.

## Locked contracts

```ts
// commands/get/{task,project,resource}.ts   ; commands/get.ts -> buildGetCommand
buildGetTaskCommand; // --id <id> [--json] [--result]
buildGetProjectCommand; // --id <id> [--json]
buildGetResourceCommand; // --id <id> [--json]

// commands/find/{project,initiative,objective,resource}.ts ; commands/find.ts
buildFindProjectCommand; // --name
buildFindInitiativeCommand; // --project --name
buildFindObjectiveCommand; // --initiative --name
buildFindResourceCommand; // --project --name

// commands/list/{task,initiative,objective,event,model}.ts ; commands/list.ts
buildListTaskCommand; // --initiative [--objective] [--status] [--json]
buildListInitiativeCommand; // --project [--json]
buildListObjectiveCommand; // --initiative [--json]
buildListEventCommand; // --after [--limit] [--json] [--follow] [--poll-interval]   (was `events`)
buildListModelCommand; // [--provider] [--json]                                     (was `get models`)
```

Follow the Story 02 mapping rule (kebab keys: `list event` reads
`args["poll-interval"]`).

## Verification Gate

`node --test src/apps/cli/commands/read.test.ts` green; existing `get.test.ts`,
`get-task.test.ts`, `find.test.ts`, `list-tasks.test.ts`, `events.test.ts`,
`models.test.ts`, `resource.test.ts` still green; `npm run typecheck` 0;
`npm run lint` clean.

---

### Task T1 — `get` group (task / project / resource)

**Requires:** Story 01 T4.

**Input:** `commands/get.ts`, `commands/get/{task,project,resource}.ts` (new),
`commands/read.test.ts` (new), `src/apps/cli/{get,get-task?,resource}.ts`
handlers (`runGetTask`, `runGetProject`, `runGetResource`).

**Action — RED:** `get task --id x --json --result` calls `runGetTask` with
`{ id:"x", json:true, result:true }`; `get project --id x` / `get resource --id
x` map `{ id, json }`. Assert spies + `cap`. `get resource --help` example must
not print a secret. Fails today: modules missing.

**Action — GREEN:** create the three leaves (`--id` required; `--json` boolean;
`get task` adds `--result` boolean) and `get.ts` composing them.

**Action — REFACTOR:** none.

**Output:** `get task|project|resource` migrated.

**Verify:** `node --test src/apps/cli/commands/read.test.ts` green.

---

### Task T2 — `find` group (project / initiative / objective / resource)

**Requires:** Story 01 T4.

**Input:** `commands/find.ts`, `commands/find/{project,initiative,objective,
resource}.ts` (new), `commands/read.test.ts`, `src/apps/cli/find.ts`.

**Action — RED:** `find project --name n` → `runFindProject({name})`; `find
initiative --project p --name n` → `runFindInitiative({project,name})`; same for
objective (`--initiative`) and resource (`--project`). Assert spies + `cap` (each
prints the bare id). Fails today: modules missing.

**Action — GREEN:** create the four leaves and `find.ts`.

**Action — REFACTOR:** none.

**Output:** `find project|initiative|objective|resource` migrated.

**Verify:** `node --test src/apps/cli/commands/read.test.ts` green; existing
`find.test.ts` still green.

---

### Task T3 — `list` group: task / initiative / objective

**Requires:** Story 01 T4.

**Input:** `commands/list.ts`, `commands/list/{task,initiative,objective}.ts`
(new), `commands/read.test.ts`, `src/apps/cli/{list-tasks,initiative,
objective}.ts`.

**Action — RED:** `list task --initiative i --objective o --status pending
--json` → `runListTasks` with those keys; `list initiative --project p --json` →
`runListInitiatives`; `list objective --initiative i --json` →
`runListObjectives`. Assert spies + `cap`. Fails today: modules missing.

**Action — GREEN:** create the three leaves (`--initiative`/`--project` required
as per old usage; `--objective`/`--status`/`--json` optional) and `list.ts`.

**Action — REFACTOR:** none.

**Output:** `list task|initiative|objective` migrated.

**Verify:** `node --test src/apps/cli/commands/read.test.ts` green; existing
`list-tasks.test.ts` still green.

---

### Task T4 — renames: `list event` (follow/SIGINT) + `list model`

**Requires:** T3 (the `list` parent exists).

**Input:** `commands/list/event.ts`, `commands/list/model.ts` (new),
`commands/list.ts`, `commands/read.test.ts`, `src/apps/cli/events.ts`,
`src/apps/cli/models.ts`.

**Action — RED:** (a) `list event --after 0 --json` calls `runEvents(args,
deps.listEvents, sleep, signal)` where `args` carries `{ after, json,
"poll-interval"? , limit?, follow? }` (kebab key), a `sleep` function is passed,
and an `AbortSignal` is passed; assert via spy that all four arguments arrive and
that a SIGINT listener is registered then removed (mirror the old handler's
`process.once("SIGINT", …)` / `removeListener` in a `finally`). (b) `list model
--json` calls `runGetModels({ json:true }, deps.listModels)`; `list model
--provider openai-codex` passes `{ provider:"openai-codex" }`. Assert `cap`
captured results. Fails today: modules missing; the old spellings `events` /
`get models` do NOT exist as routes.

**Action — GREEN:** create `list/event.ts` reproducing the old router's SIGINT
wiring verbatim: `const ac = new AbortController(); const onSigint = () =>
ac.abort(); process.once("SIGINT", onSigint); try { emitResult(await
runEvents(args, deps.listEvents, (ms) => new Promise((r) => setTimeout(r, ms)),
ac.signal), io); } finally { process.removeListener("SIGINT", onSigint); }`.
Create `list/model.ts` calling `runGetModels`. Register both in `list.ts`.

**Action — REFACTOR:** none.

**Output:** `events`→`list event` and `get models`→`list model` complete;
follow/cancellation preserved.

**Verify:** `node --test src/apps/cli/commands/read.test.ts` green; existing
`events.test.ts`, `models.test.ts` still green.

---

### Task T5 — wire `get` / `find` / `list` into `buildProgram`

**Requires:** T1–T4.

**Input:** `src/apps/cli/index.ts`, `src/apps/cli/index.test.ts`.

**Action — RED:** `buildProgram` `--help` lists `get`, `find`, `list`; parsing
`["list","model","--json"]` runs `runGetModels`; parsing `["list","event",
"--after","0","--json"]` runs `runEvents`. Fails today: not added.

**Action — GREEN:** `program.addCommand(buildGetCommand/… buildFindCommand/…
buildListCommand)`.

**Action — REFACTOR:** none.

**Output:** all read verbs reachable from the root.

**Verify:** `node --test src/apps/cli/index.test.ts` green; `npm run typecheck`
0; `npm run lint` clean.

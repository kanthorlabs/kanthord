# Story 6 — `create task` emits `task.created`

Epic: `.agent/plan/epics/011-client-discovery-surface.md`

> **Not an epic Story bullet.** The epic's Proof Phase D builds its interleaved
> two-project history with eight `create task` calls and states that
> "`create task` emits `task.created`"
> (`scripts/e2e/client-discovery-proof.sh:70-71`), and then fails if either
> scoped feed is empty (`:96`). `task.created` has **no producer anywhere in
> `src/`** — it exists only in `EVENT_TYPES` (`src/domain/event.ts:4`) and in
> the `events.type` CHECK list. No epic bullet delivers it, so Phase D cannot
> pass without this story. See `index.md` blocker **B1**: the epic's `## Stories`
> list must be amended to include it.

## Change

1. `src/app/task/create-task.ts` — inject the event feed as a **required** 5th
   constructor parameter, ahead of the existing optional `agentCatalog`
   (required parameters cannot follow optional ones). The constructor at
   `create-task.ts:19-31` becomes:

   ```ts
   constructor(
     taskRepo: TaskRepository,
     initiativeRepo: InitiativeRepository,
     projectRepo: ProjectRepository,
     resolver: ReferenceResolver,
     events: EventFeed,
     agentCatalog?: AgentCatalog,
   )
   ```

   with `import type { EventFeed } from "../../events/port.ts";` and
   `import { newEvent } from "../../domain/event.ts";`, and a
   `readonly #events: EventFeed;` field.

   `EventFeed` is a port (`src/events/port.ts:10-13`) — import it with
   `import type`, per the app-layer import rule.

2. Same file, step 6 (`create-task.ts:102-116`) — append exactly one event
   **after** the task and its optional context are persisted, immediately before
   `return task.id;`:

   ```ts
   this.#events.append(newEvent("task.created", { taskId: task.id }));
   ```

   One event per created task, carrying only `taskId`, and no payload. Story 3's
   adapter derives its `projectId` from that `taskId`.

3. `src/composition.ts:286-292` — pass the already-in-scope `events` feed as the
   5th argument:

   ```ts
   const createTask = new CreateTask(
     taskRepository,
     initiativeRepository,
     projectRepository,
     referenceResolver,
     events,
     agentCatalog,
   );
   ```

4. Update every other `new CreateTask(` construction to insert a feed argument
   in 5th position. The complete list of sites (grep `new CreateTask(`):
   - `src/app/task/create-task.test.ts:253, 279, 299, 320, 358, 395, 419, 443`
   - `src/app/task/live-mutation.test.ts:132`
   - `src/apps/cli/task.test.ts:263, 290, 316, 342, 368, 400, 422, 447, 476, 495, 515, 541, 566`
   - `src/apps/cli/identity.test.ts:230`

   Use a recording fake in the shape already used across the suite, e.g.
   `src/app/task/enqueue-ready-tasks.test.ts:60-62`
   (`class MemFeed { readonly appended: Event[] = []; append(e: Event) { this.appended.push(e); } readAfter() { return []; } }`).

## Constraints

- `EventFeed` is **required**, not optional — a task created through a path that
  forgot to pass a feed must not silently produce no event
  (AGENTS.md: never weaken a spec-required dependency to optional).
- The append happens after `this.#taskRepo.save(task)` and after
  `saveTaskContext`, so a validation failure earlier in `execute` produces no
  event.
- `CreateGraph` (`src/app/graph/create-graph.ts`) deliberately does **not** emit
  `task.created` in this epic — graph import stays event-free, matching the
  epic's Non-goal of not widening the event surface.
- No migration: `task.created` is already in the `events.type` CHECK list
  (`src/storage/sqlite/migrations.ts:774`) and in `EVENT_TYPES`.

## Verify

- `node --test src/app/task/create-task.test.ts` — new cases:
  - a successful `execute()` appends exactly one event; it has
    `type === "task.created"` and `taskId === <returned id>`, and no `payload`,
    no `objectiveId`, no `initiativeId`, no `repositoryId`;
  - creating two tasks appends two events with distinct ids;
  - every existing failure case (unknown objective, wrong-type reference,
    unknown dependency, unknown/wrong-type context resource, unknown agent)
    appends **zero** events — assert `feed.appended.length === 0` in each.
- `node --test src/app/task/live-mutation.test.ts`,
  `node --test src/apps/cli/task.test.ts`,
  `node --test src/apps/cli/identity.test.ts` — updated constructions still
  pass unchanged otherwise.
- `node --test src/composition.test.ts` — still green (the composition root
  builds).
- `npm run verify` exits 0.
- Proof: `scripts/e2e/client-discovery-proof.sh` Phase **D** precondition — the
  eight `create task` calls at `:78-83` must produce four `task.created` events
  per project, which is what makes the interleave assertion at `:106-109`
  non-vacuous.

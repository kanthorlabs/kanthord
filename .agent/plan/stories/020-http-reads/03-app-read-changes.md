# Story S3 — app-layer read changes: `name` filter + `ListTasks` empty-initiative fix

Epic: `.agent/plan/epics/020-http-reads.md` (decisions 5 and 7)

No HTTP code in this story.

## Change

### A. `ListTasks` — an existing initiative with zero tasks returns `[]`

`src/app/task/list-tasks.ts`:

1. Add an initiative source interface above the class (mirroring the
   narrow-structural style of `src/app/initiative/get-initiative.ts:8-10`):
   ```ts
   interface InitiativeSource {
     get(id: string): { id: string } | undefined;
   }
   ```
2. Constructor becomes
   `constructor(taskRepo: TaskRepository, initiatives: InitiativeSource)` and
   stores `#initiatives`. Both parameters are REQUIRED — do not make the second
   optional.
3. Replace `:27-31`:
   ```ts
   const tasks = this.#taskRepo.listByInitiative(input.initiativeId);

   if (tasks.length === 0) {
     throw new UnknownReferenceError("initiative", input.initiativeId);
   }
   ```
   with:
   ```ts
   if (this.#initiatives.get(input.initiativeId) === undefined) {
     throw new UnknownReferenceError("initiative", input.initiativeId);
   }
   const tasks = this.#taskRepo.listByInitiative(input.initiativeId);
   ```
   Everything from `const nodes = tasks.map(...)` (`:33`) down is unchanged;
   `validateGraph([])` and `readiness([])` run on the empty array and the method
   returns `[]`.

`src/composition.ts:382` — `const listTasks = new ListTasks(taskRepository);`
becomes:

```ts
const listTasks = new ListTasks(taskRepository, {
  get: (id) => initiativeRepository.get(id),
});
```

(`initiativeRepository` is already in scope; the arrow wrapper is required —
AGENTS.md "never inject a bare method reference".)

`src/apps/cli/list-tasks.ts` needs NO edit: the `try/catch` at `:20-46` still
maps a genuinely absent initiative through `toResult`, and the zero-task case now
returns `exitCode: 0` with `[]`.

### B. Optional exact-`name` filter on four read lists

The filter is applied INSIDE the use case, after fetching. No repository method
gains a parameter.

1. `src/app/project/list-projects.ts:11` —
   `execute(): Project[]` becomes
   `execute(input?: { name?: string }): Project[]`, body:
   ```ts
   const projects = this.#projects.listProjects();
   if (input?.name === undefined) {
     return projects;
   }
   return projects.filter((p) => p.name === input.name);
   ```
   The repo call stays argument-free (`list-projects.test.ts:80-87` asserts
   `lastListProjectsArg` is `[]`).
2. `src/app/initiative/list-initiatives.ts:11` —
   `execute(input: { projectId: string; name?: string }): Initiative[]`, filter
   the `listInitiatives(input.projectId)` result on `i.name === input.name` when
   `input.name !== undefined`.
3. `src/app/objective/list-objectives.ts:11` —
   `execute(input: { initiativeId: string; name?: string }): Objective[]`, same
   shape over `listObjectives(input.initiativeId)`.
4. `src/app/resource/list-resources.ts:16` —
   `execute(input: { projectId: string; type: ResourceType; name?: string }): ResourceView[]`.
   Filter the RAW resources on `r.name === input.name` BEFORE `toResourceView`,
   so the mapping runs only over the kept rows. `type` stays REQUIRED.

Matching is exact `===` — no trimming, no case folding, no substring.

## Constraints

- Only these five files plus `src/composition.ts:382` change. The four CLI
  callers (`src/apps/cli/project.ts:60`, `initiative.ts:165`, `objective.ts:50`,
  `resource.ts:261`) are NOT edited: they keep passing what they pass today, and
  an optional field keeps them assignable.
- Never emit `name: undefined` from a caller — `src/apps/cli/commands/read.test.ts:461`,
  `:486`, `:655`, `:704`, `:832` assert exact input objects.
- `ListTasks` keeps throwing `UnknownReferenceError("initiative", id)` — same
  class, same `kind`, same `id` — for an absent initiative.

## Verify

- `src/app/task/list-tasks.test.ts` — rewrite the single test at `:126-161`
  (`"ListTasks unknown initiativeId throws UnknownReferenceError"`) into two:
  - `absent initiative throws UnknownReferenceError`: initiative source returns
    `undefined`; assert `err instanceof UnknownReferenceError`,
    `err.kind === "initiative"`, `err.id === INIT_ID`. Drop the
    `FakeTaskRepository` subclass-override trick — the task repo is irrelevant
    now.
  - `existing initiative with zero tasks returns []`: initiative source returns
    `{ id: INIT_ID }`, `listByInitiative` returns `[]`; assert
    `deepEqual(await useCase.execute({ initiativeId: INIT_ID }), [])` and that
    it does NOT reject.
    Every other test in the file gets the second constructor argument
    `{ get: () => ({ id: INIT_ID }) }`.
- `src/app/project/list-projects.test.ts` — add: `execute()` (no argument)
  returns all seeded projects and `lastListProjectsArg` is still `[]`;
  `execute({ name: "alpha" })` returns only the exact match;
  `execute({ name: "ALPHA" })` returns `[]`; `execute({ name: "alph" })` returns
  `[]`; `execute({})` returns all.
- New file `src/app/initiative/list-initiatives.test.ts` — a fake
  `InitiativeRepository` (object-literal style of
  `src/app/resource/list-resources.test.ts:47-70`) recording the `projectId` it
  received; assert scope pass-through, all-rows with no `name`, exact match,
  and `[]` on a miss.
- New file `src/app/objective/list-objectives.test.ts` — the same four
  assertions over `initiativeId`.
- `src/app/resource/list-resources.test.ts` — add: `name` filter keeps the exact
  match only; a miss returns `[]`; the `received` literal still shows
  `{ projectId, type }` (the repo call is unchanged); and the existing
  secret-leak assertion still holds for a filtered row.
- `node --test src/app/task/list-tasks.test.ts src/app/project/list-projects.test.ts src/app/initiative/list-initiatives.test.ts src/app/objective/list-objectives.test.ts src/app/resource/list-resources.test.ts src/apps/cli/list-tasks.test.ts src/apps/cli/commands/read.test.ts` passes.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-reads-proof.sh` phase C line
  `eq "empty initiative task list" "0" …` (needs S6's row to be observable) and
  every `?name=` line in phases B/C/D.

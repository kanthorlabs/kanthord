# Story 00 — the detail views carry their ancestry, and `conflictCause` reaches the wire

Epic: `.agent/plan/epics/026.3-ui-entity-workspaces.md` — decision 5 (the
objective Summary renders the "conflict fields", plural) and decision 3's
"the real fix is ancestry in the detail DTOs"
Depends on: nothing. Backend only, independent of `ui/` — dispatch it first.

Lane exception (Ulrich, 2026-07-31): this one story writes six files under
`src/` plus their tests, relaxing the epic header's "writes only `ui/**` and
`scripts/**`". It still adds **no** API route, **no** new port, **no** new
constructor dependency and writes **no** data. Every other story in this epic
keeps the `ui/**` + `scripts/**` lane.

## Change

Six production files. Every added field is a value the use case **already has in
hand** — no new lookup, no new dependency, no composition change.

### 1. `src/app/initiative/get-initiative.ts` — `projectId`

Add to `GetInitiativeOutput`, immediately after `id`:

```ts
id: string;
projectId: string;
name: string;
```

and in the returned object, immediately after `id: initiative.id,`:

```ts
      projectId: initiative.projectId,
```

`Initiative.projectId` is a required domain field (`src/domain/initiative.ts:19`)
and `InitiativeSource.get` already returns the whole entity
(`get-initiative.ts:8-10`). Always present, never `null`.

### 2. `src/apps/http/views/initiative.ts:40-65` — `projectId`

Add `readonly projectId: string;` to `InitiativeDetailView` immediately after
`id`, and `projectId: result.projectId,` to `initiativeDetailView` immediately
after `id: result.id,`. Do **not** touch `InitiativeView` / `initiativeView` —
the list row already carries `projectId` (`views/initiative.ts:21,32`).

### 3. `src/app/objective/get-objective.ts` — `initiativeId`

Add to `GetObjectiveOutput`, immediately after `id`:

```ts
id: string;
initiativeId: string;
name: string;
```

and in the returned object, immediately after `id: objective.id,`:

```ts
      initiativeId: objective.initiativeId,
```

`Objective.initiativeId` is a required domain field
(`src/domain/initiative.ts:32`) and the use case already reads it for
`resolveInitiativeRepository(objective.initiativeId)`. Always present, never
`null`.

### 4. `src/apps/http/views/objective.ts:47-82` — `initiativeId` **and** `conflictCause`

Two additions to `ObjectiveDetailView`:

```ts
  readonly id: string;
  readonly initiativeId: string;
  readonly name: string;
  readonly status: string;
  …
  readonly waiting: readonly UnsatisfiedEdgeView[];
  /** The ref-update conflict cause, or `null` when none is persisted. */
  readonly conflictCause: string | null;
  readonly conflictReason: string | null;
  readonly note: string | null;
```

and the matching two lines in `objectiveDetailView`:

```ts
    id: result.id,
    initiativeId: result.initiativeId,
    name: result.name,
    …
    waiting: result.waiting.map(unsatisfiedEdgeView),
    conflictCause: result.conflictCause,
    conflictReason: result.conflictReason,
    note: result.note,
```

`conflictCause` is **always present, `null` when unset** — the convention
`conflictReason` and `note` already use in this view (`views/objective.ts:79-80`).
Do **not** use a conditional spread: an omitted key is the convention for
`commitOid`/`parentOid` only. Do **not** touch `ObjectiveView` /
`objectiveView` — the list row already carries both `initiativeId`
(`views/objective.ts:18,32`) and `conflictCause?` (`:25,41-43`).

### 5. `src/app/task/get-task.ts` — `initiativeId`

Add to `GetTaskOutput`, immediately after `objectiveId`:

```ts
  objectiveId: string;
  /** `null` is the degraded shape: the task's initiative could not be resolved. */
  initiativeId: string | null;
  dependencies: string[];
```

and in the returned object, immediately after `objectiveId: task.objectiveId,`:

```ts
      initiativeId: initiativeId ?? null,
```

reusing the **existing local** at `get-task.ts:150`
(`const initiativeId = this.#tasks.getInitiativeId(id);`, typed
`string | undefined`). Do not call `getInitiativeId` a second time and do not
move that line.

`null` when `getInitiativeId` returns `undefined` is the same degraded shape the
surrounding code already documents at `get-task.ts:148-150` and already applies
to `waiting: []`, `blockedForever: false` and `downstream: 0`.

### 6. `src/apps/http/views/task.ts:40-115` — `initiativeId`

Add `readonly initiativeId: string | null;` to `TaskDetailView` immediately after
`objectiveId`, and `initiativeId: result.initiativeId,` to `taskDetailView`
immediately after `objectiveId: result.objectiveId,`. Always present.

Do **not** touch `TaskRowView` / `taskRowView`: the task **list row** stays
ancestry-free in this story, because `TaskRow` (`src/app/task/list-tasks.ts:6-13`)
does not project `objectiveId` and adding it is a separate change with no
consumer in this epic.

## Constraints

- **Exactly six production files**, all listed above. No route, no use case
  constructor signature, no port, no `composition.ts`, no domain, no migration,
  no CLI.
- **`projectId` is NOT added to the objective or task detail views.** Neither
  `GetObjective` nor `GetTask` has an initiative source, so it would need a new
  constructor dependency and composition wiring. The UI walks up one level per
  GET, which it already does for breadcrumb names. Out of scope; report it as a
  remaining gap rather than widening this story.
- **Every view stays an explicit allow-list.** Do not replace a field list with a
  spread of the use-case output — the allow-list is what keeps an injected extra
  key off the wire, and three existing tests assert exactly that.
- **ETag values change** for `initiative.get`, `objective.get` and `task.get`,
  because `src/apps/http/app.ts:296-300` derives the validator from the presented
  DTO, and `routes.ts:634` names `objective.get` as a PATCH `readRow`. Correct and
  harmless: the GET and the precondition recompute from the same view, and no
  test pins a literal ETag for these routes (verified across
  `src/apps/http/routes*.test.ts`). Do not add an ETag override.
- **Do not change EPIC 026.3's scope validation.** Decision 3's collection-based
  rules are binding and Story 01 implements them verbatim, even though these new
  fields would allow a simpler direct-field check. That simplification needs
  Ulrich to amend decision 3; it is not this story's call.

## Verify

Two of the tests below **currently assert the omission this story removes**. They
are the contract being changed — update them, do not delete them.

- `node --test src/apps/http/views/objective.test.ts`:
  - `src/apps/http/views/objective.test.ts:59-84`
    (`objectiveDetailView omits commitOid and parentOid when absent from the source; conflictCause is never emitted`):
    drop `; conflictCause is never emitted` from the test name; add
    `"conflictCause"` and `"initiativeId"` to the expected sorted key list; add
    `initiativeId: "i1"` to the fixture; replace
    `assert.equal("conflictCause" in view, false)` with
    `assert.equal(view.conflictCause, null)`; assert
    `view.initiativeId === "i1"`.
  - `src/apps/http/views/objective.test.ts:86-110`
    (`objectiveDetailView includes commitOid and parentOid when present; …`):
    add `"conflictCause"` and `"initiativeId"` to the key list; add
    `initiativeId: "i1"` and set the fixture's `conflictCause` to
    `"cas-mismatch"`; replace `assert.equal("conflictCause" in view, false)` with
    `assert.equal(view.conflictCause, "cas-mismatch")`.
  - new case: `conflictCause: "non-single-commit"` with `conflictReason: null` →
    `view.conflictCause === "non-single-commit"` and
    `view.conflictReason === null`. The two fields are independent; neither
    implies the other.
  - new case: `conflictCause: null` with `conflictReason: "gate failed"` → both
    keys present with those values.
  - regression: a source carrying an injected `extra: "leak-me"` still produces
    exactly the expected sorted key list.
- `node --test src/apps/http/views/initiative.test.ts`: add `"projectId"` to the
  two `initiativeDetailView` key lists (`:66` and `:91`), add
  `projectId: "p1"` to both fixtures, and assert `view.projectId === "p1"` in
  each. Leave the two `initiativeView` list-row key lists (`:21`, `:43`) and every
  graph-view assertion untouched.
- `node --test src/apps/http/views/task.test.ts`: add `"initiativeId"` to the two
  `taskDetailView` key assertions (the `const keys = Object.keys(view)` case near
  `:57` and the `case 2: every field populated` list at `:137`), add
  `initiativeId` to the fixtures, and assert the value. **Leave the `taskRowView`
  key list at `:18` unchanged** — the row view gains nothing.
  - new case: `taskDetailView` over a `GetTaskOutput` with `initiativeId: null`
    emits the key with value `null`, not an omitted key.
- `node --test src/app/initiative/get-initiative.test.ts`: add
  `projectId: "proj-1"` to the two whole-output `assert.deepEqual(output, {…})`
  blocks (`:51` and `:74`). The fixtures already set `projectId: "proj-1"` on the
  `Initiative` entity, so no fixture change is needed.
  - new case: the returned `projectId` is the entity's, not derived — an entity
    with `projectId: "proj-2"` yields `output.projectId === "proj-2"`.
- `node --test src/app/objective/get-objective.test.ts`: add `initiativeId` to
  the two whole-output `assert.deepEqual(output, {…})` blocks (`:70` and `:260`),
  matching the `initiativeId` the fixture's objective already carries.
- `node --test src/app/task/get-task.test.ts`: add two cases beside the existing
  degraded-shape test at `:871`:
  - `getInitiativeId` returning `"i1"` → `output.initiativeId === "i1"`.
  - `getInitiativeId` returning `undefined` → `output.initiativeId === null`,
    **and** the existing degraded defaults still hold in the same case
    (`waiting` is `[]`, `blockedForever` is `false`, `downstream` is `0`).
- **Typed fixtures across the suite.** Adding a required field to
  `GetInitiativeOutput`, `GetObjectiveOutput` and `GetTaskOutput` breaks every
  test fixture typed as one of them. Enumerate them with
  `rg -n "GetInitiativeOutput|GetObjectiveOutput|GetTaskOutput" src --glob '*.test.ts'`
  and add the new field to each; `npm run typecheck` is the gate. Known sites to
  expect: `src/apps/http/routes.conflict.test.ts:36`,
  `src/apps/http/routes.initiative.test.ts:71`,
  `src/apps/cli/get-objective.test.ts:134`, `src/apps/cli/commands/read.test.ts`.
  A fixture cast with `as unknown as GetTaskOutput` needs no change.
- **CLI JSON output.** `node --test src/apps/cli/get-objective.test.ts`,
  `src/apps/cli/get-initiative.test.ts` and `src/apps/cli/commands/read.test.ts`
  must stay green. A `--json` assertion that compares a whole object gains the
  new field; a line-oriented assertion over
  `src/apps/cli/objective.ts:91-92`-style output does not change. Fix the
  expectation, never the production formatter.
- `npm run verify` exits 0.
- Proof: none directly. `scripts/e2e/ui-entities-proof.sh` asserts none of these
  fields, and `scripts/e2e/decision-workbench-proof.sh:300` reads `conflictCause`
  from the **`/conflict`** route, which this story does not touch. Story 04's
  Vitest cases prove the UI renders `conflictCause` once it arrives.

## Context that made this story necessary

- `conflictCause` was computed and then dropped: `GetObjectiveOutput` has carried
  it as `string | null` all along (pinned by
  `src/app/objective/get-objective.test.ts:329-342`), and
  `src/apps/cli/objective.ts:91-92` already prints it — only the HTTP detail view
  omitted it. This closes a CLI/HTTP parity gap.
- The ancestry gap is what forced EPIC 026.3 decision 3 to pay one collection
  read per ancestor level, and 026.3's own text says the real fix is ancestry in
  the detail DTOs.

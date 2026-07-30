# EPIC 020 — HTTP reads: the first `/api` surface (singular REST) — stories

Epic: `.agent/plan/epics/020-http-reads.md`
Prereq: EPIC 019 (sequence order) — koa app, Basic auth, envelope, error
registry, `ROUTES`, matcher, `serve` leaf all exist and stay running.

After these stories, `kanthord serve` answers 22 `GET /api/…` routes with
singular resource segments, covering 25 CLI read leaves, and
`scripts/e2e/http-reads-proof.sh` prints `020 ok: …`.

## Dispatch order

Strictly sequential: `01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10`.

- `01` must land first: every later row uses `defineRoute`.
- `02` must land before `04`: `PATH_SEGMENTS` carries the full final segment
  list, so stories `04`–`09` add rows without touching that test again.
- `03` is app-layer only (no HTTP): stories `05` and `06` depend on its
  behaviour.
- `04`–`09` are independent of each other but each one **must** keep the tree
  green on its own (see the "every story wires its own deps" fact below).
- `10` is the wiring audit + the Proof; it must be last.

## Stories

- S1 — generic `Route` + `defineRoute`, no `present!` in dispatch → `01-generic-route.md`
- S2 — the singular-path machine check → `02-path-segment-check.md`
- S3 — app-layer read changes (`name` filter, `ListTasks` empty fix) → `03-app-read-changes.md`
- S4 — project rows + shared view mirrors + `optionalQueryString` → `04-project-rows.md`
- S5 — initiative + objective rows → `05-initiative-objective-rows.md`
- S6 — task rows → `06-task-rows.md`
- S7 — resource rows → `07-resource-rows.md`
- S8 — ai-provider + model + queue rows → `08-provider-model-queue-rows.md`
- S9 — conflict rows + two registry entries → `09-conflict-rows-registry.md`
- S10 — wiring audit, retirement roadmap, Proof green → `10-wiring-and-proof.md`

## Facts (needed for implementation)

**Every story wires its own deps.** `HttpDeps` fields are REQUIRED, so a story
that adds a field must, in the same story:

1. add the field to `src/apps/http/deps.ts`;
2. populate it in `src/apps/cli/commands/serve.ts:39`
   (`const httpDeps: HttpDeps = { logger: deps.httpLogger };` → add
   `getProject: deps.getProject,` etc. — every use case already exists on
   `CliDeps`, see the map below).
   Otherwise the tree does not typecheck at the end of that story.

**`HttpDeps` is built in `serve.ts:39`, not in `composition.ts`.** `composition.ts`
only supplies `httpLogger: new PinoLogger()` (`src/composition.ts:1207`). No
`composition.ts` edit is needed by any story except S3's constructor change.

**CliDeps already exposes every read use case** (`src/apps/cli/deps.ts:191-230`,
bundle keys in `src/composition.ts:1160-1246`): `getProject:1165`,
`listProjects:1167`, `getProjectOverview:1169`, `getInitiative:1173`,
`getInitiativeGraph:1174`, `getObjective:1180`, `getResource:1183`,
`listResources:1184`, `listTasks:1196`, `getTask:1198`, `listInitiatives:1213`,
`listObjectives:1214`, `listModels:1216`, `getAiProvider:1222`,
`listAiProviders:1223`, `resolveProjectChain:1229`, `getConflict:1239`,
`getObjectiveConflict:1240`, `getDecisionQueue:1241`.

**Import boundary (`eslint.config.js:74-78`): a non-test file under
`src/apps/http/` may import from `src/app/**` only** — never `src/domain/**`,
never an adapter (`src/storage/port.ts`, `src/logger/**`). Consequences used by
every view story:

- A use-case OUTPUT type declared under `src/app/**` may be imported
  `import type` (that is how `error-registry.ts:2` reaches `app/errors.ts`).
- A type declared under `src/domain/**` or `src/storage/**` may NOT be. Those
  shapes get a local structural mirror in `src/apps/http/views/shared.ts`.
- Tests are exempt (`eslint.config.js:91-95`).

**View module template** — `src/apps/http/views/health.ts:1-14` +
`views/health.test.ts:1-16`. Mirror it exactly: a `*Result` input type, a
`*View` output interface carrying `readonly [key: string]: unknown;`, a
`*View(result)` function returning a LITERAL field list, and a leak test that
casts an over-populated object through `as unknown as *Result` and asserts
`Object.keys(view).sort()` is exactly the allowed set.

**Optional fields use a conditional spread**, never `key: undefined`:
`...(result.note !== undefined ? { note: result.note } : {})`. A `key: undefined`
survives `Object.keys()` and breaks the leak tests.
**Exception:** a `Record<string, number>` / `Record<string, string>` value map is
copied with a spread (`byType: { ...result.digest.byType }`) — the no-spread rule
covers entity/DTO objects, not value maps.

**`defineRoute` takes NO explicit type arguments.** Both `Input` and `Output` are
inferred (`Input` from `decode`'s return, `Output` from `run`'s). `Output` is
frequently a `domain/` type (`Project`, `Initiative`, `Objective`) that
`apps/http` may not name, so annotating it is impossible by design.

**Row unit-test deps pattern** (fakes, no server, no sqlite):

```ts
const deps = {
  getProject: {
    execute: async (input: { id: string }) => ({ id: input.id, name: "p" }),
  },
} as unknown as HttpDeps;
```

**Row HTTP-test pattern**: `buildHttpApp(deps, { apiKey: KEY, newRequestId: () => REQUEST_ID })`

- supertest, copying `src/apps/http/app.test.ts:20-43` (`KEY`, `AUTH`,
  `REQUEST_ID`, `makeLogger`, `makeDeps`) and `app.test.ts:80-97`.

**Test framework**: `node:test` + `node:assert/strict` only. Run one file with
`node --test <path>`.

**`src/apps/http/cli-coverage.test.ts` constraints:** `:37-46` every
`cliCommands` entry must name a real Commander leaf path exactly (all 25 names
used by this epic exist today); `:48-51` asserts `leaves.length === 80` — no
story adds or removes a CLI leaf, so it stays true; `:53-63` asserts the
uncovered set is NON-empty — still true after 25 leaves are claimed (80 leaves,
`serve` + `commands` excluded, 021–025 targets remain).

**`src/apps/http/error-registry.test.ts:12-14`** allows statuses
`{400,401,403,404,405,409,412,413,415,500}` and requires `snake_case`, unique
codes — the two new S9 codes satisfy it.

**Existing decode helpers** (`src/apps/http/decode.ts`): `requirePathParam`
(:3-13, trims, throws `InvalidInputError(name,"must not be blank")` → 400
`invalid_input`), `optionalQueryInt` (:15-38), `queryList` (:40-55). S4 adds
`optionalQueryString`.

**Status-union values** cannot be imported from `domain/`. `TaskStatus` (type
only) is legally reachable at `src/app/errors.ts:6`; the VALUE list is
re-declared locally where a story needs to validate a query parameter.

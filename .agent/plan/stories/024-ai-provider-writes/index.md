# EPIC 024 — ai-provider writes — stories

Epic: `.agent/plan/epics/024-ai-provider-writes.md`
Prereq: EPIC 023 (sequence order) and, through it, 022 and 021 — `defineRoute`,
the 63-row `ROUTES`, the `location` / `readRow` fields, `src/apps/http/etag.ts`,
`src/apps/http/body.ts`, `HttpMethod` accepting `"PUT"` with the `PUT_ROWS`
allowlist, `allowMethods` advertising `PUT`, and the 019 envelope / Basic auth /
error registry / middleware order all exist and stay running.

After these stories `kanthord serve` answers 9 more `/api` rows — 72 total —
covering the eight ai-provider write leaves plus a readiness probe that claims no
leaf, and `scripts/e2e/http-provider-writes-proof.sh` prints `024 ok: …`. The
capability that matters: `GET /api/project/:id/readiness` can report
`configured: true` with nothing done in a terminal.

## Dispatch order

Strictly sequential: `01 → 02 → 03 → 04 → 05 → 06`.

- `01` must land first: it registers the 24 error codes every later row raises,
  adds `502` to `ALLOWED_STATUSES`, adds the 3 path segments, adds the two
  decode/body helpers, and makes the two app-layer changes (`timeoutMs` on both
  probe use cases, `secretOf` + `ProviderCallFailedError` on `TestAiProvider`).
  It lands no row.
- `02`-`05` each land rows **plus every wiring edit in the same story**, because
  `HttpDeps` fields are REQUIRED — a row added without its `serve.ts` line does
  not typecheck.
- `06` is the Proof and the CLI-coverage inventory; it must be last.

Cumulative `ROUTES.length` after each story: `01` 63, `02` 65, `03` 68, `04` 70,
`05` 72, `06` 72.

## Stories

- S1 — the 24 registry codes, `502`, the 3 segments, 2 helpers, 2 app-layer changes → `01-registry-and-app-changes.md`
- S2 — `ai-provider.create` (`201` + `Location`) and `ai-provider.patch` (`If-Match`) → `02-register-and-update.md`
- S3 — the lifecycle rows: `default` `PUT`, `credential` `DELETE`, item `DELETE` → `03-lifecycle-rows.md`
- S4 — the project chain: assign (`POST` + `rank`) and unassign (`DELETE`) → `04-project-chain.md`
- S5 — the two outbound rows: `probe` and `completion` → `05-outbound-rows.md`
- S6 — Proof green, CLI-coverage inventory → `06-proof-and-inventory.md`

## Facts (needed for implementation)

**`ROUTES.length` is 24 in the tree as authored, 63 after EPIC 021 + 022 + 023.**
Every row story sets the assertion to the count actually in the file **plus the
rows it lands**. If the base is not 63 when `02` starts, raise an `OPEN:` blocker
rather than guessing. The three counters that move together for a new row:

1. `ROUTES.length` — `src/apps/http/routes.test.ts:248`
   (`assert.equal(ROUTES.length, 24);` today).
2. the expected-id list — `src/apps/http/routes.test.ts:251-278` (array literal;
   ids at `253-276`), looped at `277-279`.
3. `expectedCovered` — `src/apps/http/cli-coverage.test.ts:65-93`. Story `06`
   owns the 024 list; `02`-`05` do not touch it.

`leaves.length === 80` (`cli-coverage.test.ts:48-51`) stays true: 024 adds no CLI
leaf. The "uncovered set is non-empty" assertion (`cli-coverage.test.ts:53-63`)
also stays true and is **NOT** edited — no planned epic flips it. The retirement
plan is on hold until Ulrich revisits it after the UI and integration.

**`.agent/plan/**` is lane-forbidden to every role**
(`scripts/lane-check.sh:13-19`). No story edits any file under `.agent/plan/`.
Marking "Target 024 covered" in `retirement.md` is a human follow-up.

**`HttpDeps` is built in `src/apps/cli/commands/serve.ts:39-60`, NOT in
`composition.ts`.** All nine use cases are already constructed
(`composition.ts:262-275, 300-305`) and already on `CliDeps`
(`src/apps/cli/deps.ts`) under these names:

| `HttpDeps` field       | `CliDeps` name                      | note                                                      |
| ---------------------- | ----------------------------------- | --------------------------------------------------------- |
| `registerAiProvider`   | `registerAiProvider`                |                                                           |
| `updateAiProvider`     | `updateAiProvider`                  |                                                           |
| `assignAiProvider`     | `assignAiProvider`                  |                                                           |
| `unassignAiProvider`   | `unassignAiProvider`                |                                                           |
| `setDefaultAiProvider` | `setDefaultAiProvider`              |                                                           |
| `logoutAiProvider`     | `logoutAiProvider`                  |                                                           |
| `removeAiProvider`     | `removeAiProvider`                  |                                                           |
| `testAiProvider`       | `testAiProvider`                    |                                                           |
| `probeAiProvider`      | **`providerProbe`** (`deps.ts:250`) | the names DIFFER — `probeAiProvider: deps.providerProbe,` |

A story that adds an `HttpDeps` field must, in the same story:

1. add the `import type` (`src/apps/http/deps.ts`, last import `:20`);
2. add the `readonly` field (interface `26-47`, last field `:46`);
3. populate it in the `const httpDeps: HttpDeps = { … }` literal
   (`serve.ts:39-60`).

**`composition.ts` gets exactly ONE edit in this whole epic** — Story `01`'s
`secretOf` argument to `TestAiProvider` at `composition.ts:301`. Every other
story leaves it alone.

**Six of the nine use cases are SYNCHRONOUS.** `RegisterAiProvider.execute`
returns `string`, `UpdateAiProvider.execute` returns
`{id, changed}`, and `AssignAiProvider` / `UnassignAiProvider` /
`SetDefaultAiProvider` / `LogoutAiProvider` / `RemoveAiProvider` return `void` —
none is a promise. `run: async (deps, i) => deps.x.execute(i)` is legal and is
the required form. Do not add `await`-only wrappers and do not change a use case
to async. Only `TestAiProvider` and `ProbeAiProvider` are async.

**Two use cases take a POSITIONAL argument, not an input object.**
`SetDefaultAiProvider.execute(id: string)` (`set-default-ai-provider.ts:480`),
and `LogoutAiProvider.execute(id, options?)` /
`RemoveAiProvider.execute(id, options?)` take an id plus an options object
(`logout-ai-provider.ts:516`, `remove-ai-provider.ts:623`). Their `decode` must
therefore return a shape the row's `run` destructures — see Story `03`, which
fixes the exact shape so `decode` stays a pure mapping and `run` stays one line.

**The secret field is `value`, and it is never presented.** The HTTP view's
literal list is exactly `id, name, provider, model, baseUrl, effort, state,
isDefault` (`src/apps/http/views/ai-provider.ts:15-25`) and 024 adds NO field to
it. `AiProviderView` (`src/app/ai-provider/ai-provider-view.ts`) has no `value`
either. Do not add one "for debugging".

**`aiProviderView` and both read rows already exist** (EPIC 020,
`routes.ts:309-342`). `ai-provider.get` is the `readRow` for the PATCH. Do not
duplicate the view.

**`modelCatalog` IS wired into both register and update**
(`composition.ts:262-273`), so `UnknownProviderError`, `UnknownModelError` and
`InvalidEffortError` are reachable from a real request — the Proof's phase C
depends on it.

**`openai-codex` / `gpt-5.6-terra` is a real pinned pair** (7 models under
`openai-codex`; verified with `node src/main.ts list model --provider
openai-codex`). Story `02`'s builtin-path tests and the Proof's phase G use it.

**View module template** — `src/apps/http/views/conflict.ts:1-24`. Mirror it: an
`import type` of the app-layer input type, a `*View` interface whose LAST member
is `readonly [key: string]: unknown;`, and a `*View(result)` function returning a
LITERAL field list that copies arrays with `[...]` and never spreads the input.

**View leak test template** — `src/apps/http/views/conflict.test.ts:7-29`: build
an input with an extra `extra: "leak-me"` field cast
`as unknown as <AppType>`, then assert
`assert.deepEqual(Object.keys(view).sort(), [...])`.

**Optional fields use a conditional spread**, never `key: undefined`
(`views/task.ts:79-99`): `...(x !== undefined ? { x } : {})`. A `key: undefined`
survives `Object.keys()` and breaks the leak tests. `decode` builds its object
with conditional spreads too, because the row unit tests assert the EXACT object
the fake received with `assert.deepEqual`.

**Error classes may be imported straight from their use-case module.** Precedent:
`src/apps/http/error-registry.ts:6` imports `NoConflictCandidateError` from
`../../app/task/get-conflict.ts`. So Story `01` imports the 22
ai-provider-owned classes from `src/app/ai-provider/errors.ts` directly.
`UnknownModelError` is already re-exported from `src/app/errors.ts`; only
`LoggedOutProviderError` lives in `src/domain/errors.ts` and is re-exported
through `src/app/ai-provider/errors.ts:786` — import it from there, never from
`src/domain/**`.

**Import boundary** (`eslint.config.js:74-78`): a non-test file under
`src/apps/http/` may import from `src/app/**` only — never `src/domain/**`.
Tests are exempt (`eslint.config.js:91-95`).

**`src/apps/http/error-registry.test.ts` has exactly ONE test that iterates
`DOMAIN_ERROR_MAPPINGS`** — "registry hygiene" at `21-42`. There is no
one-class-per-code test to extend; a new mapping is covered by a per-class
`mapError` test in the style of `44-68`. The snake_case regex is
`/^[a-z]+(_[a-z]+)*$/` (`:29`) — all 24 new codes match. `ALLOWED_STATUSES`
(`:17-19`) is `400, 401, 403, 404, 405, 409, 412, 413, 415, 500` today: **024
adds `502`** (Story `01`). `428` is 021's job.

**Test framework**: `node:test` + `node:assert/strict` only, flat `test(...)`
calls, **no `describe`**. Run one file with `node --test <path>`.

**Row unit-test deps pattern** (fakes, no server, no sqlite) —
`src/apps/http/routes.provider.test.ts` already exists for the 020 provider
reads; extend it rather than creating a parallel file. The pattern is
module-scope `KEY`/`AUTH`/`REQUEST_ID`, a local `makeLogger()`, a `makeDeps()`
returning `{ deps, received, <counters> }` where each use case is
`{ execute: … } as HttpDeps["<field>"]` and the whole object is closed with
`as unknown as HttpDeps`; the app is built per test with
`buildHttpApp(deps, { apiKey: KEY, newRequestId: () => REQUEST_ID })` and driven
through `request(app.callback())`.

**The Proof already exists and already fails correctly.**
`scripts/e2e/http-provider-writes-proof.sh` is committed with the epic. Against
the tree as authored it exits **2** at the `PREREQ` probe (`POST /api/project`
answers `405` because 021 is not built yet); once 021-023 land it exits `1` in
phase C on `POST /api/ai-provider`. No story re-authors it; `06` only makes it
pass. If a phase asserts something the epic did not decide, that is an `OPEN:`
blocker, not a licence to edit the assertion.

**`node_modules` may be absent in a fresh worktree** — run `npm ci` before the
first `npm run verify` or any `scripts/e2e/*` script.

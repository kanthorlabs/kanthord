# EPIC 021 — HTTP planning writes: the first non-GET rows — stories

Epic: `.agent/plan/epics/021-http-planning-writes.md`
Prereq: EPIC 020 (sequence order) — `defineRoute`, the 24-row `ROUTES`, the
`PATH_SEGMENTS` allowlist, one view module per resource, and the 019 envelope /
Basic auth / error registry / middleware order all exist and stay running.
EPIC 022 (the event feed) is NOT a prerequisite and is not authored; no 021 row
touches the feed cursor (EPIC 021 header note).

After these stories `kanthord serve` answers 28 more `/api` rows — 52 total —
covering 27 CLI write leaves, with `POST` → `201` + `Location`, `PATCH` →
`If-Match` + `200` + a fresh `ETag`, dependency sub-resources → `204`, and
`scripts/e2e/http-writes-proof.sh` prints `021 ok: …`.

## Dispatch order

Strictly sequential: `01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09`.

- `01` must land first: every write row needs `location`, `readRow`, the `ETag`
  emitter and the two precondition codes.
- `02` must land before `04`: every write row's `decode` calls a body reader, and
  `PATH_SEGMENTS` carries the full final segment list so `04`–`08` add rows
  without touching that test again.
- `03` is app-layer + registry only (no HTTP row): `08` depends on
  `DiagnosticsExport.build`, and `04`–`08` depend on its 20 error mappings for
  their error-status assertions.
- `04`–`08` are independent of each other but each **must** keep the tree green
  on its own: each adds its own `HttpDeps` fields, populates them in
  `serve.ts`, and bumps the `ROUTES.length` assertion to its cumulative total.
- `09` is the wiring audit, the retirement roadmap and the Proof; it must be
  last.

Cumulative `ROUTES.length` after each story: `01` 24, `02` 24, `03` 24,
`04` 31, `05` 40, `06` 46, `07` 49, `08` 52, `09` 52.

## Stories

- S1 — the write contract in dispatch (`location`, `readRow`, `ETag`, `428`/`412`) → `01-write-contract-dispatch.md`
- S2 — the request-body reader + four path segments → `02-body-reader.md`
- S3 — app-layer changes and the 20 error mappings → `03-app-changes-registry.md`
- S4 — project / initiative / objective / task write rows → `04-planning-rows.md`
- S5 — resource write rows (4 creates, 4 PATCHes, bulk import) → `05-resource-rows.md`
- S6 — the six dependency sub-resource rows → `06-dependency-rows.md`
- S7 — graph rows (create, apply, export package) → `07-graph-rows.md`
- S8 — diagnostic and readiness rows → `08-diagnostic-readiness-rows.md`
- S9 — wiring audit, retirement roadmap, Proof green → `09-wiring-and-proof.md`

## Facts (needed for implementation)

**There are SEVEN `PATCH` rows, not six.** The EPIC's route table lists
`project.patch`, `initiative.patch`, `objective.patch`, `repository.patch`,
`credential.patch`, `notification.patch`, `filesystem.patch`; decision 1's
"All seven PATCH use cases return `Promise<void>`" agrees. Where the EPIC prose
says "the six PATCH rows" (route-table preamble) or "the other five PATCH rows"
(Proof phase E), the route table wins: 7 rows, 6 of them driven by
`patch_item` after `project.patch`.

**Every story wires its own deps.** `HttpDeps` fields are REQUIRED, so a story
that adds a field must, in the same story:

1. add the field to `src/apps/http/deps.ts`;
2. populate it in `src/apps/cli/commands/serve.ts:39-60` (the
   `const httpDeps: HttpDeps = { … }` literal).

Otherwise the tree does not typecheck at the end of that story.

**`CliDeps` already exposes every 021 write use case except `CheckGraph`**
(`src/apps/cli/deps.ts`): `createProject:172`, `renameProject:173`,
`createInitiative:181`, `renameInitiative:182`, `createObjective:188`,
`renameObjective:189`, `addResource:192`, `updateCredential:196`,
`updateRepository:197`, `updateNotification:198`, `updateFilesystem:199`,
`createTask:200`, `addDependency:201`, `removeDependency:202`,
`addInitiativeDependency:203`, `removeInitiativeDependency:204`,
`addObjectiveDependency:205`, `removeObjectiveDependency:206`,
`importResources:228`, `exportInitiative:229`, `createGraph:230`,
`applyGraph:231`, `diagnosticsExport:236`, `checkProject:251`, `newId:273`.
`checkGraph` is absent because the CLI adapter constructs `new CheckGraph()`
itself (`src/apps/cli/commands/check/graph.ts:8`, `_deps` unused) — Story S8
adds it to `CliDeps` and `composition.ts`.

**`HttpDeps` is built in `serve.ts:39`, not in `composition.ts`.** The only
`composition.ts` edit in this epic is S8's `checkGraph`.

**Import boundary (`eslint.config.js:74-78`): a non-test file under
`src/apps/http/` may import from `src/app/**` only** — never `src/domain/**`.
Consequences used by the row stories:

- A use-case INPUT or OUTPUT type declared under `src/app/**` may be imported
  `import type` — `AddResourceInput` (`src/app/resource/add-resource.ts:19`),
  `GraphPackage` (`src/app/graph/graph-package.ts:54`), `CreateGraphResult`
  (`create-graph.ts:49`), `ApplyGraphResult` (`apply-graph.ts:102`),
  `ReadinessEntry` (re-exported at `src/app/graph/check-graph.ts:13`),
  `ReadinessReport` (`src/app/project/project-readiness.ts:178`).
- `SafeFactsExport` is declared in `src/domain/safe-facts.ts:632` and may NOT be
  named. `views/diagnostic.ts` declares a local structural mirror; the value is
  assignable, so `present: (result) => diagnosticView(result)` typechecks
  without naming the domain type.
- `RepositoryAuth` (`src/domain/resource.ts:13`) may not be named either. It is
  NOT mirrored: Story S5 republishes it from `src/app/resource/add-resource.ts`
  and `body.ts` imports it from there, so a fourth auth kind cannot drift two
  declarations apart.
- Tests are exempt (`eslint.config.js:91-95`).

**No `as` cast in a row, and none in `body.ts`.** There is no generic
`requireBodyShape<T>` helper: a runtime check of "non-null, non-array object"
behind an arbitrary return type `T` is an unchecked assertion wearing a
validator's name. The two rows that carry a `GraphPackage` in `pkg` call
`parseGraphPackageDocument` (Story S3), a real app-layer validator, so a
malformed package is `400 invalid_package` instead of a `500`. "The client
already parsed it" is not a server trust boundary.

Where a literal type is needed (`type: "repository"`, `provider: "slack"`),
the decode function is a module-local function with an **annotated return type**
(`(input: RouteInput): AddResourceInput`) so the literals are contextually
typed, plus an explicit narrowing `if` for a union-valued field. `as const` is
not used.

**View module template** — `src/apps/http/views/health.ts:1-14`. Mirror it
exactly: a `*Result` input type (or an imported `app/` DTO type), a `*View`
output interface carrying `readonly [key: string]: unknown;` on the TOP-LEVEL
interface only, a `*View(result)` function returning a LITERAL field list, and
a leak test that casts an over-populated object through `as unknown as *Result`
and asserts `Object.keys(view).sort()` is exactly the allowed set.

**Optional fields use a conditional spread**, never `key: undefined`:
`...(x !== undefined ? { x } : {})`. A `key: undefined` survives
`Object.keys()` and breaks the leak tests. Arrays are copied with `[...x]`,
value maps with `{ ...x }`.

**`decode` builds its object with conditional spreads too**, for the same
reason: `CreateInitiative` distinguishes an absent `after` from
`after: undefined` only by `Object.keys`, and the row unit tests assert the
exact object the fake received.

**Row unit-test deps pattern** (fakes, no server, no sqlite) —
`src/apps/http/routes.project.test.ts:1-100`: module-scope
`KEY`/`AUTH`/`REQUEST_ID`, a local `makeLogger()` returning
`{ lines, info, warn, error }`, a `makeDeps()` returning
`{ deps, received, <spyCounters> }` where each use case is
`{ execute: … } as HttpDeps["<field>"]` and the whole object is closed with
`as unknown as HttpDeps`; the app is built per test with
`buildHttpApp(deps, { apiKey: KEY, newRequestId: () => REQUEST_ID })` and driven
through `request(app.callback())`. Flat `test(...)` calls — **no `describe`**.

**Test framework**: `node:test` + `node:assert/strict` only. Run one file with
`node --test <path>`.

**Three counters move in lockstep for any new row**: `ROUTES.length`
(`src/apps/http/routes.test.ts:248`), the expected-id list
(`routes.test.ts:253-276`), and — when the row claims CLI leaves — the
`expectedCovered` list in `src/apps/http/cli-coverage.test.ts:67-93`.
`leaves.length === 80` (`cli-coverage.test.ts:50`) stays true: 021 adds no CLI
leaf. The "uncovered set is non-empty" assertion
(`cli-coverage.test.ts:53-63`) also stays true: 78 retirable leaves minus 25
(020) minus 27 (021) leaves 26 uncovered.

**Three EPIC amendments the human must apply** (the plan tree is lane-forbidden
to every role, verified: `lane-check.sh` exits `1`). Each is a contradiction
inside the EPIC that a story must not reinterpret away silently — they are
recorded here, applied by the human, and the stories are written to the resolved
reading:

1. **Verification Gate phase H** must stop implying a numeric `schemaVersion` —
   the document's value is the string `"007.1"`. (Note: `validateSafeFactsRecord`
   does NOT validate `schemaVersion`'s type, so nothing else pins it.)
2. **Decision 5 / decision 7** must say that the four resource PATCH rows accept
   `type` as an immutable-field probe. As written, decision 5's body lists plus
   decision 7's "decode builds its object with a literal field list regardless"
   make `409 immutable_field` unreachable while the registry and Proof phase E
   both require it. The stories forward `type` ONLY — see Story S5.
3. **The error registry** gains `invalid_package` → `400`
   (`GraphPackageDocumentError`), and decision 6 must record that the JSON package
   is validated server-side by a new app-layer decoder. As written it hands an
   untrusted object to `CreateGraph` typed as `GraphPackage`.

**Two lines of `scripts/e2e/http-writes-proof.sh` are wrong and S9 fixes them**
(the script is in the software-engineer's lane; only the three pipeline guards
are locked):

- line 1151 asserts `typeof v.schemaVersion === "number"` for the diagnostic
  document, but `SCHEMA_VERSION` is the string `"007.1"`
  (`src/domain/safe-facts.ts:602`). The document must NOT be changed to satisfy
  it; the assertion becomes `typeof v.schemaVersion==="string"`.
- the phase-E comment "the other five PATCH rows" describes six calls; the
  comment text is corrected to "six".

**No middleware is added, removed or reordered** (EPIC decision 9). Every gate
a write passes already exists at `src/apps/http/app.ts:138-200`.

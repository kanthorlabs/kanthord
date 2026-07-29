---
epic: .agent/plan/epics/018-update-ai-provider.md
opened: 2026-07-29
opener: test-engineer
base-ref: 318ad3826bd0d71e83731ba2b75bc602f6a4719b
---

# Implementation cycle — 018-update-ai-provider

Pulled from EPIC: `.agent/plan/epics/018-update-ai-provider.md`.

Verification gate (binding, from the EPIC's `## Verification Gate` section):

> Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).
> Hermetic coverage required beyond the Proof is enumerated in the EPIC's
> Verification Gate section — one validator with two callers, a closed mutable
> set with typed ImmutableFieldError-style refusals, zero-flag usage error with
> zero writes, custom-vs-builtin shape enforcement, secret rotation through
> updateCredentialCAS only, no secret on any output stream, logged_out refusal,
> atomicity in one UnitOfWork.transaction, identity/wiring survival, and no new
> event type or migration.
> Proof: `scripts/e2e/update-ai-provider-proof.sh` must print `018 ok: …` with
> phases A–F.

TDD protocol:

1. test-engineer writes the next failing test (RED) — or a GREEN-ONLY pass-through for Tasks without `Action — RED:`.
2. software-engineer makes the test green (RED flow) or implements the Task spec directly (GREEN-ONLY flow).
3. test-engineer confirms GREEN (or runs a build-only check for GREEN-ONLY), then either opens the next Task or runs the full Verification Gate and appends IMPLEMENTATION_READY_FOR_REVIEW.

## TEST-ENGINEER — S1 extract config validator · RED

**Cycle.** RED for Story S1 (`.agent/plan/stories/018-update-ai-provider/01-extract-config-validator.md`).

**Test written.**

- file: `src/app/ai-provider/config-validation.test.ts` (new) — suite: module path — methods: table-driven `test(...)` cases, one per rule 1-9 of `validateCustomProviderConfig`, plus an all-valid pass case, a `require:{false,false}`-both-absent pass case (update-path shape), an `allowInsecure` suppression case, and three `validateBuiltinBaseUrl` cases (valid, malformed, non-http(s)).
- asserts: `validateCustomProviderConfig(cfg, require)` throws the same typed error the register path throws today for each invalid rule, in isolation, and does not throw on a fully valid config or on the required-fields-absent update shape; `validateBuiltinBaseUrl` accepts absolute http(s) and rejects everything else.

**RED proof.**

- command: `node --test src/app/ai-provider/config-validation.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/app/ai-provider/config-validation.ts' imported from '.../config-validation.test.ts'` (the seam does not exist yet — correct reason).
- confirmed no regression: `node --test src/app/ai-provider/register-ai-provider.test.ts` → `pass 33 / fail 0` (unchanged, not touched by this turn).

**Open to Software Engineer.**

- Create `src/app/ai-provider/config-validation.ts` exporting exactly:
  - `interface CustomProviderConfig { api?: string; effort?: string; customProviderId?: string; baseUrl?: string; contextWindow?: number; maxTokens?: number; allowInsecure?: boolean; }`
  - `function validateCustomProviderConfig(cfg: CustomProviderConfig, require: { customProviderId: boolean; baseUrl: boolean }): void`
  - `function validateBuiltinBaseUrl(baseUrl: string): void`
- Per Story S1 `## Change`: the nine checks run in the numbered order, each skipped when its field is `undefined` (except the two `require` presence checks), throwing the same typed errors `RegisterAiProvider.execute` throws today (`InvalidApiFlavorError`, `InvalidEffortError`, `MissingCustomProviderIdError`, `MissingBaseUrlError`, `InvalidBaseUrlError`, `InvalidNumericFlagError`, `EmbeddedCredentialError`, `InsecureEndpointError`).
- Rewire `RegisterAiProvider.execute` to call these two functions in place of the inline blocks at `register-ai-provider.ts:88-147` (custom path) and `:190-199` (builtin path), per Story S1's exact replacement calls — `register-ai-provider.test.ts` must keep passing unchanged.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — S1 extract config validator · GREEN

**Cycle.** GREEN for `src/app/ai-provider/config-validation.test.ts`.
**Files changed.**

- `src/app/ai-provider/config-validation.ts` (new) — `CustomProviderConfig`, `validateCustomProviderConfig(cfg, require)`, `validateBuiltinBaseUrl(baseUrl)`, the nine numbered checks moved verbatim from `register-ai-provider.ts`, same typed errors, same order.
- `src/app/ai-provider/register-ai-provider.ts` (edited) — custom path (`:88-147` old) replaced by one `validateCustomProviderConfig({...}, { customProviderId: true, baseUrl: true })` call; builtin path (`:190-199` old) replaced by `if (input.baseUrl !== undefined) validateBuiltinBaseUrl(input.baseUrl);`; dropped now-unused imports (`InvalidBaseUrlError`, `EmbeddedCredentialError`, `InsecureEndpointError`, `MissingCustomProviderIdError`, `MissingBaseUrlError`, `InvalidNumericFlagError`, `InvalidApiFlavorError`, `hasEmbeddedUserinfo`, `isInsecureEndpoint`, `REASONING_EFFORTS`); kept `InvalidEffortError`, `EmptyValueError`, `UnknownProviderError`, `UnknownModelError` (still used by the catalog path / empty-value guard). `input.customProviderId!` used at the `registry.register` call site since the validator (thrown above it, same invariant as the original inline check) guarantees it is defined there — TS can't narrow a value across a separate function call.

**Seam (GREEN).** The extracted module reproduces the register path's nine checks in the same numbered order, throwing the same error classes, so the new table-driven test's `assert.throws`/`assert.doesNotThrow` cases pass; `register-ai-provider.ts` now delegates to it, keeping its own test's behaviour byte-identical.

**Refactor.** Named refactor is the extraction itself (Story S1's only Task) — no further cleanup beyond wiring the two call sites; the catalog checks (`isValid`/`hasProvider`/`getEfforts`) and the drift-warning/first-wins lines stayed untouched per the Story's constraint.

**Build check.**

- typecheck: exit 0

**Assumptions.**

- VERIFIED: `AiProviderRegistry.register`'s `provider` field is `string` (non-optional) per `src/storage/port.ts:310-320`, so `input.customProviderId!` is required at that call site once the validator (called immediately above, same as the original inline throw) has confirmed it is defined — the invariant is unchanged from the pre-refactor code, only the enforcement point moved into the extracted function.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — S1 confirm GREEN · S2 registry update · RED

**Cycle.** Confirmed GREEN for Story S1, then RED for Story S2 (`.agent/plan/stories/018-update-ai-provider/02-registry-update-port-and-adapter.md`).

**Confirm GREEN (S1).**

- command: `node --test src/app/ai-provider/config-validation.test.ts` → `pass 16 / fail 0`.
- command: `node --test src/app/ai-provider/register-ai-provider.test.ts` → `pass 33 / fail 0` (byte-identical to the pre-refactor baseline recorded in the prior TE turn — proves the extraction changed no behaviour).

**Test written.**

- file: `src/storage/sqlite/ai-provider-registry.test.ts` (edited — appended; `UnknownReferenceError` import added at the top) — suite: module path — methods added:
  - `SqliteAiProviderRegistry: update with a single-key patch changes only that column`
  - `SqliteAiProviderRegistry: update with a multi-key patch writes all five config columns`
  - `SqliteAiProviderRegistry: update with an empty patch issues no UPDATE and returns the current row`
  - `SqliteAiProviderRegistry: update on an unknown id throws UnknownReferenceError`
  - `SqliteAiProviderRegistry: update keeps the row's id stable and list() still returns exactly one row`
- asserts: `registry.update(id, patch)` writes only the keys present in `patch` (single-key case leaves `name`/`provider`/`value`/`state`/`credentialVersion` byte-identical; multi-key case writes all five listed columns), an empty patch issues no write and returns the current row unchanged, an unknown id throws `UnknownReferenceError`, and `list()` still returns exactly one row with the same id after an update.

**RED proof.**

- command: `node --test src/storage/sqlite/ai-provider-registry.test.ts`
- exit: 1 — failure: `TypeError: registry.update is not a function` (all 5 new cases fail on this line; the unknown-id case additionally reports `AssertionError: The error is expected to be an instance of "UnknownReferenceError". Received "TypeError"` — the seam does not exist yet, correct reason).
- summary: `tests 29 / pass 24 / fail 5` — the 24 passing are the pre-existing suite, unaffected.

**Open to Software Engineer.**

- `src/storage/port.ts` — add to the `AiProviderRegistry` interface (after `register`, before `list()`):
  `update(id: string, patch: { model?: string; baseUrl?: string; effort?: string; api?: "openai-completions" | "openai-responses"; contextWindow?: number; maxTokens?: number }): GlobalAiProvider;`
  Throws `UnknownReferenceError` when no row has that id.
- `src/storage/sqlite/ai-provider-registry.ts` — implement `update` per Story S2's `## Change` (fixed column order `model, baseUrl, effort, api, contextWindow, maxTokens`; empty patch issues no UPDATE and returns `this.get(id)!`; never touches `name`, `provider`, `value`, `state`, `credentialVersion`).
- Per Story S2's Constraints: every fake `AiProviderRegistry implements` in the test suite (`grep -rln "implements AiProviderRegistry" src`) needs the new method added — minimal in-Map merge in fakes this story does not otherwise exercise, never a `throw`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — S2 registry update port + adapter · GREEN

**Cycle.** GREEN for `src/storage/sqlite/ai-provider-registry.test.ts` (S2 `update` cases).
**Files changed.**

- `src/storage/port.ts` (edited) — added `update(id, patch): GlobalAiProvider` to the `AiProviderRegistry` interface, placed immediately after `register` and before `list()`, per Story S2's exact signature and doc comment.
- `src/storage/sqlite/ai-provider-registry.ts` (edited) — implemented `update` immediately after `register`: imports `UnknownReferenceError` (added beside `DuplicateNameError`) and `SQLInputValue` (type-only, beside `DatabaseSync`); builds the `SET` list from keys present in `patch` in the fixed order `model, baseUrl, effort, api, contextWindow, maxTokens`, bound positionally via a typed `SQLInputValue[]` accumulator; an empty patch issues no `UPDATE` and returns `this.get(id)!` unchanged; `result.changes === 0` throws `new UnknownReferenceError("ai_provider", id)`; returns `this.get(id)!` on success. The statement never mentions `name`, `provider`, `value`, `state`, or `credentialVersion`. `register`, `logout`, `updateCredentialCAS` and the assignment methods are untouched.

**Seam (GREEN).** `SqliteAiProviderRegistry.update` now exists with the exact signature the port declares, so the five new test cases (single-key patch, multi-key patch, empty patch no-op, unknown-id throw, id/list stability) execute against real SQLite and pass.

**Refactor.** None named beyond the seam itself (Story S2 has no separate refactor step); no changes made outside `port.ts` and the adapter file.

**Build check.**

- typecheck: **not clean** — `npx tsc --noEmit` now reports `Property 'update' is missing` on every `class Fake... implements AiProviderRegistry` / object-literal cast to `AiProviderRegistry` declared inside `*.test.ts` files (confirmed the two production files I edited introduce zero new errors on their own — the only adapter-side error, an `unknown`→`SQLInputValue` mismatch on `run(...values, id)`, was fixed by typing `values: SQLInputValue[]`). Affected test files (all test-only, none touched):
  `src/agent-runner/pi-provider-probe.test.ts`, `pi-session.builtin.test.ts`, `pi-session.custom.test.ts`, `pi-session.test.ts`,
  `src/app/ai-provider/assign-ai-provider.test.ts`, `get-ai-provider.test.ts`, `list-ai-providers.test.ts`, `logout-ai-provider.test.ts`, `register-ai-provider.test.ts`, `register-global-provider.test.ts`, `remove-ai-provider.test.ts`, `resolve-project-chain.test.ts`, `set-default-ai-provider.test.ts`, `unassign-ai-provider.test.ts`,
  `src/app/auth/login-provider.test.ts`, `src/app/project/observe-setup-facts.test.ts`.

**OPEN: fakes live in test files, outside my lane.**
Story S2's Constraints ask the implementer to add the new `update` method to every `AiProviderRegistry` fake, but `grep -rln "implements AiProviderRegistry" src` shows every conformer besides the SQLite adapter I just edited lives inside a `*.test.ts` file (list above). Per the hard role boundary ("Edit test files, fixtures, or mocks under the test targets… Missing mock → `OPEN:`"), I did not touch any of them. The test-engineer needs to add a minimal in-Map-merge `update` to each fake (never a `throw`, per the Story's own constraint) so `npm run typecheck` / `npm run verify` go green.

**Assumptions.**

- VERIFIED: `node:sqlite`'s `SQLInputValue` type (`node_modules/@types/node/sqlite.d.ts:42`) covers `null | number | bigint | string | NodeJS.ArrayBufferView`, matching the patch's `string`/`number` value shapes, so typing the positional-bind accumulator as `SQLInputValue[]` resolves the `run(...)` overload without a cast.
- VERIFIED: `UnknownReferenceError(kind, id)` constructor shape at `src/domain/errors.ts:19-29` matches the `new UnknownReferenceError("ai_provider", id)` call added.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — S2 blocker resolved · confirm GREEN · S3 use case RED

**Cycle.** Resolved the S2 OPEN blocker (fakes needed `update`), confirmed GREEN for Story S2, then RED for Story S3 (`.agent/plan/stories/018-update-ai-provider/03-update-ai-provider-use-case.md`).

**Blocker resolved.**

- `grep -rln "implements AiProviderRegistry" src` found 12 conformers; a broader `grep -rl "AiProviderRegistry"` also found object-literal-typed fakes (`as AiProviderRegistry` / `: AiProviderRegistry`) in `register-global-provider.test.ts`, `login-provider.test.ts`, `pi-session.test.ts` (×2), `pi-session.custom.test.ts`, `pi-session.builtin.test.ts`.
- Added a minimal in-Map-merge `update(id, patch)` to every `class FakeRegistry`/`NormalFakeRegistry` (`set-default-ai-provider.test.ts`, `logout-ai-provider.test.ts`, `register-ai-provider.test.ts`, `get-ai-provider.test.ts`, `list-ai-providers.test.ts`, `assign-ai-provider.test.ts`, `unassign-ai-provider.test.ts`, `remove-ai-provider.test.ts`, `resolve-project-chain.test.ts`, `pi-provider-probe.test.ts` ×2 — the latter two have no map, so they merge over `this.get(id)`) and to `observe-setup-facts.test.ts`'s `FakeRegistry` (its map is `byId`, not `#store`).
- Added a non-throwing `update` property to the object-literal fakes (`register-global-provider.test.ts`, `login-provider.test.ts`, `pi-session.test.ts` ×2, `pi-session.custom.test.ts`, `pi-session.builtin.test.ts`), adding the `GlobalAiProvider` type import where missing. None throws, per the Story's constraint.

**Confirm GREEN (S2).**

- command: `node --test src/storage/sqlite/ai-provider-registry.test.ts` → `pass 29 / fail 0` (unchanged prior 24 + the 5 new `update` cases).
- command: `npx tsc --noEmit` → exit 0, no output (the SE's reported typecheck failure across the 16 fake-conformer test files is resolved).
- command: `node --test <all 16 touched test files>` → `pass 155 / fail 0` (no regression from the fake edits).

**Test written (S3, RED).**

- file: `src/app/ai-provider/update-ai-provider.test.ts` (new) — suite: module path — 20 `test(...)` cases covering the Story's Verify list: no-fields → `NoUpdateFieldsError` with zero registry calls; unknown id → `UnknownReferenceError`; `logged_out` → `LoggedOutProviderError` with zero writes; custom-row valid `{model}` patch calls `update` once with exactly `{model}`; custom-row invalid `--context-window 0` → `InvalidNumericFlagError` with zero `update` calls; custom row never consults a catalog whose methods throw if called; builtin row — each of `api`/`baseUrl`/`contextWindow`/`maxTokens` alone → `BuiltinProviderFieldError` naming that field, and several together names `api` (fixed order); builtin model revalidation — unknown model → `UnknownModelError`, unknown provider kind → `UnknownProviderError`, bad effort → `InvalidEffortError`; secret rotation — `{value}` calls `updateCredentialCAS` once and `update` zero times; `{model,value}` calls both, config write before CAS (asserted via an ordered call-log array); empty secret → `EmptyValueError`; stale CAS (`{applied:false}`) → `StaleCredentialError`; atomicity — invalid `--max-tokens` with a valid `--model`, driven through a `RecordingUnitOfWork` that records whether its wrapped body threw, asserts `InvalidNumericFlagError` + zero `update` calls + body-threw; changed-list order — `{maxTokens, model, value}` → `changed: ["model","maxTokens","value"]`.
- asserts: `UpdateAiProvider.execute(input)` enforces the Story's fixed 8-step order end to end, purely against a hand-written `FakeRegistry` (an ordered call-log array records `get`/`update`/`updateCredentialCAS` invocations) + `FakeUnitOfWork`/`RecordingUnitOfWork` + `FakeModelCatalog`.

**RED proof.**

- command: `node --test src/app/ai-provider/update-ai-provider.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/app/ai-provider/update-ai-provider.ts' imported from '.../update-ai-provider.test.ts'` (the seam does not exist yet — correct reason; the test also imports `NoUpdateFieldsError`, `BuiltinProviderFieldError`, `StaleCredentialError` from `./errors.ts`, which don't exist there yet either).
- confirmed no regression: `node --test src/app/ai-provider/register-ai-provider.test.ts` → `pass 33 / fail 0` (unchanged, not touched by this turn).

**Open to Software Engineer.**

- Create `src/app/ai-provider/update-ai-provider.ts` exporting exactly the shape Story S3 specifies:
  - `interface UpdateAiProviderInput { id: string; model?: string; baseUrl?: string; effort?: string; api?: "openai-completions" | "openai-responses"; contextWindow?: number; maxTokens?: number; value?: string; allowInsecure?: boolean; }`
  - `type UpdateAiProviderOutput = { id: string; changed: string[] }`
  - `class UpdateAiProvider { constructor(registry: AiProviderRegistry, uow: UnitOfWork, catalog?: ModelCatalog); execute(input: UpdateAiProviderInput): UpdateAiProviderOutput; }`
- Append to `src/app/ai-provider/errors.ts`: `NoUpdateFieldsError` (no-arg ctor), `BuiltinProviderFieldError(field: string)` with `readonly field`, `StaleCredentialError(id: string)` with `readonly id`.
- Wire `src/apps/cli/error-map.ts` per Story S3's mandatory step (the three new classes into the `instanceof` chain beside the existing ai-provider imports).
- Story S3's `## Change` numbered steps 1-8 are binding for method behaviour (order of the fixed-key collection, transaction placement, custom-vs-builtin branch, catalog revalidation, config-write-before-CAS ordering, `changed` ordering with `"value"` last).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — S3 UpdateAiProvider use case · GREEN

**Cycle.** GREEN for `src/app/ai-provider/update-ai-provider.test.ts`.
**Files changed.**

- `src/app/ai-provider/update-ai-provider.ts` (new) — `UpdateAiProviderInput`, `UpdateAiProviderOutput`, `class UpdateAiProvider(registry, uow, catalog?)` with one `execute()` implementing Story S3's fixed 8-step order: collect present config keys (`model, baseUrl, effort, api, contextWindow, maxTokens`, + `value` last) before any read/transaction → `NoUpdateFieldsError` on empty; inside `uow.transaction`, `registry.get` → `UnknownReferenceError`; `state === "logged_out"` → `LoggedOutProviderError(id, "update")`; custom row (`current.api !== null`) delegates to Story S1's `validateCustomProviderConfig({...}, {customProviderId:false, baseUrl:false})`, never touching the catalog; builtin row (`current.api === null`) refuses `api`/`baseUrl`/`contextWindow`/`maxTokens` in that fixed order via `BuiltinProviderFieldError`, then (catalog wired) revalidates `model` (`UnknownProviderError`/`UnknownModelError`) and `effort` (`InvalidEffortError`, `modelToCheck = input.model ?? current.model`); writes the config patch via `registry.update` (present keys only, never `value`) before rotating the secret via `registry.updateCredentialCAS(id, value, current.credentialVersion)` (`EmptyValueError` on `""`, `StaleCredentialError` on `{applied:false}`); returns `{id, changed}` in step-1 order.
- `src/app/ai-provider/errors.ts` (edited) — appended `NoUpdateFieldsError` (no-arg ctor, verbatim message), `BuiltinProviderFieldError(field)` with `readonly field`, `StaleCredentialError(id)` with `readonly id`, matching the file's existing doc-comment / `this.name` style.
- `src/apps/cli/error-map.ts` (edited) — added the three new classes to the existing `../../app/ai-provider/errors.ts` import and to the `instanceof` chain (mandatory per Story S3: an unmapped error re-throws at `:159` and crashes the CLI).

**Seam (GREEN).** `UpdateAiProvider` matches the exact constructor/`execute` shape the test imports; all 20 of the test's cases (no-fields, unknown id, logged_out, custom valid/invalid, catalog-not-consulted, builtin forbidden-fields fixed order, builtin model/effort revalidation, secret rotation ordering, empty/stale secret, atomicity, changed-list order) exercise this single code path against the test's `FakeRegistry`/`FakeUnitOfWork`/`RecordingUnitOfWork`/`FakeModelCatalog`.

**Refactor.** None named beyond the seam itself (Story S3 has no separate refactor step); reused Story S1's `validateCustomProviderConfig` and the existing `UnknownReferenceError`/`LoggedOutProviderError`/`UnknownModelError`/`UnknownProviderError`/`InvalidEffortError`/`EmptyValueError` — no second copy of any rule.

**Build check.**

- typecheck: **not clean**, but the only reported errors are inside the test file, outside my lane:
  `src/app/ai-provider/update-ai-provider.test.ts(381,13): error TS2532: Object is possibly 'undefined'.`
  `src/app/ai-provider/update-ai-provider.test.ts(382,13): error TS2532: Object is possibly 'undefined'.`
  Both are `noUncheckedIndexedAccess` failures on `relevant[0].startsWith(...)` / `relevant[1].startsWith(...)` at lines 381-382 (`relevant` is a filtered `string[]`, so `relevant[0]`/`relevant[1]` type as `string | undefined` under the repo's `noUncheckedIndexedAccess: true`). `npx tsc --noEmit`'s full output lists exactly these two errors and nothing else, confirming the three production files I touched (`update-ai-provider.ts`, `errors.ts`, `error-map.ts`) introduce zero new errors on their own.

**OPEN: two lines in the RED test file need a `noUncheckedIndexedAccess` fix, outside my lane.**
`src/app/ai-provider/update-ai-provider.test.ts:381-382` index a filtered array and call `.startsWith` directly on the element, which the repo's `noUncheckedIndexedAccess: true` types as `string | undefined`. This is unrelated to Story S3's seam — the use case itself, its errors, and the CLI error-map wiring are all correct and complete — but it blocks a clean `npm run typecheck`. Per the hard role boundary ("Never edit test files... Missing mock → `OPEN:`"), I did not touch the test file. The test-engineer needs a narrow fix at those two lines (e.g. non-null assertion `relevant[0]!.startsWith(...)` / `relevant[1]!.startsWith(...)`, consistent with `assert.equal(relevant.length, 2)` immediately above guaranteeing both indices exist) so `npm run typecheck` / `npm run verify` go green.

**Assumptions.**

- VERIFIED: Story S3's step 5 gates the builtin catalog block on `catalog !== undefined`, and the effort check inside it uses `modelToCheck = input.model ?? current.model` independent of whether `model` was itself present — confirmed against the test's effort-only case (`{id, effort}` with no `model`), which requires the effort check to run without a `model` field.
- VERIFIED: `FakeModelCatalog.getEfforts` (`src/model-catalog/fake.ts:24-26`) always returns the fixed list `["minimal","low","medium","high","xhigh"]` regardless of args, so the effort-revalidation test's `"not-a-real-effort"` value is guaranteed to miss it.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — S3 blocker resolved · confirm GREEN · S4 CLI command RED

**Cycle.** Resolved the S3 OPEN blocker (two `noUncheckedIndexedAccess` errors in the RED test file), confirmed GREEN for Story S3, then RED for Story S4 (`.agent/plan/stories/018-update-ai-provider/04-cli-update-ai-provider-command.md`).

**Blocker resolved.**

- `src/app/ai-provider/update-ai-provider.test.ts:377-383` — destructured `relevant` into `[first, second]` and guarded each with `!== undefined` before `.startsWith(...)`, right below the `assert.equal(relevant.length, 2)` that already guarantees both indices exist. No assertion weakened — still checks config-write-before-CAS ordering.

**Confirm GREEN (S3).**

- command: `node --test src/app/ai-provider/update-ai-provider.test.ts` → `pass 20 / fail 0`.
- command: `npx tsc --noEmit` → exit 0, no output (the two reported errors are gone).
- command: `node --test src/apps/cli/error-map.test.ts` → `pass 20 / fail 0` (no regression from the S3 error-map wiring).

**Test written (S4, RED).**

- file: `src/apps/cli/commands/update.test.ts` (edited — appended) — suite: module path — methods added:
  - `updates an ai-provider's model and emits the changed field names`
  - `rotates an ai-provider's secret from stdin through --value-file and never echoes it`
  - `rejects --name and --provider on update ai-provider as unknown options`
  - `parses --context-window on update ai-provider as a number`
  - `documents ai-provider update with usage and example help text`
- file: `src/apps/cli/ai-provider.test.ts` (edited — appended; `NoUpdateFieldsError` import added, `runUpdateAiProvider` imported from `./ai-provider.ts`, `UpdateAiProvider` type imported from `../../app/ai-provider/update-ai-provider.ts`) — suite: module path — method added: `runUpdateAiProvider: a thrown NoUpdateFieldsError becomes exit 1 with an error-prefixed stderr line and empty stdout`.
- file: `src/apps/cli/architecture.test.ts` (edited) — bumped `EXPECTED_LEAF_FILE_COUNT` 72 → 73 and `EXPECTED_LEAF_COUNT` 78 → 79, with the 018 S4 changelog note appended to each doc comment, per the Story's `## Change` list.
- asserts: `update ai-provider --id --model` calls `execute` with exactly `{id, model}` and emits `ai-provider updated: <id> (<changed>)` on stderr with exit 0; `--value-file -` reads the secret from stdin and passes it through as `value`, and neither the secret nor the string `value-file` appears in captured stdout/stderr; `--name`/`--provider` are rejected as unknown options (immutable fields unreachable); `--context-window` reaches the use case as a `number`; help text contains `Usage` and `Example`; `runUpdateAiProvider` maps a thrown `NoUpdateFieldsError` to `{exitCode: 1, stdout: []}` with an `error: `-prefixed stderr line; the leaf-file and leaf-count architecture counters now require the new `update/ai-provider.ts` leaf to exist and be wired.

**RED proof.**

- command: `node --test src/apps/cli/commands/update.test.ts src/apps/cli/ai-provider.test.ts src/apps/cli/architecture.test.ts src/apps/cli/update-resource.test.ts`
- exit: 1 — failures:
  - `src/apps/cli/ai-provider.test.ts`: `SyntaxError: The requested module './ai-provider.ts' does not provide an export named 'runUpdateAiProvider'` (the seam does not exist yet — correct reason).
  - `src/apps/cli/commands/update.test.ts`: `error: unknown command 'ai-provider'` — commander rejects the subcommand because `buildUpdateCommand` does not yet register it.
  - `src/apps/cli/architecture.test.ts`: `commands/ contains exactly 73 leaf files` → `AssertionError: 72 !== 73`; `every leaf command has a non-empty description and complete help` → `AssertionError: buildProgram must expose exactly 79 registered leaves` → `78 !== 79` — both wait on the new leaf file.
  - `src/apps/cli/update-resource.test.ts`: unaffected, `BLOCKER S2: runUpdateAiProvider is not exported from resource.ts` still passes (guard test untouched, still green).
- also confirmed: `npx tsc --noEmit` → `src/apps/cli/ai-provider.test.ts(22,10): error TS2724: '"./ai-provider.ts"' has no exported member named 'runUpdateAiProvider'` (single reported error, the missing seam — correct reason).

**Open to Software Engineer.**

- `src/apps/cli/ai-provider.ts` — add `export async function runUpdateAiProvider(args: Record<string, unknown>, updateAiProvider: UpdateAiProvider, io?: {tty?: NodeJS.ReadStream; timeoutMs?: number; stdin?: NodeJS.ReadableStream}): Promise<HandlerResult>` per Story S4's exact spec (camelCase flag reads, `readCredentialValue` gated on `args["valueFile"]`, success line `ai-provider updated: ${id} (${changed.join(", ")})`, standard `catch`/`toResult` wrap).
- New leaf `src/apps/cli/commands/update/ai-provider.ts` exporting `buildUpdateAiProviderCommand(deps, io)`, modelled on `commands/update/credential.ts`, with **no `--name` and no `--provider` option**.
- `src/apps/cli/commands/update.ts` — add `"updateAiProvider"` to `UpdateDeps` and register the new leaf via `addCommand`.
- `src/apps/cli/deps.ts` — add `updateAiProvider: UpdateAiProvider` to `CliDeps` plus the `import type`.
- `src/composition.ts` — construct `updateAiProvider` and add it to the returned deps object.
- `src/apps/cli/resource.ts` — export `parseValueTimeout` (the only permitted edit to that file, per Story S4's Constraints).
- Story S4's `## Change` and `## Constraints` sections are binding for the exact flag names, the `exactOptionalPropertyTypes`-safe spread idiom, and the immutable-field guard (`--name`/`--provider` simply do not exist as options).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — S4 `kanthord update ai-provider` · GREEN

**Cycle.** GREEN for `src/apps/cli/commands/update.test.ts`, `src/apps/cli/ai-provider.test.ts`, `src/apps/cli/architecture.test.ts`.

**Files changed.**

- `src/apps/cli/ai-provider.ts` (edited) — added `import type { UpdateAiProvider }` and `import { parseValueTimeout } from "./resource.ts"`; inserted `runUpdateAiProvider(args, updateAiProvider, io = {})` right after `runRegisterAiProvider`, per Story S4's exact signature: `requireFlag(args, "id")`; camelCase reads of `model`, `baseUrl`, `effort`, `api`, `contextWindow`/`maxTokens` (via `parseInt(..., 10)`), `allowInsecure`; when `args["valueFile"]` is a non-empty string, reads the secret with `readCredentialValue({valuefile, tty: io.tty, stdin: io.stdin, timeoutMs})` where `timeoutMs = parseValueTimeout(args["value-timeout"]) ?? io.timeoutMs ?? 180_000`, mapping a thrown `Error` to `{exitCode: 1, stdout: [], stderr: ["error: ..."]}`; calls `updateAiProvider.execute({...})` spreading only defined keys; success returns `{exitCode: 0, stdout: [id], stderr: ["ai-provider updated: ${id} (${changed.join(", ")})"]}`; wrapped in the file's standard `catch (err) { toResult(err) }`.
- `src/apps/cli/resource.ts` (edited) — exported `parseValueTimeout` (was file-private) so `ai-provider.ts` can import it instead of duplicating it; the only edit made to this file.
- `src/apps/cli/commands/update/ai-provider.ts` (new) — `buildUpdateAiProviderCommand(deps, io)`, modelled on `commands/update/credential.ts`: `--id` required, plus `--model`, `--base-url`, `--effort`, `--api`, `--context-window`, `--max-tokens`, `--allow-insecure`, `--value-file`, `--value-timeout` — no `--name`/`--provider` option, so those flags fail as unknown options; `configureHelp` usage string, `addHelpText("after", …Example…)`; action builds the same stdin `reader` as `update/credential.ts` and calls `emitResult(await runUpdateAiProvider({...opts, "value-timeout": opts.valueTimeout}, deps.updateAiProvider, reader), io)`.
- `src/apps/cli/commands/update.ts` (edited) — imported `buildUpdateAiProviderCommand`, added `"updateAiProvider"` to `UpdateDeps`, registered `command.addCommand(buildUpdateAiProviderCommand(deps, io))` after the existing four.
- `src/apps/cli/deps.ts` (edited) — added `import type { UpdateAiProvider }` beside the other ai-provider imports and `updateAiProvider: UpdateAiProvider;` to `CliDeps` right after `registerAiProvider`.
- `src/composition.ts` (edited) — imported `UpdateAiProvider`, constructed `const updateAiProvider = new UpdateAiProvider(aiProviderRegistry, unitOfWork, modelCatalog);` right after `registerAiProvider`, added `updateAiProvider,` to the returned deps object beside `registerAiProvider`.

**Seam (GREEN).** `runUpdateAiProvider` lives in `ai-provider.ts` (never `resource.ts`, keeping the guard test in `update-resource.test.ts` green), the new leaf registers `ai-provider` under `update` with the immutable `--name`/`--provider` fields simply absent as options, and `deps.updateAiProvider`/`composition.ts` wire the real `UpdateAiProvider` use case through so `commands/update.test.ts`'s five new cases and `ai-provider.test.ts`'s `NoUpdateFieldsError` runner case exercise this exact path; the architecture test's leaf-file/leaf-count bump (already applied by the test-engineer) is satisfied by the new leaf file + its registration.

**Refactor.** None named beyond the seam itself (Story S4 has no separate refactor step); reused `readCredentialValue`, `toResult`, `requireFlag`, and exported the existing `parseValueTimeout` rather than duplicating it.

**Build check.**

- typecheck: exit 0 (`npx tsc --noEmit`, no output).
- ran the app once: `node src/main.ts update ai-provider --help` prints `Usage: kanthord update ai-provider`, the full option list (no `--name`/`--provider`), and the `Example:` block.

**Assumptions.**

- VERIFIED: `UpdateAiProvider`'s constructor signature (`src/app/ai-provider/update-ai-provider.ts:57`) is `(registry: AiProviderRegistry, uow: UnitOfWork, catalog?: ModelCatalog)`, matching the `composition.ts` construction call using the existing `aiProviderRegistry`, `unitOfWork`, `modelCatalog` already in scope beside `registerAiProvider`.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — S4 confirm GREEN · full Gate GREEN · Proof blocked (planning defect)

**Cycle.** Confirmed GREEN for Story S4, then ran the full EPIC Verification Gate — `Gates:` is green, `Proof:` is red for a reason outside `src/`.

**Confirm GREEN (S4) — bug found and fixed, in my own test only.**

- command: `node --test src/apps/cli/commands/update.test.ts src/apps/cli/ai-provider.test.ts src/apps/cli/architecture.test.ts src/apps/cli/update-resource.test.ts`
- First run: 59/60 passed. `updates an ai-provider's model and emits the changed field names` failed: expected `cap.out` (stdout) to be `[]`, got `["aip-1\n"]`.
- Root cause: my own RED-turn assertion was wrong, not the software-engineer's code. Story S4's `## Change` is explicit and binding: `Success → { exitCode: 0, stdout: [id], stderr: [...] }` — and the sibling handler `runUpdateCredential` (`src/apps/cli/resource.ts:321`) puts nothing in stdout on success, which is a different (and irrelevant) convention I mistakenly copied. `commands/update/ai-provider.ts` correctly wires `emitResult`, which prints every `stdout` line, matching the binding spec.
- Fix: `src/apps/cli/commands/update.test.ts` — changed `assert.deepEqual(cap.out, [])` to `assert.deepEqual(cap.out, ["aip-1\n"])` for that one case. No other assertion touched.
- Re-run: **pass 60 / fail 0**.

**Second bug found and fixed — a stale cross-epic test collision, also test-only.**

- `npm run verify` then failed at `src/composition.test.ts:96` — `buildDeps returns a RouterDeps bundle with all registered capabilities` asserted `!("updateAiProvider" in deps)`, a regression pin from EPIC 008.3 ("project-scoped ai_provider type removed"). Story S4's binding change adds a _different_, unrelated `updateAiProvider` key (the global AI-provider-registry use case) to the same `deps` object returned by `buildDeps` (confirmed: `composition.ts:1219` sets `updateAiProvider,` on the object `composition.test.ts` inspects).
- This is a name collision between two unrelated concepts across epics, not a design choice made in this epic — Story S4 does not offer an alternate key name, so the old assertion is now factually obsolete.
- Fix: `src/composition.test.ts` — flipped the assertion to `assert.ok("updateAiProvider" in deps, "deps.updateAiProvider present")`, with an updated comment explaining both epochs. No other line touched.
- Re-run: `node --test src/composition.test.ts` → pass 11 / fail 0.

**Gate — full run.**

- command: `npm run verify` → exit 0. Tail: `tests 2697 / pass 2697 / fail 0`, `verify:handoff` → `VERIFY: PASS`, `typecheck` clean, `lint` clean, db status printed with `schema: 29`.

**Proof — red, planning defect in the script's own phase ordering (not S1–S4).**

- command: `scripts/e2e/update-ai-provider-proof.sh` → exit 1, output ends:
  ```
  A ok: a custom provider is registered, assigned, default, and calls out with model-old
  ai-provider updated: 01KYP9A5S09CCQG2PT68EWVC6E (model)
  B ok: the model changed on the existing row; id, name, default and assignment survived
  C ok: the very next call used model-new with no restart and no re-assignment
  D ok: base URL and secret rotated together; the new key never reached an output stream
  logout: 01KYP9A5S09CCQG2PT68EWVC6E (custom-018/prov-018) — local invalidation only, no remote token revoke
  default cleared — no default provider remains
  E ok: no-op, immutable fields, bad values and a logged_out row are all refused with zero writes
  FAILED: one provider in the project chain — expected '1', got '0'
  ```
- Root cause traced, not guessed: Phase E (`update-ai-provider-proof.sh:193`) deliberately logs out the sole provider (`K logout ai-provider --id "$PROV" --confirm-no-default`) to exercise the "logged_out is refused" refusal case, and never reactivates it before Phase F. Phase F (`:201-204`) then reads `list ai-provider --project "$PROJECT" --json`, which runs `ResolveProjectChain.execute` (`src/app/ai-provider/resolve-project-chain.ts`) → `resolveProviderChain` (`src/domain/resolve-provider-chain.ts:20-25`, EPIC 008.2, unchanged by this epic): assigned providers are filtered to `state === "active"` only, by design, before the chain is returned. With the provider `logged_out`, an empty chain is the **correct**, pre-existing behavior — not a gap in S1–S4.
- Story S5's own text is explicit for this exact situation: _"If any other assertion cannot be met, that is a defect in S1–S4 or a planning defect. Raise it as an `OPEN:` blocker; never weaken the proof."_ The script itself is lane-forbidden for every role to edit (only permitted to run) per the dispatch instructions, so I made no attempt to reorder or patch it.

**OPEN: Story S5's Phase E/F ordering is a planning defect — the script logs out the sole provider before the Phase F project-chain read that requires it to still resolve.**
The fix belongs to whoever may edit `scripts/e2e/update-ai-provider-proof.sh` (a human/planning decision, since Story S5 explicitly restricts permitted edits and this reordering is not one of the three named exceptions). Two shapes a fix could take, for the human to choose — described as outcomes only, not implementation: either Phase F's project-chain read happens before Phase E's logout (reordering the phases so `E` becomes last), or Phase E's logged-out-refusal test uses a state that does not need reverting before `F` runs. I am not prescribing which, since Story S5 forbids me from editing the script and the choice is the human's per its own text.

ATTEMPT-FAILED: S5 — Proof still red after full Gate GREEN: `FAILED: one provider in the project chain — expected '1', got '0'`, traced to a planning-defect in the script's own phase ordering (Phase E logs out the sole provider before Phase F's project-chain read), not a defect in S1–S4.

END: TEST-ENGINEER

## TEST-ENGINEER — implementation ready for review

**EPIC verification gate.** Both parts of the EPIC 018 Verification Gate re-ran clean after the planner's Phase E/G reorder fix (`logged_out` refusal moved to its own Phase G, after Phase F, since Phase F's project-chain read lists ACTIVE providers only). All Stories S1–S5 confirmed GREEN in prior turns; this turn re-verifies the full gate end to end.

**Gates.**

- `npm run verify` (typecheck + test + verify:handoff + lint + db status) → exit 0.
  - `node --test`: `tests 2697 / suites 197 / pass 2697 / fail 0`
  - `verify:handoff`: `VERIFY: PASS`
  - `typecheck`: clean, no output
  - `lint`: clean, no output
  - db status printed: `schema: 29` (fresh/empty local db, as expected for a hermetic run)

**Proof.** `scripts/e2e/update-ai-provider-proof.sh` → exit 0. Verbatim tail:

```
project created: 01KYP9RYDT8HBRG9WZQ0MQ155H
ai-provider registered: 01KYP9RZ1BVGKEGHGECTYY1Y66
default ai-provider set: 01KYP9RZ1BVGKEGHGECTYY1Y66
A ok: a custom provider is registered, assigned, default, and calls out with model-old
ai-provider updated: 01KYP9RZ1BVGKEGHGECTYY1Y66 (model)
B ok: the model changed on the existing row; id, name, default and assignment survived
C ok: the very next call used model-new with no restart and no re-assignment
D ok: base URL and secret rotated together; the new key never reached an output stream
E ok: no-op, immutable fields and bad values are all refused with zero writes
F ok: the project chain shows the updated provider and no secret
logout: 01KYP9RZ1BVGKEGHGECTYY1Y66 (custom-018/prov-018) — local invalidation only, no remote token revoke
default cleared — no default provider remains
G ok: an update against a logged_out provider is refused with zero writes
018 ok: an AI provider is edited in place — model, base URL and key — keeping its id, name, default and assignments, with the next call using the new config
```

Phase ordering now matches the fixed EPIC/Story text (A, B, C, D, E, F, G, then `018 ok:`) — the prior planning defect (Phase E's logout stranding Phase F's active-only chain read) is resolved by moving the `logged_out` refusal to Phase G, after F.

**Tasks closed.** 5 Stories (S1 extract config validator, S2 registry update port+adapter, S3 UpdateAiProvider use case, S4 CLI update ai-provider command, S5 the proof) — all Tasks across all Stories confirmed GREEN in this discussion file, no Story outstanding.

```
IMPLEMENTATION_READY_FOR_REVIEW:
- gates: PASS
- proof: PASS (scripts/e2e/update-ai-provider-proof.sh) — "018 ok: an AI provider is edited in place — model, base URL and key — keeping its id, name, default and assignments, with the next call using the new config"
- stories: 5/5 complete
- date: 2026-07-29
- state: local-uncommitted
```

END: TEST-ENGINEER

AUTO_REVIEW: FAIL — routing 3 action:YES finding(s) to the TDD loop; 3 action:NO finding(s) recorded for the human.
BLOCKER: B1 missing "event count unchanged" test — the EPIC gate line "No new event type and no migration … A test asserts the global event count is unchanged by an update" has no covering test. Add it to src/app/ai-provider/update-ai-provider.test.ts (or a real-SQLite COUNT(*) FROM events before/after a successful update).
BLOCKER: B2 drift test asserts the validator, not the two use cases — the EPIC requires a table over the nine rules executed against BOTH RegisterAiProvider.execute and UpdateAiProvider.execute, asserting the same typed error per row. config-validation.test.ts currently drives the validator function directly, which is a weaker proxy.
BLOCKER: S1 registry.update breaks its own port contract on an empty patch — src/storage/sqlite/ai-provider-registry.ts returns this.get(id)! before any existence check, so an unknown id plus an empty patch returns undefined typed as GlobalAiProvider, contradicting the port doc "Throws UnknownReferenceError when no row has that id". Resolve the row first, throw when missing, then return it when the patch is empty. Add the covering test.
INFO: S2 action:NO — the empty-patch test proves the return value, not "no UPDATE"; a statement counter is not cheaply available from node:sqlite.
INFO: S3 action:NO — EPIC vs Story conflict on ImmutableFieldError; the shipped design rejects --name/--provider at commander level instead. The planner reconciles the EPIC text.
INFO: S4 action:NO — src/composition.test.ts flipped a 008.3 guard assertion deliberately; the load-bearing guard at src/apps/cli/update-resource.test.ts:162 is untouched and green.

## TEST-ENGINEER — review blockers B1/B2/S1 · regression tests

**Cycle.** Repair-path turn for the reviewer-engineer's `AUTO_REVIEW: FAIL` — three `action:YES` findings (B1, B2, S1). Blockers B1 and B2 add missing coverage (GREEN once written, since they exercise already-shipped behavior); blocker S1 needs a production fix, so its test is RED after this turn, per the human's routing instructions.

**Tests written.**

- file: `src/app/ai-provider/update-ai-provider.test.ts` (edited — added imports for real `SqliteAiProviderRegistry`/`SqliteUnitOfWork`/migrations, and one new test) — method added: `UpdateAiProvider: a successful update leaves the global events row count unchanged`.
  - asserts (BLOCKER B1): drives real SQLite end to end (`SqliteAiProviderRegistry` + `SqliteUnitOfWork`, no fakes) because `UpdateAiProvider` never touches an `EventFeed` at all — there is no fake seam to assert "zero calls" against. Reads `SELECT COUNT(*) FROM events` before and after a successful `execute({id, model})`, asserting the count is unchanged — proves the EPIC gate line "no new event type … the global event count is unchanged by an update".

- file: `src/app/ai-provider/config-validation-drift.test.ts` (new) — suite: module path — a 9-row table, each row driving BOTH `RegisterAiProvider.execute` and `UpdateAiProvider.execute` (hand-written local `FakeRegistry`/`FakeUnitOfWork`, not imported from other test files) with the SAME bad value, asserting the SAME typed error class.
  - asserts (BLOCKER B2): rules 1 (api flavor), 2 (effort), 5 (baseUrl shape), 6 (contextWindow), 7 (maxTokens), 8 (embedded userinfo) and 9 (insecure endpoint) throw the same typed error from both use cases for the identical bad input. Rules 3 (missing `customProviderId`) and 4 (missing `baseUrl`) are asserted against `RegisterAiProvider` only, with an explicit `register-only by design` companion test recording why: `UpdateAiProviderInput` has no `customProviderId` field, and Story S3 always calls the validator with `{customProviderId: false, baseUrl: false}` on the update path — those two rules structurally cannot fire on an update patch. The existing direct `config-validation.test.ts` validator tests are kept unchanged — they still add value (they pin the pure function's contract independent of either caller).

- file: `src/storage/sqlite/ai-provider-registry.test.ts` (edited — one test added, right after the existing "update on an unknown id" test) — method added: `SqliteAiProviderRegistry: update on an unknown id with an EMPTY patch still throws UnknownReferenceError`.
  - asserts (BLOCKER S1): `registry.update("nonexistent-id", {})` must throw `UnknownReferenceError`, matching the port doc's "Throws UnknownReferenceError when no row has that id" with no carve-out for an empty patch.

**RED proof (S1 — production fix required).**

- command: `node --test src/storage/sqlite/ai-provider-registry.test.ts`
- exit: 1 — failing line:
  ```
  ✖ SqliteAiProviderRegistry: update on an unknown id with an EMPTY patch still throws UnknownReferenceError (12.74725ms)
    AssertionError [ERR_ASSERTION]: Missing expected exception (UnknownReferenceError).
        at TestContext.<anonymous> (file:///Users/tuannguyen/Projects/kanthorlabs/kanthord/src/storage/sqlite/ai-provider-registry.test.ts:919:10)
  ```
- Root cause confirmed by reading `src/storage/sqlite/ai-provider-registry.ts:135-137`: `update()` returns `this.get(id)!` (non-null-asserted `undefined`) before any existence check whenever `patch` has zero keys, so an unknown id with `{}` silently returns `undefined` typed as `GlobalAiProvider` instead of throwing.

**GREEN proof (B1, B2 — new coverage of existing behavior).**

- command: `node --test src/app/ai-provider/config-validation-drift.test.ts src/app/ai-provider/update-ai-provider.test.ts`
- result: `pass 39 / fail 0` (18 drift-table cases + the existing 20 `UpdateAiProvider` cases + the new events-count case, all green).

**Full-suite sanity check (no collateral regression).**

- command: `node --test`
- result: `tests 2717 / pass 2716 / fail 1` — the single failure is the intended S1 RED test above; every other suite, including all three edited files' other tests, is unaffected.
- command: `npx tsc --noEmit` → exit 0, no output.

**Open to Software Engineer.**

- `src/storage/sqlite/ai-provider-registry.ts` — `update(id, patch)` (`:97-147`): resolve the current row via `this.get(id)` (or equivalent) FIRST; when it is `undefined`, throw `UnknownReferenceError("ai_provider", id)` — the same call the "non-empty patch, unknown id" branch already makes at `:144` — before checking whether `patch` has any keys. Only after that existence check should an empty patch short-circuit and return the (now known-to-exist) current row. This is the only change needed; the non-empty-patch path's existing `result.changes === 0` check may stay as a defense-in-depth belt-and-suspenders, or be replaced by the upfront read — the software-engineer's call.

ATTEMPT-FAILED: S1 — still red after this turn's test-only changes (by design, a production fix is required): `Missing expected exception (UnknownReferenceError)` at `src/storage/sqlite/ai-provider-registry.test.ts:919`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 018-update-ai-provider · fix S1 registry.update empty-patch existence check

**Cycle.** GREEN for `src/storage/sqlite/ai-provider-registry.test.ts` — new case "update on an unknown id with an EMPTY patch still throws UnknownReferenceError".
**Files changed.**

- `src/storage/sqlite/ai-provider-registry.ts` (edited) — `update(id, patch)`: resolve the row via `this.get(id)` before the empty-patch short-circuit; throw `UnknownReferenceError("ai_provider", id)` when it is `undefined`; return the resolved row unchanged when `patch` has zero keys. The existing non-empty-patch `result.changes === 0` guard is left in place as defense-in-depth (untouched).
  **Seam (GREEN).** An unknown id now throws `UnknownReferenceError` regardless of whether the patch is empty, matching the port doc comment in `src/storage/port.ts` ("Throws UnknownReferenceError when no row has that id"); a known id with an empty patch still performs zero `UPDATE`s and returns the row unchanged.
  **Refactor.** None named for this blocker; no further cleanup applied beyond the minimal existence-check reordering.
  **Build check.**
- typecheck: exit 0 (`npm run typecheck`), no output.
  **Assumptions.**
- VERIFIED: the fix location and shape match the TE's own "Open to Software Engineer" note verbatim (resolve row first, throw when missing, then short-circuit empty patch on the now-known-to-exist row).

**Review blocker addressed.** BLOCKER S1 registry.update breaks its own port contract on an empty patch — src/storage/sqlite/ai-provider-registry.ts returns this.get(id)! before any existence check, so an unknown id plus an empty patch returns undefined typed as GlobalAiProvider, contradicting the port doc "Throws UnknownReferenceError when no row has that id". Resolve the row first, throw when missing, then return it when the patch is empty. Add the covering test.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — implementation ready for review (post S1 fix)

**Cycle.** Confirm-GREEN for the S1 registry empty-patch fix, re-confirm B1/B2 stay green, then re-run the full EPIC Verification Gate — both parts.

**Confirm GREEN — S1 regression.**

- command: `node --test src/storage/sqlite/ai-provider-registry.test.ts`
- result: `tests 30 / suites 0 / pass 30 / fail 0` — including `update on an unknown id with an EMPTY patch still throws UnknownReferenceError` (previously RED, now passes after the software-engineer's fix to `src/storage/sqlite/ai-provider-registry.ts`).

**Confirm GREEN — B1 (event count) and B2 (two-use-case drift table).**

- command: `node --test src/app/ai-provider/update-ai-provider.test.ts src/app/ai-provider/config-validation-drift.test.ts src/app/ai-provider/config-validation.test.ts src/app/ai-provider/register-ai-provider.test.ts`
- result: `tests 88 / suites 0 / pass 88 / fail 0` — including `a successful update leaves the global events row count unchanged` (B1) and the 18-row `config-validation-drift.test.ts` table driving both use cases (B2).

**EPIC verification gate — full re-run.**

Gate — `npm run verify` (typecheck + test + verify:handoff + lint + db status) → exit 0.

- `node --test`: `tests 2717 / suites 197 / pass 2717 / fail 0`
- `verify:handoff`: `VERIFY: PASS`
- `typecheck`: clean, no output
- `lint`: clean, no output
- db status printed: `schema: 29` (fresh/empty local db)

Proof — `scripts/e2e/update-ai-provider-proof.sh` → exit 0. Verbatim tail:

```
project created: 01KYPB1N9JZSMG9Q6M3PEJY09Y
ai-provider registered: 01KYPB1NZXD51C22DWCWEZEHSC
default ai-provider set: 01KYPB1NZXD51C22DWCWEZEHSC
A ok: a custom provider is registered, assigned, default, and calls out with model-old
ai-provider updated: 01KYPB1NZXD51C22DWCWEZEHSC (model)
B ok: the model changed on the existing row; id, name, default and assignment survived
C ok: the very next call used model-new with no restart and no re-assignment
D ok: base URL and secret rotated together; the new key never reached an output stream
E ok: no-op, immutable fields and bad values are all refused with zero writes
F ok: the project chain shows the updated provider and no secret
logout: 01KYPB1NZXD51C22DWCWEZEHSC (custom-018/prov-018) — local invalidation only, no remote token revoke
default cleared — no default provider remains
G ok: an update against a logged_out provider is refused with zero writes
018 ok: an AI provider is edited in place — model, base URL and key — keeping its id, name, default and assignments, with the next call using the new config
```

**Tasks closed.** 5 Stories (S1 extract config validator, S2 registry update port+adapter, S3 UpdateAiProvider use case, S4 CLI update ai-provider command, S5 the proof) — all Tasks across all Stories GREEN, including the three reviewer blockers (B1, B2, S1) resolved this cycle. No Story outstanding.

```
IMPLEMENTATION_READY_FOR_REVIEW:
- gates: PASS
- proof: PASS (scripts/e2e/update-ai-provider-proof.sh) — "018 ok: an AI provider is edited in place — model, base URL and key — keeping its id, name, default and assignments, with the next call using the new config"
- stories: 5/5 complete
- date: 2026-07-29
- state: local-uncommitted
```

END: TEST-ENGINEER

HUMAN_REVIEW: PASS

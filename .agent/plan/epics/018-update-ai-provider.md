# EPIC 018 — `update ai-provider`: change a registered provider in place

> Found by the `/e2e` run `20260729-121823` (report:
> `.agent/e2e/20260729-121823/report.md`, finding S1). Mid-run the provider
> returned `403 AllocationQuota.FreeTierOnly` and the model had to change. There
> is no `update ai-provider`, so the operator had to `register` a second provider
> under a NEW name, then `unassign` the old one, `assign` the new one and
> `set-default` it — four commands, a duplicated account row, and a project chain
> edited by hand. `update credential|repository|notification|filesystem` all
> exist; the AI provider is the only resource without an update verb.
>
> Re-registering under the SAME name cannot serve this: for an `active` row the
> adapter throws `DuplicateNameError`
> (`src/storage/sqlite/ai-provider-registry.ts:60-62`), and for a `logged_out`
> row it deliberately keeps the old config and rotates only the secret
> (`:63-71`), which `RegisterAiProvider` reports as
> `config retained (…), flags ignored` (`register-ai-provider.ts:222-231`).
> Reactivation is not an edit, and must not become one.

## Goal

The engineer changes a registered AI provider's configuration — model, base URL,
effort, API flavour, context window, max tokens — and rotates its key, in one
command, on the row that already exists, keeping its id, its name, its default
pointer and every project assignment. The next task the daemon runs uses the new
configuration with no restart and no re-assignment. Changing the model of a
provider that has just exhausted its quota becomes one command instead of four.

## Verification Gate

Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).

Hermetic coverage required beyond the Proof:

- **One validator, two callers.** The config rules currently inlined in
  `RegisterAiProvider.execute` (`src/app/ai-provider/register-ai-provider.ts`:
  api flavour :85-90, effort :93-98, custom-id/baseUrl presence :101-109, baseUrl
  shape :112-122, numeric flags :125-139, embedded userinfo + insecure endpoint
  :142-147) move into one pure module,
  `src/app/ai-provider/config-validation.ts`, and BOTH `RegisterAiProvider` and
  `UpdateAiProvider` call it. **Binding: no second copy of any of these rules.**
  A test asserts the two use cases reject the same bad value with the same typed
  error, table-driven over every rule, so the pair cannot drift.
  `register-ai-provider.test.ts` must keep passing unchanged — the extraction is
  a refactor, not a behaviour change.
- **The mutable set is closed and asserted:** `model`, `baseUrl`, `effort`,
  `api`, `contextWindow`, `maxTokens`, and the secret. **Immutable through this
  command:** `id`, `name` (`rename` owns it), `provider` (the account identity —
  changing it would silently re-point the credential at a different vendor),
  `state`, `credentialVersion` (owned by the CAS). **Amended 2026-07-29** (was:
  "a typed `ImmutableFieldError` per field, mirroring `UpdateCredential`"): the
  immutable fields are unreachable rather than rejected — the CLI leaf defines no
  `--name` / `--provider` option, so commander refuses them, and
  `UpdateAiProviderInput` has no such key, so no call site can pass one. A
  runtime guard would have to test a state the types make unconstructible.
  Each immutable field instead has a test asserting the command exits non-zero,
  plus proof phase E asserting the database is byte-identical afterwards.
- **Zero flags is a usage error with zero writes**, asserted by a full
  table-row-count-plus-column snapshot before and after, not by re-reading the
  provider alone.
- **Custom and builtin are different shapes and are enforced as such.** A row
  with `api === null` is builtin: `--api`, `--base-url`, `--context-window` and
  `--max-tokens` are refused on it with a typed error naming the field and the
  kind, because those columns are null by construction for builtin providers
  (`src/storage/port.ts:296-301`); `--model` is revalidated against the pinned
  catalog exactly as registration does, including the effort-per-model check. A
  row with `api !== null` is custom: it takes the custom validation path and
  **never** consults the catalog. Both directions tested.
- **The secret rotates through the existing CAS, never a bare UPDATE.**
  `--value-file` reads the current `credentialVersion` and calls
  `updateCredentialCAS` (`src/storage/port.ts:381-386`) inside the same
  transaction. `{applied:false}` becomes a typed `StaleCredentialError`; the
  test drives it with a store double that bumps the version between the read and
  the call. An empty value is `EmptyValueError`, as in registration.
- **The secret never reaches an output stream.** The success line names the id
  and the CHANGED FIELD NAMES only. A test asserts the new value appears in
  neither stdout nor stderr, and that `get`/`list ai-provider` still redact
  `value` through `toAiProviderView`.
- **A `logged_out` provider is refused**, with a typed error naming the state and
  pointing at `register ai-provider` to reactivate. Rationale: its `value` is
  NULL so the CAS cannot apply, and letting config drift on a dead account is
  exactly the "reactivation keeps the old config" trap that motivated this epic.
- **Atomic.** Every write is inside one `UnitOfWork.transaction`. A validation
  failure on the LAST field leaves the first fields unwritten — tested with a
  patch whose `--max-tokens` is invalid and whose `--model` is valid.
- **Identity and wiring survive the update.** After a successful update the id,
  name, default pointer, `credentialVersion` (when the secret is untouched) and
  every `project_ai_providers` row are unchanged — asserted directly, because
  the whole point is that the four-command workaround is no longer needed.
- **No new event type and no migration.** `update credential` appends no event
  (`src/app/resource/update-credential.ts` — no append call); this command
  matches it. A test asserts the global event count is unchanged by an update.

Proof: `scripts/e2e/update-ai-provider-proof.sh` — deterministic, no model, no
outbound network (a local `127.0.0.1` mock is the endpoint), no daemon left
running. Run from the repo root:

```bash
scripts/e2e/update-ai-provider-proof.sh
```

It must print `018 ok: …`. Phases:

- **A** — a custom provider is registered against mock **A** with model
  `model-old`, assigned to a project and made default; `test ai-provider` makes
  the mock record `model-old`. This phase uses only commands that exist today.
- **B** — `update ai-provider --id <id> --model model-new` succeeds; the id, the
  name, the default pointer and the project assignment are all unchanged; there
  is still exactly ONE row in `ai_providers`.
- **C** — `test ai-provider` now makes the mock record `model-new`, in the same
  process-free way, proving the resolution path reads the new config with no
  restart and no re-assignment. **This is the finding S1 fix, end to end.**
- **D** — `update ai-provider --id <id> --base-url <mock B> --value-file <new
key>` re-points the provider and rotates the secret: mock **B** records the
  next call and receives the NEW bearer token, `credentialVersion` is bumped by
  exactly 1, and the new key appears in no output stream.
- **E** — refusals, each leaving the database byte-identical: no flags; an
  unknown/immutable field (`--name`, `--provider`); `--context-window 0`;
  `--base-url` with embedded userinfo; and a plain-`http://` non-loopback base
  URL without `--allow-insecure`.
- **F** — a project-scoped read proves nothing leaked: `list ai-provider
--project --json` shows one provider, with the new model and no `value` key.
- **G** — an update against a `logged_out` provider is refused, naming the
  state, with the database byte-identical. It is **last** because it leaves the
  provider inactive, and the phase-F chain read lists active providers only.

Against the CURRENT tree the proof fails in phase B at the first
`update ai-provider` call — `update` has no `ai-provider` subcommand
(`src/apps/cli/commands/update/` holds only credential, filesystem,
notification, repository). Phase A passes today, so the first failure is the
missing capability and not a broken fixture.

## Stories

- **S1 — extract the config validator.** New pure
  `src/app/ai-provider/config-validation.ts` holding the register-path rules
  listed above; `RegisterAiProvider` is rewired to call it with its existing
  tests unchanged. No new behaviour. It sits in `app/`, not `domain/`, because
  the rules throw the typed errors in `src/app/ai-provider/errors.ts` and
  `domain/` may not import from `app/`.
- **S2 — the port + adapter can edit a row.** Add
  `update(id, patch): GlobalAiProvider` to `AiProviderRegistry`
  (`src/storage/port.ts:309`), covering the config columns only, and implement it
  in `SqliteAiProviderRegistry` beside `register`. The secret keeps its existing
  `updateCredentialCAS` path; `update` never writes `value`, `state`, `name` or
  `provider`.
- **S3 — the `UpdateAiProvider` use case.** `src/app/ai-provider/update-ai-provider.ts`,
  one class, one `execute()`: resolve the row, refuse `logged_out`, branch
  custom vs builtin, validate through S1, apply config + optional CAS secret
  rotation in one transaction, return the changed field names.
- **S4 — the CLI command.** `src/apps/cli/commands/update/ai-provider.ts`
  following `update/credential.ts`, including `--value-file <path|->` and
  `--value-timeout`, wired in the composition root and in the `update` command
  table. Output names the id and the changed fields, never the secret.
- **S5 — the proof.** `scripts/e2e/update-ai-provider-proof.sh`. It carries its
  own recording mock (written into its temp dir), which mirrors
  `scripts/e2e/mock-openai-completions.mjs` and additionally appends each
  request's `model` and `authorization` header to `MOCK_RECORD`. **Binding: the
  shared 008.1 mock is NOT modified** — phase A must run on today's tree, so the
  proof may not depend on a fixture this epic changes.

## Non-goals

- Renaming a provider (`rename` already owns it) and changing its `provider`
  account identity.
- Any `--reconcile` / force path, and any interactive editor.
- Re-ranking project assignments — `assign` / `unassign` own that.
- Classifying provider quota/auth failures (`403`/`429`) as provider faults
  rather than task failures. That is the same e2e run's finding B2 and is a
  separate epic; this one only makes the recovery a single command.
- Emitting an event for a provider config change.

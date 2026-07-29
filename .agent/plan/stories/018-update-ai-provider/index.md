# EPIC 018 — `update ai-provider` — stories

Epic: `.agent/plan/epics/018-update-ai-provider.md`
Prereq: EPIC 017 (sequence order).

A registered AI provider's config — model, base URL, effort, API flavour,
context window, max tokens — and its secret change in place on the existing row,
keeping the id, name, default pointer and every project assignment, and the next
call uses the new config with no restart.

## Dispatch order

1. `01-extract-config-validator.md` and `02-registry-update-port-and-adapter.md`
   are independent — either order, or in parallel.
2. `03-update-ai-provider-use-case.md` needs both.
3. `04-cli-update-ai-provider-command.md` needs S3.
4. `05-program-proof.md` last; it is the epic's Proof and needs S1–S4.

## Stories

- S1 — extract the register-path config rules into one pure module → `01-extract-config-validator.md`
- S2 — `AiProviderRegistry.update` on the port + SQLite adapter → `02-registry-update-port-and-adapter.md`
- S3 — the `UpdateAiProvider` use case, with three new typed errors → `03-update-ai-provider-use-case.md`
- S4 — the `kanthord update ai-provider` CLI leaf and its wiring → `04-cli-update-ai-provider-command.md`
- S5 — make `scripts/e2e/update-ai-provider-proof.sh` pass → `05-program-proof.md`

## Facts (needed for implementation)

- **Nothing named `UpdateAiProvider` exists today.** `update ai-provider` was
  deliberately deleted by commit `0d52780` (008.3 Story C) when the
  _project-scoped_ ai_provider resource was retired. This epic adds it back for
  the _global_ provider, which is a different aggregate.
- **The guard test that constrains where the runner lives:**
  `src/apps/cli/update-resource.test.ts:162` asserts `resource.ts` exports no
  `runUpdateAiProvider`. Put the runner in `src/apps/cli/ai-provider.ts`, where
  every other global-provider runner already lives, and that test stays green
  untouched.
- **Two hard-coded counters break when a CLI leaf is added:**
  `src/apps/cli/architecture.test.ts:28` (`EXPECTED_LEAF_FILE_COUNT = 72`) and
  `:43` (`EXPECTED_LEAF_COUNT = 78`). Both must be bumped by one. The doc comment
  at `:27` is a running changelog — append the 018 note.
- **An unmapped error crashes the CLI.** `src/apps/cli/error-map.ts:159` re-throws
  anything its `instanceof` chain (`:98-156`) does not match, so it escapes the
  commander action instead of becoming exit code 1. Every new typed error must be
  added to that chain.
- **Reactivation is not an edit.** `SqliteAiProviderRegistry.register`
  (`:59-72`) throws `DuplicateNameError` for an active name and, for a
  `logged_out` row, rotates only the secret while keeping the stored config;
  `RegisterAiProvider:225-232` reports that as
  `config retained (…), flags ignored`. This is why a new command is needed and
  must not be "fixed" by loosening `register`.
- **The config-read path a proof must go through:** `TestAiProvider`
  (`src/app/ai-provider/test-ai-provider.ts:11-20`) → `ProviderProbe`
  (`src/agent-runner/port.ts:7-9`) → `PiProviderProbe`
  (`src/agent-runner/pi-provider-probe.ts:13-59`), which calls `registry.get(id)`
  then `toResolvedProvider(p)` and `sessions.for(resolved, undefined, p.credentialVersion)`.
  `PiProviderSessionFactory.for` (`src/agent-runner/pi-session.ts:159`) builds a
  fresh session per call from the passed provider — there is **no** session
  cache, so an updated row is picked up on the next call with no restart.
- **`AiProviderView`** (`src/app/ai-provider/ai-provider-view.ts:5-14`) is
  type-only and already omits `value`, `api`, `contextWindow` and `maxTokens`;
  redaction is by omission in each use case's object literal. Do not widen it.
- **`updateCredentialCAS`** (`src/storage/port.ts:376-385`, adapter `:270-284`)
  is the only sanctioned way to write `value`; its SQL requires
  `state = 'active'` and a matching `credentialVersion`, and bumps the version
  by one.
- **Test conventions:** `node:test` + `node:assert/strict`, flat `test(...)`,
  hand-written fakes per file under a `// fakes` banner;
  `FakeUnitOfWork` at `src/app/ai-provider/register-ai-provider.test.ts:142-146`;
  `FakeModelCatalog` from `src/model-catalog/fake.ts`; real sqlite only via the
  `mkdtemp` + `openDatabase` + `migrate` pattern at
  `src/app/ai-provider/register-global-provider.test.ts:92-110`. CLI tests use
  the `capture()` helper (`src/apps/cli/commands/update.test.ts:7-24`) and
  `.parseAsync([...], { from: "user" })`; `emitResult`
  (`src/apps/cli/commands/action.ts:22-26`) appends `"\n"` to every line, so
  assertions include the newline.
- **Every fake implementing `AiProviderRegistry` must gain `update`** or the
  build fails: `grep -rln "implements AiProviderRegistry" src`.

# Story S2 — `AiProviderRegistry.update` on the port and the SQLite adapter

Epic: `.agent/plan/epics/018-update-ai-provider.md`
Depends on: nothing (may run in parallel with S1)

## Change

- `src/storage/port.ts` — add one method to `AiProviderRegistry` (interface at
  `:309-386`), placed immediately after `register` (`:310-320`) and before
  `list()` (`:321`):

```ts
  /**
   * Update the CONFIG columns of an existing provider in place. Only the keys
   * present in `patch` are written; the row keeps its id, name, provider,
   * value, state and credentialVersion. The secret is rotated separately
   * through `updateCredentialCAS`. Throws UnknownReferenceError when no row
   * has that id.
   */
  update(
    id: string,
    patch: {
      model?: string;
      baseUrl?: string;
      effort?: string;
      api?: "openai-completions" | "openai-responses";
      contextWindow?: number;
      maxTokens?: number;
    },
  ): GlobalAiProvider;
```

- `src/storage/sqlite/ai-provider-registry.ts` — implement `update` immediately
  after `register` (which ends at `:95`):
  - Import `UnknownReferenceError` from `../../domain/errors.ts`, beside the
    existing `DuplicateNameError` import at `:6`.
  - Build the `SET` list from the keys **present** in `patch`, in this fixed
    column order so the generated SQL is deterministic: `model`, `baseUrl`,
    `effort`, `api`, `contextWindow`, `maxTokens`. Bind values positionally.
  - An empty `patch` (no keys) throws `UnknownReferenceError`? **No** — it is a
    caller error the use case has already rejected; the adapter must instead
    return the current row unchanged without issuing any UPDATE. Assert this in
    a test.
  - Run `UPDATE ai_providers SET <cols> WHERE id = ?`. When `result.changes === 0`
    throw `new UnknownReferenceError("ai_provider", id)`.
  - Return `this.get(id)!`.
  - The statement must never mention `name`, `provider`, `value`, `state` or
    `credentialVersion`.

## Constraints

- No migration and no schema change — every target column already exists
  (`register`'s INSERT at `:79-80` lists all of them).
- Surgical: do not touch `register`, `logout`, `updateCredentialCAS` or any
  assignment method.
- Every fake `AiProviderRegistry` in the test suite must gain the new method or
  typecheck fails. The known fakes are in
  `src/app/ai-provider/register-ai-provider.test.ts:28-140`,
  `get-ai-provider.test.ts:14+`, and the other `src/app/ai-provider/*.test.ts`
  files; find them all with
  `grep -rln "implements AiProviderRegistry" src`. In a fake that the story does
  not otherwise exercise, implement it as a minimal in-Map merge — never as a
  `throw`, which would turn an unrelated test red for the wrong reason.

## Verify

- New tests in `src/storage/sqlite/ai-provider-registry.test.ts` (create the
  file if absent, following the real-sqlite pattern in
  `src/app/ai-provider/register-global-provider.test.ts:92-110`:
  `mkdtempSync(join(tmpdir(), "kanthord-018-"))` → `openDatabase` →
  `migrate(db, MIGRATIONS)` → `new SqliteAiProviderRegistry(db)`), asserting:
  - a single-key patch (`{model}`) changes only `model`; `name`, `provider`,
    `value`, `state` and `credentialVersion` are byte-identical to before;
  - a multi-key patch (`{baseUrl, effort, api, contextWindow, maxTokens}`)
    writes all five;
  - an empty patch issues no UPDATE and returns the current row;
  - an unknown id throws `UnknownReferenceError`;
  - the row's `id` is unchanged and `list()` still returns exactly one row.
- `node --test src/storage/sqlite/ai-provider-registry.test.ts` passes.
- `npm run verify` exits 0.
- Proof: enables phases B and D of
  `scripts/e2e/update-ai-provider-proof.sh`.

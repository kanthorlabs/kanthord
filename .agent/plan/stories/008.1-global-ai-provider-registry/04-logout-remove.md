# Story D — Credential lifecycle: logout + remove

Epic: `.agent/plan/epics/008.1-global-ai-provider-registry.md`
Depends on: Story A (registry), Story C (CLI verbs + view + deps wiring).

## Change

### Use cases (`src/app/ai-provider/`)

- **`logout-ai-provider.ts`** — `class LogoutAiProvider { execute({ id,
replacement }: { id: string; replacement?: string }): void }`:
  1. `const p = registry.get(id)`; undefined → `UnknownReferenceError("ai_provider", id)`.
  2. Idempotent: if `p.state === "logged_out"`, return (no-op).
  3. If `id === registry.getDefaultId()`: require `replacement`; missing → throw
     `ReplacementRequiredError("logout", id)` (new class). Else validate
     `replacement` is an existing **active** provider (`get` + `state==='active'`,
     unknown/logged_out → typed error).
  4. In one `unitOfWork.transaction`: `registry.setState(id, "logged_out",
p.credentialVersion + 1)` (invalidates the folded secret by bumping version
     and marking logged_out); if a `replacement` was given, `registry.setDefaultId(replacement)`.
  5. Emit an audit line via the injected `audit: (line: string) => void` sink:
     `audit(\`ai-provider logout id=\${id} provider=\${p.provider} name=\${p.name}\`)`— record id + kind + safe name, **never**`value`.
- **`remove-ai-provider.ts`** — `class RemoveAiProvider { execute({ id,
replacement }): void }`:
  1. `const p = registry.get(id)`; undefined → `UnknownReferenceError`.
  2. `const isDefault = id === registry.getDefaultId()`; `const others =
registry.list().filter(x => x.id !== id)`.
  3. If `isDefault && others.length > 0 && !replacement` → throw
     `ReplacementRequiredError("remove", id)`.
  4. If `replacement` given: validate it is an existing **active** provider
     (≠ `id`); typed error otherwise.
  5. In one `unitOfWork.transaction`:
     - if `isDefault`: if `replacement` → `registry.setDefaultId(replacement)`;
       else if `others.length === 0` → `registry.clearDefault()`.
     - `registry.delete(id)`.
  6. Emit an audit line (as above), including `replacement=` when present.
- **Errors** — new `ReplacementRequiredError` in `src/app/ai-provider/errors.ts`
  (message contains the words `replacement` and `default` so the epic Proof's
  `grep -qiE 'replacement|default'` matches). Add it (and any active-target error)
  to the `instanceof` chain in `src/apps/cli/error-map.ts:42-67`.

### CLI runners + commands

- Add to `src/apps/cli/ai-provider.ts`: `runLogoutAiProvider(args, deps)` and
  `runRemoveAiProvider(args, deps)` — both require `--id`, accept
  `--replacement <id>`; success → `stdout:[id]`, stderr friendly line; on the
  local-only nature of logout, stderr includes
  `"credential removed locally; remote token not revoked"`.
- New verb file `src/apps/cli/commands/logout.ts` + leaf
  `commands/logout/ai-provider.ts` (`.requiredOption("--id <id>")`,
  `.option("--replacement <id>")`). Register the `logout` verb in
  `src/apps/cli/index.ts`.
- New leaf `src/apps/cli/commands/remove/ai-provider.ts` under the **existing**
  `remove` verb (`.requiredOption("--id <id>")`, `.option("--replacement <id>")`,
  `.option("--cascade")` — `--cascade` is accepted but only meaningful in 008.2;
  in 008.1 a provider is never assigned, so it is a no-op here).

### Wiring

- `src/apps/cli/deps.ts`: add `logoutAiProvider: LogoutAiProvider;`,
  `removeAiProvider: RemoveAiProvider;`.
- `src/composition.ts`: construct both with `{ registry: aiProviderRegistry,
unitOfWork, audit }` where `audit` writes to `process.stderr` (or the existing
  logger); add to the returned bundle.

### Test counters

- `src/apps/cli/architecture.test.ts`: set `EXPECTED_LEAF_FILE_COUNT = 58`
  (line 28) and `EXPECTED_LEAF_COUNT = 60` (line 31) — this story adds 2 leaf
  files (`logout/ai-provider.ts`, `remove/ai-provider.ts`).

## Constraints

- Logout/remove are keyed strictly by **record id** — acting on one same-kind
  account never touches siblings.
- The default pointer must never end up referencing a `logged_out` or deleted
  record (enforced by the `--replacement` requirement + transaction).
- Audit lines and all output must never contain `value`.

## Verify

- New `src/app/ai-provider/logout-ai-provider.test.ts` +
  `remove-ai-provider.test.ts` (fake registry + fake unitOfWork + audit spy):
  - logout non-default → `state='logged_out'`, version bumped, record kept,
    default unchanged, audit line emitted with no secret;
  - logout of the current default without `replacement` → `ReplacementRequiredError`;
  - logout default with active `replacement` → default repointed;
  - logout already-logged_out → no-op (idempotent);
  - remove non-default → deleted, default unchanged;
  - remove default with others present and no `replacement` → `ReplacementRequiredError`;
  - remove default with `replacement` → deleted + default repointed (one tx);
  - remove the last provider → deleted + `clearDefault`.
- New `src/apps/cli/ai-provider.test.ts` cases (append): `logout --id`,
  `remove --id --replacement`, and the guard (`remove --id` of the default →
  exit 1 with `error:` containing `replacement`).
- `npm run verify` exits 0 (architecture counts updated).
- Proof (008.1 Proof block): delivers **PASS D-logout** (logout → `logged_out`,
  record retained), **PASS D-guard** (remove default without `--replacement`
  rejected, non-zero exit), **PASS D-remove** (remove default with `--replacement`
  deletes + repairs the default), and the logout/remove **leak gate**.

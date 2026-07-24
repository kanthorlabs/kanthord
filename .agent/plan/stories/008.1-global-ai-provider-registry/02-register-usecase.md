# Story B — Register use case + transactional first-wins default

Epic: `.agent/plan/epics/008.1-global-ai-provider-registry.md`
Depends on: Story A (`AiProviderRegistry` port + adapter).

## Change

- **New use case** — `src/app/ai-provider/register-ai-provider.ts`, class
  `RegisterAiProvider` (convention: `src/app/auth/login-provider.ts`). Constructor
  deps object: `{ registry: AiProviderRegistry, unitOfWork: UnitOfWork,
modelCatalog: ModelCatalog, newId: () => string }`. One method:
  `async execute(input: { name: string; provider: string; model: string; baseUrl?: string; effort?: string; value: string }): Promise<string>`.
  Ordered logic (validate before side effects, per `login-provider.ts:53-66`):
  1. `if (!this.#modelCatalog.isValid(input.provider, input.model)) throw new
UnknownModelError(input.provider, input.model);` (import from
     `../../model-catalog/port.ts`).
  2. `if (input.value.length === 0) throw` an empty-value error (reuse the
     credential-empty error type from `credential-input.ts`, or
     `ResourceValidationError` from `domain/resource.ts`).
  3. Look up `existing = this.#registry.getByName(input.name)`.
     - If `existing` and `existing.state === "active"` → `throw new
DuplicateNameError("ai_provider", "registry", input.name)`.
     - If `existing` and `existing.state === "logged_out"` → **reactivate** in one
       `unitOfWork.transaction`: `registry.updateCredential(existing.id,
input.value, "active", existing.credentialVersion + 1)`; return
       `existing.id`. (Do NOT insert a new record; do NOT change the default.)
  4. Else (new record): in one `unitOfWork.transaction`:
     `const id = this.#newId();` build the `GlobalAiProvider`
     (`state:"active"`, `credentialVersion:1`, `baseUrl: input.baseUrl ?? null`,
     `effort: input.effort ?? null`); `registry.insert(record)`; **if**
     `registry.getDefaultId() === undefined` then `registry.setDefaultId(id)`
     (first-wins). Return `id`.
- **Errors**: reuse `DuplicateNameError` / `UnknownModelError` (already re-exported
  from `src/app/errors.ts`). If a NEW error class is introduced, add it to
  `src/apps/cli/error-map.ts:42-67` `instanceof` chain (Story 03 wires the CLI
  that surfaces it).

## Constraints

- Insert + first-default-set MUST be inside a single `unitOfWork.transaction` so
  the "≥1 provider ⇒ exactly one default" invariant is never observed mid-gap.
- Reactivation keys strictly on `name` (register has no `--id`); it never creates
  a second record for a logged-out name and never mutates the default pointer.
- No CLI here (Story 03). No project/`resources` writes.

## Verify

- New `src/app/ai-provider/register-ai-provider.test.ts` (convention:
  `src/app/auth/login-provider.test.ts` — inline fake ports cast
  `as unknown as <Port>`, `describe`/`test`). A fake `AiProviderRegistry` backed
  by an array + a `defaultId` variable; a fake `UnitOfWork` whose `transaction`
  just calls `fn()`; a fake `ModelCatalog` returning configurable `isValid`.
  Assert:
  - first `execute` inserts and sets the default to the returned id;
  - second `execute` (different name) inserts but leaves the default unchanged;
  - `execute` with a name whose record is `active` → rejects with
    `DuplicateNameError`;
  - `execute` with a name whose record is `logged_out` → returns that record's id,
    the record is `active` again, `credentialVersion` incremented, no new record,
    default pointer unchanged;
  - `isValid === false` → rejects with `UnknownModelError` and inserts nothing;
  - empty `value` → rejects and inserts nothing.
- `npm run verify` exits 0.
- Proof: no standalone `PASS` line — this use case is exercised end-to-end by the
  `register ai-provider` CLI in Story 03 (Proof PASS A/B, D-coexist).

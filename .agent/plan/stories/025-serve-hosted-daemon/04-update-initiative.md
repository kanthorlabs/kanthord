# Story S4 — `UpdateInitiative`

Epic: `.agent/plan/epics/025-serve-hosted-daemon.md` (Decisions 6, 7)

## Change

### 1. `src/app/initiative/update-initiative.ts` (new)

Template: `src/app/ai-provider/update-ai-provider.ts:52-79` — validation before
the transaction, resolve + write inside, `execute` non-async.

```ts
import type { InitiativeRepository, UnitOfWork } from "../../storage/port.ts";
import { NoUpdateFieldsError, UnknownReferenceError } from "../errors.ts";

export interface UpdateInitiativeInput {
  readonly id: string;
  readonly name?: string;
  readonly paused?: boolean;
}

export class UpdateInitiative {
  readonly #repo: InitiativeRepository;
  readonly #uow: UnitOfWork;

  constructor(repo: InitiativeRepository, uow: UnitOfWork) {
    this.#repo = repo;
    this.#uow = uow;
  }

  execute(input: UpdateInitiativeInput): void {
    // Shape guard BEFORE the transaction, mirroring
    // src/app/ai-provider/update-ai-provider.ts:72.
    if (input.name === undefined && input.paused === undefined) {
      throw new NoUpdateFieldsError();
    }
    this.#uow.transaction(() => {
      const initiative = this.#repo.get(input.id);
      if (initiative === undefined) {
        throw new UnknownReferenceError("initiative", input.id);
      }
      if (input.name !== undefined) {
        initiative.name = input.name;
        this.#repo.save(initiative);
      }
      if (input.paused !== undefined) {
        this.#repo.setPaused(input.id, input.paused);
      }
    });
  }
}
```

Decisions this pins:

- **Existence via `repo.get`**, matching `RenameInitiative:12-15`, not
  `resolveKind`. A non-initiative id is `UnknownReferenceError` → `404`.
  `WrongTypeReferenceError` is deliberately NOT raised: the dispatcher's pre-read
  (`initiative.get`) already `404`s first, so `wrong_type_reference` is
  unobservable on this row (Decision 7).
- **The empty-patch guard lives HERE, not in `decode`**, so the CLI shares it.
  This follows the convention EPIC 024 establishes — its story
  `024-ai-provider-writes/02-register-and-update.md:61` states _"The empty patch
  is NOT rejected in `decode`"_ — and reuses its error rather than inventing a
  second one. `InvalidInputError` could not be used: it is HTTP-layer
  (`src/apps/http/errors.ts:15-23`) and `app/` may not import `apps/`.
- **Write order is name-then-paused**, fixed so a test can assert the sequence.
- Both writes inside ONE `transaction`. `execute` is synchronous and returns
  `void`, matching `UnitOfWork.transaction<T>(fn: () => T)`.

### 2. `src/app/errors.ts` + `src/app/ai-provider/errors.ts` — share the error

`NoUpdateFieldsError` is declared at `src/app/ai-provider/errors.ts:298` but is
not ai-provider-specific. Move the class body to `src/app/errors.ts` — documented
there as _"the single error catalog the CLI maps"_ — and re-export it from its old
home so EPIC 024's imports and its registry entry are untouched:

```ts
// src/app/ai-provider/errors.ts
export { NoUpdateFieldsError } from "../errors.ts";
```

Behaviour-preserving: same class identity, so `err instanceof NoUpdateFieldsError`
holds for both import paths and 024's `no_update_fields` registry row still maps.

**If 025 is built before 024**, also add the registry row
`{ type: NoUpdateFieldsError, code: "no_update_fields", status: 400 }` to
`src/apps/http/error-registry.ts` beside the other app-error rows (`:48`, `:62`).
If 024 ran first the row already exists — adding it twice is a duplicate-key test
failure, so check before inserting.

### 3. `src/composition.ts` — construct and expose

Import beside `RenameInitiative` (`:35`); construct after `resumeInitiative`
(`:226-229`), where `initiativeRepository` (`:196`) and `unitOfWork` (`:202`) are
already in scope:

```ts
const updateInitiative = new UpdateInitiative(initiativeRepository, unitOfWork);
```

Export `updateInitiative` on the returned bundle and declare it on `CliDeps`
beside `renameInitiative`.

## Constraints

- Do NOT modify, merge or delete `RenameInitiative`, `PauseInitiative` or
  `ResumeInitiative` — the CLI keeps using them and no use case may call another.
- Do NOT extract "domain transition functions": `paused` has no rules
  (`domain/initiative.ts` documents it as an activation gate whose only mutator
  after creation is `setPaused`), so there is nothing to move.
- Do NOT add an event — Decision 10.
- The whole body, including the `get`, must be inside `transaction`. A read
  outside it re-introduces a check-then-act window.

## Verify

- `node --test src/app/initiative/update-initiative.test.ts` (new; convention of
  `src/app/initiative/pause-initiative.test.ts:1-57` — hand-written `Fake…Repo`
  over a `Map` with `seed()` and inspection accessors, `newId()` for ids,
  `node:test` + `node:assert/strict`):
  - `{id, name}` renames and leaves `paused` unchanged (seed `true`, assert `true`);
  - `{id, paused: true}` pauses and leaves `name` unchanged;
  - `{id, paused: false}` resumes;
  - `{id, name, paused}` applies BOTH, and a UoW spy recording `"enter"`/`"exit"`
    around `fn()` (idiom: `src/app/ai-provider/remove-ai-provider.test.ts:223-297`)
    proves both writes land strictly between them — one transaction, not two;
  - pausing an already-paused initiative succeeds and leaves it `true`
    (mirroring `pause-initiative.test.ts:68-76`);
  - `{id}` alone throws `NoUpdateFieldsError` and performs no write — assert the
    UoW fake recorded no transaction at all, proving the guard precedes it;
  - an unknown id rejects with `UnknownReferenceError` and the fake recorded zero
    `save` / `setPaused` calls;
  - write order within one call is `save` then `setPaused`.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-execution-proof.sh` phase **D2** (`{}` → `400
no_update_fields`).

# Story 01 — `?name=` becomes a case-insensitive substring filter

Epic: `.agent/plan/epics/026.2-ui-collections-and-overview.md` (decision 12,
epic story S0). Backend-only; depends on nothing in `ui/`.

## Change

- `src/app/project/list-projects.ts:16` — replace

  ```ts
  return projects.filter((p) => p.name === input.name);
  ```

  with a case-insensitive substring match:

  ```ts
  const needle = input.name.toLowerCase();
  return projects.filter((p) => p.name.toLowerCase().includes(needle));
  ```

  The `input?.name === undefined` early return at `list-projects.ts:13-15` stays
  unchanged.

- `src/app/resource/list-resources.ts:26-29` — replace

  ```ts
  const filtered =
    input.name === undefined
      ? resources
      : resources.filter((r) => r.name === input.name);
  ```

  with

  ```ts
  const needle = input.name?.toLowerCase();
  const filtered =
    needle === undefined
      ? resources
      : resources.filter((r) => r.name.toLowerCase().includes(needle));
  ```

  The `.map(toResourceView)` on the next line stays unchanged, so a listed
  credential still carries no `value`.

- `src/app/project/list-projects.test.ts` — the two tests that pin the old
  semantics are now wrong and must be replaced by their inverse:
  - `"execute({ name: 'ALPHA' }) returns [] — exact match only, no case folding"`
    → asserts `[{ id: "p1", name: "alpha" }]`, renamed to state case folding.
  - `"execute({ name: 'alph' }) returns [] — exact match only, no substring"`
    → asserts `[{ id: "p1", name: "alpha" }]`, renamed to state substring.

## Constraints

- No route, decode or view change. `optionalQueryString`
  (`src/apps/http/decode.ts:40-56`) keeps rejecting a repeated or blank `name`.
- No CLI change: `runListProjects` (`src/apps/cli/project.ts:60`) and
  `runListResources` (`src/apps/cli/resource.ts:261`) pass no `name` today and
  must keep passing none.
- Matching is `String.prototype.includes` over both sides lower-cased. No regex,
  no trimming (the decoder already trimmed), no fuzzy match, no re-sort — row
  order stays repository order.

## Verify

- `node --test src/app/project/list-projects.test.ts` — with these tests:
  - `execute({ name: "alph" })` over `[{p1,"alpha"},{p2,"beta"}]` returns only
    `{p1,"alpha"}`.
  - `execute({ name: "ALPHA" })` over `[{p1,"alpha"}]` returns `{p1,"alpha"}`.
  - `execute({ name: "alpha" })` over
    `[{p1,"alpha-one"},{p2,"alpha-two"},{p3,"beta"}]` returns `p1` then `p2`, in
    that order.
  - `execute({ name: "proof-026-2-alpha" })` over
    `[{p1,"proof-026-2-alpha"},{p2,"proof-026-2-beta"}]` returns only `p1` — a
    full name still selects one row.
  - `execute({ name: "zzz" })` returns `[]`.
  - the existing tests at `list-projects.test.ts:57-95` (empty repo, unchanged
    order, one `listProjects()` call with no arguments, `execute({})` returns
    all) still pass unchanged.
- `node --test src/app/resource/list-resources.test.ts` — with these added:
  - `execute({projectId, type:"credential", name:"k"})` over `[credA("k1"),
credB("k2")]` returns both, `cred-a` first.
  - `execute({… name:"K1"})` returns only `cred-a`, and `"value" in view` is
    `false` plus `JSON.stringify(views)` does not contain `CANARY_SECRET_VALUE`.
  - `execute({… name:"nope"})` returns `[]`.
  - the existing `(020 S3)` tests at `list-resources.test.ts:213-266` still pass
    unchanged.
- `node --test src/apps/http/routes.project.test.ts src/apps/http/routes.resource.test.ts`
  — unchanged, still green (they assert forwarding, not matching).
- `npm run verify` exits 0.
- Proof: Phase C of `scripts/e2e/ui-collections-proof.sh` — `fill("alpha")` must
  narrow two seeded projects to one row. No other phase depends on this story.

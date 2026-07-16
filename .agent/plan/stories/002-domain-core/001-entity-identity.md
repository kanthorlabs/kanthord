# Story 001 - entity base + identity

Epic: `.agent/plan/epics/002-domain-core.md`

## Goal

`src/domain/entity.ts` exists: the `Entity` base shape, ULID id generation,
and ULID ordering as creation-time ordering. Every later entity builds on it.

## Acceptance Criteria

- `newId()` returns a 26-character Crockford-base32 ULID
  (matches `/^[0-9A-HJKMNP-TV-Z]{26}$/`).
- Ids are strictly increasing across consecutive calls — including calls
  inside the same millisecond (monotonic mode). Sorting entities by `id`
  lexicographically equals creation order; no `createdAt` field exists (the
  ULID carries the timestamp).
- `Entity` is exported: `{ id: string }`.

## Constraints

- `ulid` is the only non-`node:` import allowed in `src/domain/**`
  (maintainer M1 in story 008 amends the lint rule). Zero I/O otherwise.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 - ULID identity helpers

**Requires:** none (first task of the epic).

**Input:** `src/domain/entity.ts` (new), `src/domain/entity.test.ts` (new);
consumes `monotonicFactory` from the `ulid` package.

**Action - RED:** test imports `newId` and `Entity` from `./entity.ts` and
asserts: (a) `newId()` matches the Crockford ULID regex above; (b) 1000
consecutive `newId()` results are strictly increasing under `<` string
comparison. Fails today: the module does not exist.

**Action - GREEN:** implement `entity.ts` exporting `Entity { id: string }`
and `newId(): string` backed by `monotonicFactory()` from `ulid`.

**Action - REFACTOR:** none.

**Output:** `src/domain/entity.ts` exports `Entity { id: string }` and
`newId(): string` producing monotonic ULIDs.

**Verify:** `npm test` green (both RED assertions pass);
`npm run typecheck` exit 0.

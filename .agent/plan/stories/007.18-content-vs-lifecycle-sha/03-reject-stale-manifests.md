# Story 3 — Reject stale on-disk manifests (gate in `ApplyGraph`)

Epic: `.agent/plan/epics/007.18-content-vs-lifecycle-sha.md`
Depends on: Story 1 (the format change this version bump announces).

The epic's open question is answered: **the on-disk manifest is authoritative for
every node that carries an `id`.** `apply-graph.ts:143`, `:166` and `:195` all read
`manifest?.nodes[id]`, where `manifest` is `pkg.manifest`
(`apply-graph.ts:136-137`) parsed from `.kanthord-export.json`
(`graph-codec.ts:289-293`). `graph_import_map.creation_sha` is the baseline only on
the id-less branch (`:221-252`). So Story 2's DB-only re-stamp does not cover the
common path, and stale manifests must be rejected.

The gate lives in **`ApplyGraph`**, not the CLI: a manifest whose node shas predate
the content-hash change is invalid _data_, not a malformed CLI invocation, and the
use case is the only place that can protect every caller. It joins the semantic
validations `ApplyGraph.execute` already performs and throws
(`UnknownNodeError` / `CrossInitiativeError` at `:328-360`).

**That move requires an error boundary that does not exist yet.** `main.ts:48` is
`await program.parseAsync(process.argv)` with no `.catch()`; `runImportGraph` has
no `try`/`catch`; `commands/import/graph.ts:55-92` has none. So today an
`UnknownNodeError` thrown by `ApplyGraph` escapes as an unhandled rejection with a
stack trace — and `error-map.ts` already imports `UnknownNodeError`,
`CrossInitiativeError` and `DriftConflictError` for a mapping that this path can
never reach. Section 4 adds the boundary.

## Change

### 1. `src/app/graph/format.ts:10`

```ts
export const GRAPH_FORMAT_VERSION = 3;
```

Extend the comment block at `:6-9` with one line: bumped to 3 for EPIC 007.18 —
`status` left the task content digest, so every `nodes` sha in a formatVersion ≤ 2
manifest is stale.

### 2. Make both producers emit the current version

- `src/app/graph/export-initiative.ts:42` — replace `const formatVersion = 1;` with
  an import of `GRAPH_FORMAT_VERSION` from `./format.ts`, used at the two existing
  sites (`:78`, `:124`). Delete the local.
- `src/apps/cli/import-graph.ts:470-471` — replace

  ```ts
      formatVersion:
        pkg.initiative.bindings !== undefined ? GRAPH_FORMAT_VERSION : 1,
  ```

  with `formatVersion: GRAPH_FORMAT_VERSION,`. The `1` branch only ever produced
  manifests the new gate would immediately reject.

Leave `graph-codec.ts:287` (`let formatVersion = 1;`) alone — that is the default
for a package with **no** manifest, which the gate must not reject.

The `--apply` rewrite path (`import-graph.ts:273-278`) spreads
`...existingManifest`, so an accepted package keeps its version — leave it alone.

### 3. `src/app/graph/import-errors.ts` — new error class

Append, following `DriftConflictError`'s shape (`:100-122`): readonly fields, an
explicit `this.name`, and a message with **no** `error: ` prefix (`toResult` adds
it):

```ts
// ---------------------------------------------------------------------------
// StaleManifestError — the package's manifest predates the EPIC 007.18 content
// -hash change, so every node sha in it is stale and would classify `drifted`.
// ---------------------------------------------------------------------------

export class StaleManifestError extends Error {
  readonly formatVersion: number;
  readonly expectedVersion: number;
  readonly initiativeId: string;

  constructor(
    formatVersion: number,
    expectedVersion: number,
    initiativeId: string,
  ) {
    super(
      `manifest formatVersion ${formatVersion} is stale ` +
        `(expected ${expectedVersion}) — its node shas predate the ` +
        `content-hash change; re-export with: ` +
        `kanthord export initiative ${initiativeId} --out <dir>`,
    );
    this.name = "StaleManifestError";
    this.formatVersion = formatVersion;
    this.expectedVersion = expectedVersion;
    this.initiativeId = initiativeId;
  }
}
```

`export initiative` takes a **positional** id, not `--id`
(`commands/export/initiative.ts:12-20`).

### 4. `src/app/graph/apply-graph.ts:136-137` — throw the gate first

Immediately after `const manifest = pkg.manifest;` (`:137`), before any
classification:

```ts
if (manifest !== undefined && manifest.formatVersion < GRAPH_FORMAT_VERSION) {
  throw new StaleManifestError(
    manifest.formatVersion,
    GRAPH_FORMAT_VERSION,
    manifest.initiativeId,
  );
}
```

Gate on `manifest.formatVersion`, **never** on `pkg.formatVersion` — the latter
defaults to `1` for a manifest-less package (`graph-codec.ts:287`), which would
reject every `--create` round-trip.

Import `GRAPH_FORMAT_VERSION` from `./format.ts` and `StaleManifestError` from
`./import-errors.ts`.

### 5. `src/apps/cli/import-graph.ts` — the error boundary

In `runApply`, wrap the `applyGraph.execute(...)` call so a thrown app-layer error
becomes the standard one-line CLI failure:

```ts
let result;
try {
  result = await deps.applyGraph.execute({/* unchanged arguments */});
} catch (err) {
  return { ...toResult(err), stdout: [] };
}
```

Import `toResult` from `./error-map.ts`. This is the same idiom as
`src/apps/cli/get.ts:29` and `src/apps/cli/find.ts:22`
(`return { ...toResult(err), stdout: [] };`).

### 6. `src/apps/cli/error-map.ts` — register the class

Add `StaleManifestError` to the existing `import { … } from
"../../app/graph/import-errors.ts"` block and to the `instanceof` chain in
`toResult`, next to `DriftConflictError`. Result: `exitCode: 1` and a single stderr
line `error: manifest formatVersion 2 is stale (expected 3) — …`.

## Constraints

- Gate on `manifest !== undefined` only. `--create` mints a fresh manifest and must
  keep working on a directory with no manifest at all (`parse.ts:43-55` swallows
  ENOENT).
- Reject `<` the current version, not `!==`.
- Throw **before** the first classification is pushed, so a stale manifest produces
  no classification lines — it must never report every node as `drifted`.
- The boundary in §5 wraps only the `applyGraph.execute` call, not the whole
  handler; do not add a global handler in `main.ts` or `index.ts`.
- Note the intended side effect of §5: `UnknownNodeError`, `CrossInitiativeError`
  and `DriftConflictError` thrown by `ApplyGraph` now print
  `error: <message>` with exit 1 instead of an unhandled-rejection stack trace.
  That is a strict improvement and is already what `error-map.ts` was written for.
- No backward compatibility for old manifests; re-export is the supported path
  (epic Non-goals).

## Verify

`node --test src/app/graph/apply-graph.test.ts`

- New: `execute` with `manifest.formatVersion === 2` rejects with
  `StaleManifestError`, and the error's `formatVersion`, `expectedVersion` and
  `initiativeId` fields carry the fixture's values. Use
  `await assert.rejects(...)`.
- New: `execute` with `manifest.formatVersion === 3` classifies normally.
- New: `execute` on a package with `manifest === undefined` does **not** throw
  (the create-mode round trip).
- New: the throw happens before classification — assert no repository write method
  and no CAS method was called (spy counts stay 0 on
  `FakeTaskRepositoryWithCas`).

**Fixture migration.** The gate makes every `formatVersion: 1` fixture that reaches
`ApplyGraph.execute` invalid. Change these to `3`:

- `src/app/graph/apply-graph.test.ts:318, 341, 1208, 1241, 1314, 1323, 1448, 1565, 1921, 1957`
- `src/app/graph/boundary-cases.test.ts:281, 336, 412, 428, 498, 508, 572, 582`
- `src/app/graph/context-preservation.integration.test.ts:106, 122`
- `src/app/graph/create-graph.test.ts:244` (`1` → `3`) and `:519` (`2` → `3`)
- `src/apps/cli/import-graph.test.ts:421`
- `src/apps/cli/export.test.ts:38, 83`
- `src/apps/cli/index.test.ts:291`
- `src/apps/cli/commands/special.test.ts:223`

Leave `src/apps/cli/graph-md/parse.test.ts:328` at its current value **unless** the
suite fails on it — that fixture exercises the parser, not `--apply`. Same rule for
any site not listed: change it only if `npm test` reports a failure there.

`node --test src/apps/cli/import-graph.test.ts`

- New: `--apply` on a package whose `.kanthord-export.json` has `formatVersion: 2`
  → `exitCode === 1`, `stdout` empty, and `stderr` exactly one line equal to
  `error: manifest formatVersion 2 is stale (expected 3) — its node shas predate the content-hash change; re-export with: kanthord export initiative <INIT_ID> --out <dir>`.
- New: the same package at `formatVersion: 3` reaches classification — `stdout` has
  at least one classification line and the stale string appears nowhere.
- New: `--create` with no manifest succeeds and writes `formatVersion: 3`; assert
  for **both** a with-bindings and a without-bindings initiative fixture.
- Rename and retarget the existing test at `:1176`
  ("(f) --create with initiative that has bindings writes manifest with
  formatVersion 2") to expect `3`, including the assertion at `:1211` and the
  message at `:1213`.
- New boundary test: an `--apply` that makes `ApplyGraph` throw
  `UnknownNodeError` now returns `exitCode 1` with a single
  `error: <message>` stderr line instead of rejecting.

`node --test src/app/graph/graph-codec.test.ts`

- Update `:413-414` to `GRAPH_FORMAT_VERSION === 3`.

`node --test src/app/graph/export-initiative.test.ts src/apps/cli/export.test.ts`

- The manifest from `export initiative` has `formatVersion: 3`.

`node --test src/apps/cli/graph-import-export.e2e.test.ts src/app/graph/graph-roundtrip.integration.test.ts`

- A round-trip (export → apply) still succeeds, proving a freshly exported package
  is never rejected by its own gate.

`npm run verify` exits 0.

Proof: no `PASS` line — every package in the proof script is created by this build,
so its manifest is already version 3. This story protects pre-existing `.data/`
packages from silently reporting universal drift.

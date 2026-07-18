# Story 09 — Named errors + provenance, boundary cases, context-preservation

Epic: `.agent/plan/epics/007-markdown-import-export.md`

## Goal

Consolidate the import error surface with rich, debuggable provenance (B7/B15),
lock every format/graph boundary case to a DEFINED behavior + test (S4/RB7),
and prove that a spec+dependency apply leaves `task_context` (resource bindings)
byte-for-byte untouched (S1) — the test that makes "context is out of scope"
coherent.

## Locked contracts

```ts
// src/app/graph/import-errors.ts — shared module; earlier stories that RAISE
// these import from here (the classes are introduced by the story that first
// needs them; this story finalizes the provenance fields + asserts them).
export class CrossInitiativeError extends Error {} // foreign parent/dep ref
export class UnknownNodeError extends Error {} // ref resolves to neither package nor DB
export class DuplicateRefError extends Error {} // same ref twice in a namespace — cites BOTH sourcePaths
export class CreateModeIdError extends Error {} // persisted id under --create (Story 05)
// Reused: TaskSpecLockedError (Story 01), MalformedReferenceError (Story 03),
// UnknownAgentError (EPIC 006 AgentCatalog), CycleError / UnknownDependencyError
// / DuplicateTaskError (domain validateGraph).
```

**Provenance contract (every named import error):** carries `sourcePath` (B7),
the offending node `id`/`ref`, and `expected`-vs-`actual` where relevant (e.g.
a drift error carries expected + actual sha; a cross-initiative error carries
the expected initiative id + the foreign one). `CrossInitiativeError` and
`UnknownNodeError` stay DISTINCT (two names are more actionable — B15).

## Boundary cases — DEFINED (S4/RB7; each gets a test)

| Case                                                              | Behavior                                                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Omitted objective file                                            | reported `missing` (deletable only per the empty-objective rule, Story 08) — NOT an error |
| Empty objective (no tasks)                                        | valid; round-trips; exports its file                                                      |
| Empty initiative (no objectives)                                  | valid; exports just the initiative file                                                   |
| Task `objective:` → a persisted objective ABSENT from the package | allowed (valid DB parent)                                                                 |
| Ref → neither package nor DB                                      | `UnknownNodeError` citing `sourcePath`                                                    |
| Duplicate ref in a namespace                                      | `DuplicateRefError` citing BOTH files                                                     |
| Unknown agent                                                     | `UnknownAgentError` (reused EPIC 006 `AgentCatalog.has` gate)                             |
| Frontmatter value matching neither ULID nor ref grammar           | `MalformedReferenceError` citing the file                                                 |
| Foreign initiative parent/dep ref                                 | `CrossInitiativeError`                                                                    |

## Constraints

- Errors live in `src/app/graph/import-errors.ts` (app layer); the CLI
  `error-map.ts` maps them to one-line `error: …` messages + exit 1 (mirrors
  the EPIC 006 `ImportValidationError` mapping).
- The context-preservation test uses REAL SQLite (fakes cannot prove the
  `task_context` rows are untouched by the apply txn).

## Verification Gate

- `node --test src/app/graph/import-errors.test.ts
src/app/graph/boundary-cases.test.ts
src/app/graph/context-preservation.integration.test.ts` green; typecheck 0;
  lint clean.

### Task T1 — provenance contract over all named errors

**Requires:** Stories 03, 05, 07 (errors are raised there).

**Input:** `src/app/graph/import-errors.ts` (finalize fields) +
`import-errors.test.ts`; `src/apps/cli/error-map.ts` + test.

**Action — RED:** tests: (a) each named error instance exposes `sourcePath` +
`ref`/`id`; a drift error exposes `expected`/`actual` sha; a cross-initiative
error exposes both initiative ids; (b) `CrossInitiativeError` and
`UnknownNodeError` are distinct classes with distinct `.name`; (c) `error-map`
renders each to a single `error: …` line + exit 1, and the line CITES the
`sourcePath`. Fails today: fields/mapping incomplete.

**Action — GREEN:** finalize the error fields + the CLI mapping.

**Action — REFACTOR:** none.

**Output:** uniform, debuggable provenance across the import error surface.

**Verify:** `node --test src/app/graph/import-errors.test.ts` +
`src/apps/cli/error-map.test.ts` green.

### Task T2 — boundary-case behaviors (the table above)

**Requires:** Stories 03, 04, 05, 07.

**Input:** new `src/app/graph/boundary-cases.test.ts` + whatever small code
changes the tests expose (most cases should already hold; this task pins them).

**Action — RED:** one test per table row asserting the DEFINED behavior — e.g.
empty initiative exports+re-imports to exactly one initiative, zero objectives;
a task pointing at a persisted-but-omitted objective applies without error; a
duplicate ref raises `DuplicateRefError` naming both files; a malformed
frontmatter ref raises `MalformedReferenceError` naming the file. Fails today
for any case not yet handled.

**Action — GREEN:** close any gap a row exposes (expected: minimal).

**Action — REFACTOR:** none.

**Output:** every boundary case has a locked behavior + regression test.

**Verify:** `node --test src/app/graph/boundary-cases.test.ts` green.

### Task T3 — context-preservation (real SQLite, S1)

**Requires:** Story 07 (apply), Story 02 (sha excludes `task_context`).

**Input:** new `src/app/graph/context-preservation.integration.test.ts`.

**Action — RED:** a real-SQLite test: create a pending task, bind resources via
`saveTaskContext` (e.g. credential + repository), export → edit the task's ac +
dependencies → `--apply`; then assert the task's `task_context` rows are
byte-for-byte identical (getTaskContext deep-equal) AND the task's `sha256`
changed (spec/deps did). Proves the apply never touches context and the token
excludes it. Fails today: unproven.

**Action — GREEN:** covered by Stories 02+07 (apply writes only spec/deps); the
test asserts the guarantee.

**Action — REFACTOR:** none.

**Output:** "context out of scope" proven — the fourth leg of the golden test.

**Verify:** `node --test src/app/graph/context-preservation.integration.test.ts`
green; typecheck 0; lint clean.

# Story 01 — Domain: single-line rule, `applyTaskSpec`, `reparentTask`, requiredness

Epic: `.agent/plan/epics/007-markdown-import-export.md`

## Goal

`src/domain/task.ts` gains the pending-only spec-mutation surface the import
path needs, plus the single-line/non-empty rule that makes the markdown format
lossless. Zero I/O. This is the ONLY new domain rule 007 invents (B12 single
line) + `applyTaskSpec` + `reparentTask` (B2/B9). Everything else reuses
existing domain (`newTask`, `validateGraph`, `assertDependenciesEditable`).

## Locked contracts (exact names — tests assert verbatim)

```ts
// NEW rule (B12/B17): title, each ac item, each verification item are
// single-line (no "\n") and non-empty (after no trimming — an all-whitespace
// value is empty). instructions stays multi-line prose. Enforced in newTask
// AND applyTaskSpec via a shared helper.
export class InvalidTaskFieldError extends Error {} // REUSED — now also thrown for multi-line title/ac/verification item

// NEW lock error, mirrors DependenciesLockedError (B2):
export class TaskSpecLockedError extends Error {
  constructor(taskId: string, status: TaskStatus); // name = "TaskSpecLockedError"
}
export function assertTaskSpecEditable(task: Task): void; // throws unless status === "pending"

// PATCH semantics (B11): absent key = unchanged; present = replace;
// explicit empty ONLY where the domain allows (verification → clear;
// title/instructions/ac can never be empty). dependencies are NOT in the
// patch — they route through setDependencies + graph validation (B2).
export interface TaskSpecPatch {
  title?: string;
  instructions?: string;
  ac?: string[];
  agent?: string;
  verification?: string[] | null; // [] or null = explicit clear; undefined = unchanged
}
export function applyTaskSpec(task: Task, patch: TaskSpecPatch): Task;

// Pending-only reparent (B9/B14) — a separate op so reparent cannot bypass the
// lifecycle lock:
export function reparentTask(task: Task, objectiveId: string): Task;
```

## Requiredness (B11) — locked

- **Required CREATE fields:** `title`, `instructions`, `ac` (≥1 item). Absent
  `agent` defaults to `generic@1` **at the CLI/codec boundary**, not in
  `newTask` (matches the existing EPIC 006 default placement).
- **`applyTaskSpec` PATCH:** absent = unchanged; a present `title`/`instructions`
  is replaced (never allowed empty); `ac` present replaces the whole list (≥1,
  each single-line); `verification` present-and-`[]`/`null` clears, present
  non-empty replaces.
- **Absent `# Verification` section = unset; empty section = explicit clear** —
  this distinction is the codec's job (Story 03); the domain only sees
  `undefined` (unchanged) vs `null`/`[]` (clear).

## Constraints

- `src/domain/task.ts` imports nothing outside `src/domain/`; pure, no
  Date/random/env; never mutates the input `Task` (returns a new one, like
  `setDependencies`/`transitionTask`).
- The lock predicate is `status !== "pending"` — so `failed`,
  `awaiting_confirmation`, `discarded`, `running`, `completed` all reject
  (mirrors `assertDependenciesEditable` exactly).

## Verification Gate

- `node --test src/domain/task.test.ts` green; `npm run typecheck` exit 0;
  `npm run lint` clean (boundaries).

### Task T1 — single-line/non-empty rule + fix existing create-task tests (B17)

**Requires:** nothing beyond `src/domain/`.

**Input:** `src/domain/task.ts`, `src/domain/task.test.ts`; also any existing
`create-task`/`store-graph` tests whose fixtures use a multi-line title/ac/
verification item (audit + update — this is NOT purely additive, B17).

**Action — RED:** tests: (a) `newTask` with a title containing `"\n"` throws
`InvalidTaskFieldError("title")`; (b) an `ac` item containing `"\n"` throws
`InvalidTaskFieldError("ac")`; (c) a `verification` item containing `"\n"`
throws `InvalidTaskFieldError("verification")`; (d) a whitespace-only title
throws; (e) a valid multi-line `instructions` is accepted. Fails today: no
newline check exists.

**Action — GREEN:** add a shared `assertSingleLineNonEmpty(field, value)`
helper; call it in `newTask` for title + each ac + each verification item.
Update any existing test fixture that relied on the (now illegal) multi-line
value so the suite is green.

**Action — REFACTOR:** none beyond the shared helper.

**Output:** `newTask` rejects multi-line/empty title/ac/verification items;
the pre-007 suite passes with adjusted fixtures.

**Verify:** `node --test src/domain/task.test.ts` green; `npm run typecheck` 0;
`npm run lint` clean.

### Task T2 — `TaskSpecLockedError` + `applyTaskSpec` PATCH semantics

**Requires:** T1.

**Input:** `src/domain/task.ts`, `src/domain/task.test.ts`.

**Action — RED:** tests: (a) `applyTaskSpec` on a non-pending task (spot-check
`running` and `failed`) throws `TaskSpecLockedError` with `taskId` + `status`;
(b) an absent key leaves that field byte-identical; (c) a present `title`
replaces it; (d) a present `ac` replaces the whole list and re-runs the
single-line rule (multi-line item → `InvalidTaskFieldError`); (e)
`verification: null` and `verification: []` both clear it; a present non-empty
`verification` replaces; (f) `applyTaskSpec` returns a NEW object, `task`
unchanged (identity + deep-equal check). Fails today: symbol absent.

**Action — GREEN:** implement `assertTaskSpecEditable` + `applyTaskSpec` with
the locked PATCH semantics, reusing the T1 single-line helper.

**Action — REFACTOR:** none.

**Output:** pending-only patch mutation with correct absent/replace/clear
behavior and a named lock error.

**Verify:** suite green; typecheck 0.

### Task T3 — `reparentTask` (pending-only)

**Requires:** T1.

**Input:** `src/domain/task.ts`, `src/domain/task.test.ts`.

**Action — RED:** tests: (a) `reparentTask(pendingTask, "OBJ2")` returns a new
task with `objectiveId === "OBJ2"`, all other fields unchanged, input not
mutated; (b) on a non-pending task (spot-check `running`) throws
`TaskSpecLockedError` (same lock as spec edits — reparent must not bypass the
lifecycle rule, B9). Fails today: symbol absent.

**Action — GREEN:** implement `reparentTask` reusing `assertTaskSpecEditable`.

**Action — REFACTOR:** none.

**Output:** pending-only reparent op the apply path uses for same-initiative
moves (B14/B18).

**Verify:** suite green; typecheck 0; lint clean.

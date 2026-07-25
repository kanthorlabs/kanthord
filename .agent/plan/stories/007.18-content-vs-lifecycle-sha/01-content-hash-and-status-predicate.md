# Story 1 — Content-only hash + explicit CAS status predicate

Epic: `.agent/plan/epics/007.18-content-vs-lifecycle-sha.md`

Covers the epic's Story bullets 1 **and** 2 as one unit. They are not separable:
bullet 1 removes the implicit race guard and bullet 2 replaces it. Shipping them
apart leaves a tree where `npm run verify` is green, `canonicalTask` no longer
hashes `status`, and `compareAndApply` still guards on sha alone — so an `--apply`
against a task the daemon is running overwrites its instructions mid-execution.
That window has no owner, so it must not exist.

## Change

### Part A — remove `status` from the content hash

#### A1. `src/domain/sha.ts:8-28`

Remove `status: string;` from the parameter type (line 16) and `status: t.status,`
from the returned literal (line 26). Nothing else changes: key insertion order
stays `title, instructions, ac, agent, verification, dependencies, objectiveId`;
`dependencies` stays `[...].sort()`; `verification ?? null` stays.

Do **not** touch `canonicalObjective` (`:31-36`), `canonicalInitiative` (`:39-44`),
`sha256Hex` (`:47-49`), or the re-export shim `src/storage/sqlite/node-sha.ts:7-12`.

#### A2. Remove `status:` from the five app-layer call sites

Each is a fresh object literal passed to `canonicalTask` — delete exactly one
property line:

| file:line                           | line to delete             |
| ----------------------------------- | -------------------------- |
| `src/app/graph/create-graph.ts:230` | `status: task.status,`     |
| `src/app/graph/apply-graph.ts:210`  | `status: liveStatus,`      |
| `src/app/graph/apply-graph.ts:244`  | `status: liveStatus,`      |
| `src/app/graph/apply-graph.ts:462`  | `status: liveTask.status,` |
| `src/app/graph/apply-graph.ts:573`  | `status: "pending",`       |

Keep the `liveStatus` locals (`apply-graph.ts:198`, `:234`) — they still feed
`classifyNode`, and Part B needs them.

Reword the stale clause in the docblock at `apply-graph.ts:70` ("from the
package's content **and live DB status**") to "from the package's declarative
content". Leave the rest of the docblock alone.

#### A3. `src/storage/sqlite/sqlite-task-repository.ts`

`#computeTaskSha` (`:29-51`): remove `status: TaskStatus;` from the parameter type
(line 37) and `status: task.status,` from the `canonicalTask` literal (line 48).

`#stampSha` (`:57-85`): remove `status,` from the SELECT column list on line 60
and `status: row.status,` from the `#computeTaskSha` literal on line 80. The
`as TaskRow` cast stays — that SELECT already omits columns.

Callers passing a variable (`save()` `:88`, `saveAll()` `:132`,
`compareAndApply()` `:370`, `conditionalReparent()` `:398`) need no change; if one
passes a fresh literal containing `status`, delete that property. `TaskStatus`
stays imported — `TaskRow` uses it at `:11`.

### Part B — explicit status predicate on both task CAS paths

#### B1. `src/storage/port.ts` — new task CAS result type

Add above the existing `CasResult` (`:169-176`); leave `CasResult` itself
**unchanged** (the four `InitiativeRepository` CAS ops at `:96-104` and
`conditionalReparent` keep it):

```ts
/** Which predicate of a task CAS failed. */
export type TaskCasConflictReason = "sha" | "status";

/**
 * Result of a task conditional-write guarded by BOTH sha and status.
 * `conflict` carries the row's actual sha + status and says which predicate
 * failed, so the caller can report "content changed" vs "no longer pending".
 */
export type TaskCasResult =
  | { status: "applied"; freshSha: string }
  | {
      status: "conflict";
      currentSha: string;
      currentStatus: string;
      reason: TaskCasConflictReason;
    };
```

Add `TaskStatus` to the domain import on line 4:
`import type { Task, TaskStatus } from "../domain/task.ts";`

#### B2. `src/storage/port.ts:122-141` — two signatures

```ts
  /**
   * Conditionally update a task's spec fields when its sha AND status both match.
   * `expectedStatus` is the status observed at preflight — a lifecycle change
   * between preflight and write is a conflict, not a silent overwrite.
   */
  compareAndApply(
    id: string,
    expectedSha: string,
    expectedStatus: TaskStatus,
    spec: {
      title: string;
      instructions: string;
      ac: string[];
      agent: string;
      verification: string[] | null;
      dependencies: string[];
    },
  ): TaskCasResult;

  /** Conditionally delete a task when its sha AND status both match. */
  conditionalDeleteTask(
    id: string,
    expectedSha: string,
    expectedStatus: TaskStatus,
  ): TaskCasResult;
```

`conditionalReparent` (`:135-139`) keeps its signature and `CasResult`. Add a
comment above it recording the deliberate asymmetry, so the gap is documented
rather than accidental:

```ts
/**
 * Conditionally move a task to a different objective when its sha matches.
 * No status predicate: EPIC 007.18 scoped the explicit guard to the two paths
 * that rewrite a task's instructions or remove the row. A reparent of a
 * running task changes only its parent reference and cannot corrupt an
 * in-flight run.
 */
```

#### B3. `sqlite-task-repository.ts:331-375` — atomic guarded update

Replace the read-then-compare at `:343-350` with the guarded write itself. Use the
repo's `changes` idiom from `src/queue/sqlite.ts:15-20` (`result.changes > 0`) —
node:sqlite types `changes` as `number | bigint`, so compare with `>`, never
`=== 0`:

```ts
  compareAndApply(
    id: string,
    expectedSha: string,
    expectedStatus: TaskStatus,
    spec: { /* unchanged */ },
  ): TaskCasResult {
    const result = this.#db
      .prepare(
        "UPDATE tasks SET title = ?, instructions = ?, ac = ?, agent = ?, verification = ?" +
          " WHERE id = ? AND sha256 = ? AND status = ?",
      )
      .run(
        spec.title,
        spec.instructions,
        JSON.stringify(spec.ac),
        spec.agent,
        spec.verification !== null ? JSON.stringify(spec.verification) : null,
        id,
        expectedSha,
        expectedStatus,
      );
    if (!(result.changes > 0)) return this.#taskCasConflict(id, expectedSha);
    // dependency rewrite + #stampSha: existing lines 363-374, byte-identical
  }
```

#### B4. New private helper, next to `#stampSha`

```ts
  /**
   * Read the row's actual sha + status and attribute a CAS failure to the sha
   * predicate when the sha differs, otherwise to the status predicate.
   * A row that no longer exists reports reason "sha" with empty values.
   */
  #taskCasConflict(id: string, expectedSha: string): TaskCasResult {
    type Row = { sha256: string; status: string };
    const row = this.#db
      .prepare("SELECT sha256, status FROM tasks WHERE id = ?")
      .get(id) as Row | undefined;
    const currentSha = row?.sha256 ?? "";
    const currentStatus = row?.status ?? "";
    return {
      status: "conflict",
      currentSha,
      currentStatus,
      reason: currentSha !== expectedSha ? "sha" : "status",
    };
  }
```

#### B5. `sqlite-task-repository.ts:410-429` — guarded delete

The guarded `DELETE FROM tasks` cannot run first: only `graph_import_map.task_id`
has `ON DELETE CASCADE` (`migrations.ts:157`), so `task_dependencies`, `events`,
`jobs`, `task_context` and `task_results` must be cleared by hand first
(`:419-426`) — and the existing test at `sqlite-task-repository.test.ts:1444`
requires the row and its dependency rows survive a conflict. So gate on a single
read that serves as both predicate and diagnostic:

```ts
  conditionalDeleteTask(
    id: string,
    expectedSha: string,
    expectedStatus: TaskStatus,
  ): TaskCasResult {
    // Read-then-delete rather than a guarded DELETE: the five non-cascading
    // child tables must be cleared before the tasks row, so the predicate has
    // to be checked before any statement runs. `node:sqlite` is synchronous and
    // the caller holds `BEGIN IMMEDIATE` (apply-graph.ts:438), so nothing can
    // interleave between this read and the deletes.
    type Row = { sha256: string; status: string };
    const row = this.#db
      .prepare("SELECT sha256, status FROM tasks WHERE id = ?")
      .get(id) as Row | undefined;
    if (
      row === undefined ||
      row.sha256 !== expectedSha ||
      row.status !== expectedStatus
    ) {
      return this.#taskCasConflict(id, expectedSha);
    }
    // existing lines 419-428 unchanged (7 DELETEs, then return applied/"")
  }
```

#### B6. `src/app/graph/apply-graph.ts` — carry the preflight status

`ApplyClassification` (`:38-46`) gains one field after `name?`:

```ts
  /** Task status observed during preflight; the CAS status predicate. Tasks only. */
  liveStatus?: string;
```

Set it at exactly three sites:

- `:213-219` (task-with-id): add `liveStatus,` — local exists at `:198`.
- `:247-253` (import-map hit): add `liveStatus,` — local at `:234`.
- the missing-node block (`:294-314`): today `tasks.get(fileId)` is read **only**
  when `input.deleteMissing === true` (`:296-300`). Hoist it:

  ```ts
  let liveStatus: string | undefined;
  if (kind === "task") {
    const liveTask = this.#deps.tasks.get(fileId);
    liveStatus = liveTask?.status ?? "pending";
  }
  if (input.deleteMissing === true) {
    // existing reason enrichment, reusing the value read above
  }
  ```

  and put `liveStatus` on the pushed classification. Keep the `reason` enrichment
  gated on `deleteMissing` exactly as it is.

Pass it at both call sites — `:481-492` and `:602-605` — as the third argument,
`(cls.liveStatus ?? "pending") as TaskStatus`. `conditionalReparent` at `:471` and
`:499` is unchanged. Conflict handling stays `throw new LateCasConflict(cls)` at
both sites; Story 4 threads the reason through.

#### B7. Update all 17 fake `TaskRepository` implementations

| file                                                                          | `compareAndApply` | `conditionalDeleteTask` |
| ----------------------------------------------------------------------------- | ----------------- | ----------------------- |
| `src/app/graph/apply-graph.test.ts` (`FakeTaskRepository`)                    | 179               | 200                     |
| `src/app/graph/apply-graph.test.ts` (`FakeTaskRepositoryWithCas`)             | 260               | 287                     |
| `src/app/graph/apply-graph.test.ts` (`FakeTaskRepositoryWithDelete`)          | —                 | 1643                    |
| `src/app/graph/apply-graph.test.ts` (`FakeTaskRepositoryWithLateCasConflict`) | 2034              | —                       |
| `src/app/graph/boundary-cases.test.ts`                                        | 190               | 207                     |
| `src/app/graph/create-graph.test.ts`                                          | 141               | 158                     |
| `src/app/graph/store-graph.test.ts`                                           | 46                | 63                      |
| `src/app/graph/check-stored-graph.test.ts`                                    | 57                | 74                      |
| `src/app/graph/export-initiative.test.ts`                                     | 139               | 156                     |
| `src/app/task/list-tasks.test.ts`                                             | 54                | 71                      |
| `src/app/task/create-task.test.ts`                                            | 148               | 165                     |
| `src/app/task/add-dependency.test.ts`                                         | 94                | 111                     |
| `src/apps/cli/list-tasks.test.ts` (`FakeTaskRepository`)                      | 55                | 72                      |
| `src/apps/cli/list-tasks.test.ts` (`FakeTaskRepositoryB1`)                    | 132               | 149                     |
| `src/apps/cli/dependency.test.ts`                                             | 87                | 104                     |
| `src/apps/cli/task.test.ts`                                                   | 147               | 164                     |

Always-applied stubs: add `_expectedStatus: string,` as the third parameter; the
existing `{ status: "applied" as const, freshSha: "" }` is already a valid
`TaskCasResult`. Always-conflict stubs (`apply-graph.test.ts:179/200`,
`boundary-cases.test.ts:190/207`): change `: CasResult` → `: TaskCasResult` and
extend the literal to
`{ status: "conflict", currentSha: "", currentStatus: "pending", reason: "sha" }`.

## Constraints

- Add no field to the hash. The digest covers exactly seven fields:
  `title, instructions, ac, agent, verification, dependencies, objectiveId`.
- Do not change `classifyNode`'s check order
  (`drifted` → `unchanged` → `locked` → `updated`).
- `expectedStatus` must be the **preflight-observed** status. Do not re-read the
  status at the write site: `apply-graph.ts:444` runs inside the UoW's
  `BEGIN IMMEDIATE`, where the value can never differ — a re-read makes the guard
  a provable no-op.
- Do not open a transaction inside either CAS method —
  `sqlite-unit-of-work.ts:16` throws on a nested transaction.
- `compareAndApply` must still not touch `task_context`
  (`context-preservation.integration.test.ts:44` pins this).
- Do not change when `save()` is called or any lifecycle transition.

## Verify

`node --test src/storage/sqlite/node-sha.test.ts`

- Delete `status: "pending",` from the `baseTask` fixture (`:23`) and every test
  whose subject is "status changes the digest".
- New: `assert.ok(!canonicalTask(baseTask).includes('"status"'))`.
- New, pinning the exact string and key order:

  ```ts
  assert.equal(
    canonicalTask(baseTask),
    '{"title":"implement api","instructions":"Implement POST /oauth/token",' +
      '"ac":["returns 200 for valid creds"],"agent":"generic@1",' +
      '"verification":null,"dependencies":["DEP1","DEP2"],"objectiveId":"OBJ1"}',
  );
  ```

- Keep the stability, dependency-SET-order and `verification undefined ≠ []`
  tests passing unchanged.

`node --test src/storage/sqlite/sqlite-task-repository.test.ts`

- Invert the status-sha test at `:1118`: a status-only change must **not** change
  `tasks.sha256`. Save `pending`, read `getSha256`, save the same task as
  `completed`, read again, `assert.equal`.
- Remove `status` from the `canonicalTask` fixtures at `:937, :985, :997, :1051,
:1104, :1148, :1319`.
- The add/removeDependency restamp tests (`:1065`) must still assert the sha
  **changes** — `dependencies` is still hashed.
- Six new CAS tests: (1) matching sha+status → `applied`, columns updated,
  `freshSha !== expectedSha`; (2) matching sha, row is `running`,
  `expectedStatus: "pending"` → `reason: "status"`, `currentStatus: "running"`,
  title unchanged; (3) wrong sha, matching status → `reason: "sha"`, row
  unchanged; (4) `conditionalDeleteTask` matching both → `applied`,
  `repo.get(id) === undefined`, `graph_import_map` row gone; (5)
  `conditionalDeleteTask` matching sha, wrong status → `reason: "status"` and
  **both** the `tasks` row and its `task_dependencies` rows still exist; (6)
  `conditionalDeleteTask` wrong sha → `reason: "sha"`, row kept.
- Existing tests at `:1166, :1211, :1258, :1407, :1444` keep their assertions;
  add the third argument.

`node --test src/storage/sqlite/cas-rollback.integration.test.ts`

- Add the third argument at `:119` and `:126`; the rollback assertions at `:157`
  and `:162` must still pass.

`node --test src/app/graph/apply-graph.test.ts`

- Replace the five hardcoded hex constants at `:56-69` with values computed
  in-file via `sha256Hex(canonicalTask({...}))` / `canonicalObjective` /
  `canonicalInitiative`, imported from `../../domain/sha.ts`, using the field
  values the fixtures already encode. The exact digest stays pinned by
  `node-sha.test.ts`.
- New: **a task whose live status advanced but whose file is untouched classifies
  `unchanged`, not `drifted`.** Live task `completed`, content identical to the
  package, live sha === `manifest.nodes[TASK1_ID]`. Assert `"unchanged"`,
  `conflicts` empty, `applied === true`.
- New — **the race guard, hermetic and untimed**: a fake `TaskRepository` whose
  `compareAndApply` asserts on its `expectedStatus` argument and, for a task
  classified `updated` while `pending`, returns
  `{ status: "conflict", currentSha: <baseline>, currentStatus: "running",
reason: "status" }`. Assert `result.applied === false` and the spec was not
  written.
- New: `compareAndApply` receives `expectedStatus === "pending"` for a task
  classified `updated` (spy the argument on `FakeTaskRepositoryWithCas`).
- New: `conditionalDeleteTask` receives the missing task's real preflight status
  even when `deleteMissing: false, confirmDelete: true`.
- Existing CAS-count tests at `:1070, :1133, :1395, :1512, :1677, :2185` must
  still pass.

`node --test src/app/graph/boundary-cases.test.ts src/app/graph/context-preservation.integration.test.ts src/app/graph/create-graph.test.ts`
— pass after the signature updates.

`npm run verify` exits 0.

Proof: precondition for steps 1, 3 and 4 of `scripts/e2e/sha-classification-proof.sh`
(Story 5). The race guard itself is proven by the unit test above, not the Proof —
a true interleaving cannot be made deterministic from a shell script.

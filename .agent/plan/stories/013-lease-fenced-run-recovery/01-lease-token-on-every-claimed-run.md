# Story 1 — Lease token on every claimed run

Epic: `.agent/plan/epics/013-lease-fenced-run-recovery.md`

## Change

### 1. `src/queue/port.ts` — elevate the `jobs` row id to a named lease token

Replace `ClaimedJob` (lines 13-16) with:

```ts
/** The lease token of a claimed run. It IS the `jobs` row id — no second identifier. */
export type LeaseToken = string;

export interface ClaimedJob {
  id: LeaseToken;
  taskId: string;
}

/** A `running` job row plus its revocation state. */
export interface RunningJob extends ClaimedJob {
  revoked: boolean;
  revokeReason: string | null;
}
```

Add to the `JobQueue` interface (after `listRunningJobs()`, line 46):

```ts
  /**
   * True when `leaseToken` names a job row that is still `running` and not
   * revoked — i.e. its run still owns the task.
   */
  isLeaseCurrent(leaseToken: LeaseToken): boolean;

  /** All `running` jobs for one task, with revocation state, ordered by id ASC. */
  listRunningJobsForTask(taskId: string): RunningJob[];
```

Add at the end of the file:

```ts
/** A write was attempted with a lease that is no longer current. */
export class StaleLeaseError extends Error {
  readonly leaseToken: string;

  constructor(leaseToken: string) {
    super(`lease ${leaseToken} is no longer current`);
    this.name = "StaleLeaseError";
    this.leaseToken = leaseToken;
  }
}
```

(`src/agent-runner/port.ts:15-23` / `:100-110` is the precedent for error classes living in a `port.ts`.)

### 2. `src/storage/sqlite/migrations.ts` — revocation columns on `jobs`

**The `name` is fixed; the `version` is NOT.** Use `name:
"013-s1-job-lease-revocation"` exactly, and set `version` to the last existing
version + 1 at implementation time (`validateSequence` enforces contiguity).
EPIC 011 story 3 also appends a migration, so the number depends on land order —
never hardcode it from this document.

Append after the `version: 26` entry (which currently ends at line 796, before the closing `];` at line 797):

```ts
  {
    version: /* last + 1 — see above */ 27,
    name: "013-s1-job-lease-revocation",
    // EPIC 013 Story 1 — revocation state on the existing jobs row. The row id
    // is the lease token; these two columns make a revoked lease observable.
    // ALTER ADD COLUMN (mirrors migration 6's `tasks.sha256`) — no rebuild, so
    // the partial unique index `jobs_queued_taskId` is untouched.
    up: (db) =>
      db.exec(`
ALTER TABLE jobs ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN revokeReason TEXT;
`),
  },
```

No `CHECK` on `revoked` (SQLite `ALTER TABLE ADD COLUMN` precedent in this file, migration 6 at line 208, carries none).

### 3. `src/queue/sqlite.ts` — implement the two new reads

Append two methods after `listRunningJobs` (ends line 61):

```ts
  isLeaseCurrent(leaseToken: string): boolean {
    const row = this.#db
      .prepare(
        "SELECT 1 AS ok FROM jobs WHERE id=? AND status='running' AND revoked=0",
      )
      .get(leaseToken) as { ok: number } | undefined;
    return row !== undefined;
  }

  listRunningJobsForTask(taskId: string): RunningJob[] {
    const rows = this.#db
      .prepare(
        "SELECT id, taskId, revoked, revokeReason FROM jobs" +
          " WHERE taskId=? AND status='running' ORDER BY id ASC",
      )
      .all() as unknown as Array<{
      id: string;
      taskId: string;
      revoked: number;
      revokeReason: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      revoked: r.revoked === 1,
      revokeReason: r.revokeReason,
    }));
  }
```

Bind `taskId` on the `.all(taskId)` call. Import `RunningJob` as a type from `./port.ts`.

### 4. `src/agent-runner/port.ts` — the lease reaches the runner

Add above `interface AgentRunner` (line 88):

```ts
/** Observes whether the run's queue lease is still current. */
export interface LeaseObserver {
  isCurrent(): boolean;
}
```

Change `AgentRunner.run` (lines 88-94) to a **required** 4th parameter:

```ts
export interface AgentRunner {
  run(
    task: Task,
    context: TaskContextBinding[],
    provider: ResolvedProvider | undefined,
    lease: LeaseObserver,
  ): Promise<TaskResult>;
}
```

`provider` changes from `provider?:` to `provider: ResolvedProvider | undefined`. The lease parameter is required — every call site must be updated (see §6). Do not make it optional.

### 5. Adapters take the new parameter

- `src/agent-runner/fake.ts:23-27` — signature becomes `run(task, context, _provider: ResolvedProvider | undefined, _lease: LeaseObserver)`. No behaviour change in this story: `FakeRunner` accepts and ignores the lease (Story 3 makes it observe revocation).
- `src/agent-runner/pi.ts:382-386` — `run(task, context, provider: ResolvedProvider | undefined, lease: LeaseObserver)`; thread `lease` as a new 6th argument into `#doRun` (call at `pi.ts:388-394`, declaration at `pi.ts:429-435`). `#doRun` accepts it and ignores it in this story (Story 3 wires the seam).

### 6. `src/app/task/run-next-task.ts` — build the lease and pass it

At `run-next-task.ts:289-293` replace the runner call with:

```ts
result = await runner.run(
  runningTask,
  contextBindings,
  chain !== undefined ? chain[providerIdx] : undefined,
  { isCurrent: () => this.#queue.isLeaseCurrent(jobId) },
);
```

Arrow wrapper, never a bare method reference (AGENTS.md "Wiring").

### 7. Call sites to update (mechanical, `, undefined, LIVE_LEASE` / `, LIVE_LEASE`)

Add `const LIVE_LEASE = { isCurrent: () => true };` near the top of each test file below and pass it as the 4th argument. Counts are `.run(` call sites of an `AgentRunner`:

- `src/agent-runner/pi.test.ts` — 44 sites
- `src/agent-runner/verification.test.ts` — 10 sites
- `src/agent-runner/fake.test.ts` — 7 sites (these pass no provider today: `runner.run(task, [])` → `runner.run(task, [], undefined, LIVE_LEASE)`)

## Constraints

- The lease token is the `jobs` row id. Do not add a second identifier, and do not add a `leaseToken` column.
- `claim()`, `enqueue()`, `finish()`, `discard()`, `listRunningJobs()` keep their current SQL and semantics in this story.
- `claim()` must stay unchanged: a revoked row keeps `status='running'`, so the existing per-initiative `NOT EXISTS` guard (`src/queue/sqlite.ts:33-38`) already blocks a second live run in the same initiative while a revoked run drains. Do not add a `revoked` filter to `claim()`.
- Every existing fake implementing `JobQueue` must gain the two new methods. The 8 files: `src/app/task/run-next-task.test.ts:123`, `src/app/task/recover-interrupted-tasks.test.ts:37`, `src/app/task/enqueue-ready-tasks.test.ts:31`, `src/app/task/retry-task.test.ts:48`, `src/app/task/reject-task.test.ts:118`, `src/app/task/approve-task.test.ts:238`, `src/app/task/escalation-persistence.test.ts:88`, `src/apps/cli/task.test.ts:616`. Default fake behaviour: `isLeaseCurrent()` returns `true`, `listRunningJobsForTask()` returns `[]`.
- `src/app/task/execution-consistency.test.ts` also constructs a queue fake — update it the same way.

## Verify

- `node --test src/queue/sqlite.test.ts` — add to that file, using its existing `makeTempDb()` + `seedTask(db)` helpers (`src/queue/sqlite.test.ts:22-52`):
  - `isLeaseCurrent` returns `true` for a freshly claimed job's `id`.
  - `isLeaseCurrent` returns `false` for an unknown id, for a `queued` job's id, and for a job that was `finish`ed.
  - `isLeaseCurrent` returns `false` after `UPDATE jobs SET revoked=1 WHERE id=?` on a running row.
  - `listRunningJobsForTask` returns `[]` for a task with only a `queued` job; returns one row with `revoked: false, revokeReason: null` after a claim; returns `revoked: true, revokeReason: "why"` after a direct `UPDATE jobs SET revoked=1, revokeReason='why'`.
  - `listRunningJobsForTask` ignores running jobs belonging to other tasks.
- `node --test src/storage/sqlite/migrations.test.ts` — update and add:
  - line 70 test title and line 72 assertion: `userVersion(db)` is now `27`. Also update the `userVersion(db), 26` assertions at lines 995, 1099, 1178, 1510, 1525, 1566, 1687.
  - new test: `columnNames(db, "jobs")` deep-equals `["id", "taskId", "status", "revoked", "revokeReason"]`.
  - new test: seed at `MIGRATIONS.slice(0, 26)`, insert a task chain via `insertChain(db)` plus one `jobs` row, then `migrate(db, MIGRATIONS)`; assert the pre-existing row survives with `revoked === 0` and `revokeReason === null`.
  - new test: the partial unique index still rejects two `queued` jobs for one task after this migration (mirror the assertion at `src/storage/sqlite/migrations.test.ts:343`).
- `node --test src/app/task/run-next-task.test.ts` — add one test: a `RecordingJobQueue` whose `isLeaseCurrent` records its argument; assert the runner received a `lease` whose `isCurrent()` call reaches the queue with the claimed job's `id` (i.e. the token threaded from claim to the runner).
- `node --test src/agent-runner/fake.test.ts src/agent-runner/pi.test.ts src/agent-runner/verification.test.ts` — all pass unchanged in behaviour after the mechanical 4th-argument edit.
- `npm run verify` exits 0.
- Proof: keeps Proof phase **A** green (`A ok: task <id> is running`); delivers no new Proof line on its own.

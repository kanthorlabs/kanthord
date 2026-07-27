# Story 3 — daemon heartbeat: table, interval writer, staleness read

Epic: `.agent/plan/epics/014-project-readiness-check.md`

## Change

### 1. `src/storage/port.ts` — a NEW interface (do not touch existing ones)

Append after `SequencingRepository` (the file's last interface, declared at
`src/storage/port.ts:385`):

```ts
/** One row per live daemon instance (014 Story 3). Observation only — no lease. */
export interface DaemonHeartbeatRepository {
  /** Insert or refresh the row for `instanceId`. */
  beat(input: {
    instanceId: string;
    pid: number;
    startedAtMs: number;
    atMs: number;
  }): void;
  /** Every recorded instance, ordered by `instanceId` ascending. */
  list(): Array<{
    instanceId: string;
    pid: number;
    startedAtMs: number;
    lastBeatMs: number;
  }>;
}
```

A **new** interface, not a method on an existing repository: several storage ports
carry `?`-optional methods purely so the inline per-test fakes keep compiling
(`src/storage/port.ts:63`, `:87`, `:215`). Adding a required method to
`ProjectRepository` or `InitiativeRepository` would break every inline fake in
`src/app/**/*.test.ts`. This story breaks none.

### 2. `src/storage/sqlite/migrations.ts` — one new migration

Append one entry to the end of the `MIGRATIONS` array (the array opens at
`src/storage/sqlite/migrations.ts:66` and closes at `:797`; the last entry is
`version: 26` at `:763`).

- **Name is fixed**: `"014-s3-daemon-heartbeats"`.
- **Version is mechanical, not fixed**: `validateSequence`
  (`src/storage/sqlite/migrate.ts:54-63`) requires versions to be exactly
  contiguous `1..n`, so the version must be `MIGRATIONS[MIGRATIONS.length - 1]
.version + 1` as read at implementation time. Against the tree as authored that
  is **27**. **EPIC 011 story 3 reserves 27 and EPIC 013 reserves 27 and 28**, so
  if either landed first, use 28; if both did, 29. Read the last entry's version
  and add one — do not hardcode 27 blindly.

```ts
  {
    version: 27, // ← last existing version + 1; see the note above
    name: "014-s3-daemon-heartbeats",
    // EPIC 014 Story 3 — one row per daemon instance (pid + process start
    // time). Observation only: this is not a lease and nothing enforces a
    // single daemon. Plain CREATE TABLE (not IF NOT EXISTS): `user_version`
    // is the idempotency mechanism (see the registry header at :60-65).
    up: (db) =>
      db.exec(`
CREATE TABLE daemon_heartbeats (
  instanceId  TEXT PRIMARY KEY,
  pid         INTEGER NOT NULL,
  startedAtMs INTEGER NOT NULL,
  lastBeatMs  INTEGER NOT NULL
)
`),
  },
```

No `events.type` CHECK change: the heartbeat appends no event.

### 3. New file `src/storage/sqlite/daemon-heartbeat-repository.ts`

`export class SqliteDaemonHeartbeatRepository implements DaemonHeartbeatRepository`,
constructor `(db: DatabaseSync)`, mirroring the constructor + prepared-statement
style of `src/storage/sqlite/ai-provider-registry.ts`.

- `beat` is a single upsert statement:
  `INSERT INTO daemon_heartbeats (instanceId, pid, startedAtMs, lastBeatMs) VALUES (?, ?, ?, ?) ON CONFLICT(instanceId) DO UPDATE SET lastBeatMs = excluded.lastBeatMs`
- `list` is `SELECT instanceId, pid, startedAtMs, lastBeatMs FROM daemon_heartbeats ORDER BY instanceId ASC`.

### 4. New file `src/app/task/daemon-heartbeat.ts`

No `node:*` import; every effect arrives injected.

```ts
/** Default beat period. */
export const HEARTBEAT_INTERVAL_MS = 2_000;
/** Default staleness threshold: exactly 3 beat periods. Never tied to pollIntervalMs. */
export const HEARTBEAT_STALE_MS = 3 * HEARTBEAT_INTERVAL_MS; // 6_000

/**
 * Test-only override. A positive integer wins; anything else falls back to
 * HEARTBEAT_STALE_MS.
 */
export function resolveStaleMs(raw: string | undefined): number;

/**
 * Beat period derived from the effective threshold, so the threshold stays a
 * multiple (3x) of the period even under the override: an override of 2000 gives
 * a 666ms period, and a live daemon is therefore never read as stale.
 */
export function resolveIntervalMs(staleMs: number): number {
  return Math.max(1, Math.min(HEARTBEAT_INTERVAL_MS, Math.floor(staleMs / 3)));
}

/** Instance identity: pid plus process start time. */
export function daemonInstanceId(pid: number, startedAtMs: number): string {
  return `${pid}:${startedAtMs}`;
}

export interface HeartbeatDeps {
  store: {
    beat(input: {
      instanceId: string;
      pid: number;
      startedAtMs: number;
      atMs: number;
    }): void;
  };
  now: () => number;
  pid: number;
  startedAtMs: number;
  intervalMs: number;
  /** Repeating scheduler. The adapter wraps setInterval; tests pass a fake. */
  schedule: (fn: () => void, ms: number) => { cancel: () => void };
}

/**
 * Writes one beat immediately, then one every `intervalMs` — independent of task
 * execution. Returns a stop function; calling it twice is a no-op.
 */
export function startHeartbeat(deps: HeartbeatDeps): () => void;

/** Age in milliseconds, clamped at 0 so a backwards clock jump is never negative. */
export function heartbeatAgeMs(nowMs: number, lastBeatMs: number): number {
  return Math.max(0, nowMs - lastBeatMs);
}
```

`startHeartbeat` must beat **before** it schedules, so the first read after daemon
start already sees a row. It must swallow nothing: a `beat` throw propagates.

### 5. `src/composition.ts` — construct and expose

- Import `SqliteDaemonHeartbeatRepository` and the four `daemon-heartbeat.ts`
  helpers.
- Beside `const taskRepository = new SqliteTaskRepository(db);`
  (`src/composition.ts:174`) add
  `const daemonHeartbeats = new SqliteDaemonHeartbeatRepository(db);`.
- Read the override once, mirroring the existing env read at
  `src/composition.ts:624`:
  ```ts
  const heartbeatStaleMs = resolveStaleMs(
    process.env["KANTHORD_HEARTBEAT_STALE_MS"],
  );
  ```
- Add to the returned bundle (the object literal at `src/composition.ts:850-920`):
  ```ts
  heartbeat: {
    staleMs: heartbeatStaleMs,
    /** Starts the interval writer; returns the stop function. */
    start: (): (() => void) => {
      const startedAtMs = Date.now() - Math.round(process.uptime() * 1000);
      return startHeartbeat({
        store: daemonHeartbeats,
        now: () => Date.now(),
        pid: process.pid,
        startedAtMs,
        intervalMs: resolveIntervalMs(heartbeatStaleMs),
        schedule: (fn, ms) => {
          const t = setInterval(fn, ms);
          t.unref();
          return { cancel: () => clearInterval(t) };
        },
      });
    },
    /** Ages in ms, computed at read time. Story 6 feeds these into the report. */
    instances: (): Array<{ instanceId: string; ageMs: number }> => {
      const now = Date.now();
      return daemonHeartbeats.list().map((r) => ({
        instanceId: r.instanceId,
        ageMs: heartbeatAgeMs(now, r.lastBeatMs),
      }));
    },
  },
  ```
  `t.unref()` is mandatory: without it `run daemon --until-idle` would never exit.

### 6. `src/apps/cli/deps.ts` — declare the field

Add to `CliDeps` (interface at `src/apps/cli/deps.ts:131`), next to `buildDaemon`
(`:172`):

```ts
  heartbeat: {
    staleMs: number;
    start: () => () => void;
    instances: () => Array<{ instanceId: string; ageMs: number }>;
  };
```

### 7. `src/apps/cli/daemon.ts` — start and stop the writer

`runDaemon` already owns a `try/finally` around `daemon.execute()`
(`src/apps/cli/daemon.ts:67-108`). Add a third parameter and bracket the run:

- Signature becomes
  `runDaemon(args, buildDaemon, logger?, heartbeat?: { start: () => () => void })`.
- Immediately before `const sigintHandler = ...` (`src/apps/cli/daemon.ts:69`):
  `const stopHeartbeat = heartbeat?.start();`
- In the existing `finally` (`:107-109`), before
  `process.removeListener(...)`: `stopHeartbeat?.();`

The writer must start **before** `daemon.execute()` and stop in the `finally`, so
the beat period is independent of the `await runNext.execute()` at
`src/app/task/run-daemon.ts:153`. Do **not** put the beat inside `RunDaemon`'s
loop: a long agent run would make a live daemon read `stopped`.

### 8. `src/apps/cli/commands/run/daemon.ts` — pass it through

At the `runDaemon(...)` call (`src/apps/cli/commands/run/daemon.ts:38-47`) add
`deps.heartbeat` as the fourth argument.

## Constraints

- The migration version must equal `last existing version + 1` at implementation
  time — verify with `node src/main.ts db status` after migrating, and update the
  `npm run verify` expectation accordingly.
- `RunDaemon` (`src/app/task/run-daemon.ts`) must not be modified by this story.
  Its deps type, loop, and tests stay byte-identical.
- No lease, no supervision, no refusal to start a second daemon. Two rows is a
  reportable state, not an error (epic non-goal).
- Rows are never deleted. A graceful shutdown leaves the last row behind and the
  reader decides staleness by age.
- The interval handle must be `unref()`ed and cleared in the `finally`.
- `heartbeat` is a **required** field on `CliDeps` (the object always exists in
  composition), but the `runDaemon` handler parameter is optional so the existing
  handler tests in `src/apps/cli/daemon-summary.test.ts` keep compiling unchanged.

## Verify

- `node --test src/app/task/daemon-heartbeat.test.ts` — new file, hermetic (fake
  `now`, fake `schedule`, fake `store` recording calls):
  - `resolveStaleMs(undefined) === 6000`; `resolveStaleMs("2000") === 2000`;
    `resolveStaleMs("0")`, `resolveStaleMs("-1")`, `resolveStaleMs("abc")`,
    `resolveStaleMs("1.5")`, `resolveStaleMs("")` all `=== 6000`.
  - `HEARTBEAT_STALE_MS === 3 * HEARTBEAT_INTERVAL_MS` (the threshold is a
    multiple of the period).
  - `resolveIntervalMs(6000) === 2000`; `resolveIntervalMs(2000) === 666`;
    `resolveIntervalMs(1) === 1` (never 0, never negative).
  - `daemonInstanceId(4242, 1000) === "4242:1000"`; two different pids and two
    different start times give four distinct ids.
  - `startHeartbeat` writes exactly one beat **before** the fake `schedule` is
    ever invoked, with `atMs` from `now()`; firing the scheduled callback three
    times writes three more beats with the same `instanceId` and increasing
    `atMs`; the returned stop function calls `cancel` once, and calling it twice
    cancels only once and writes no further beat.
  - `heartbeatAgeMs(10_000, 4_000) === 6_000`;
    `heartbeatAgeMs(1_000, 5_000) === 0` (backwards clock jump clamps to 0, never
    negative); `heartbeatAgeMs(5_000, 5_000) === 0`.
- `node --test src/storage/sqlite/daemon-heartbeat-repository.test.ts` — new
  file, real sqlite in a temp dir (mirror the `makeTempDb()` harness of
  `src/storage/sqlite/sqlite-project-repository.test.ts:1-40`, including the
  `after()` cleanup):
  - `list()` on a fresh database returns `[]`.
  - one `beat` then `list()` returns one row with all four fields.
  - a second `beat` with the same `instanceId` and a larger `atMs` updates
    `lastBeatMs` and leaves `list().length === 1` (upsert, not insert).
  - two `beat`s with different `instanceId`s give two rows — a second daemon is
    visible, it does not overwrite the first.
  - `list()` is ordered by `instanceId` ascending regardless of insert order.
- `node --test src/storage/sqlite/migrations.test.ts` — update the existing
  version/count expectations to the new highest version, and add a case
  asserting `daemon_heartbeats` exists with exactly the four columns after a full
  migrate. Follow whatever assertion the file already uses for the latest
  version.
- `node --test src/apps/cli/daemon-summary.test.ts` — must still pass unchanged
  (regression guard on the new optional parameter).
- `npm run verify` exits 0 — including `node src/main.ts db status`, which must
  report the new schema version.
- Proof: `H ok` (with Story 6). This story provides the row that goes stale.

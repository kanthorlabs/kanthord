# Story S1 — the daemon lease

Epic: `.agent/plan/epics/025-serve-hosted-daemon.md` (Decision 3)

## Change

### 1. `src/storage/sqlite/migrations.ts` — append one migration

Version is `head + 1` (**32** at authoring; take the actual head if 022–025 added
migrations first). Insert after the current last migration object, before the
closing `];`:

```ts
  {
    version: 32,
    name: "025-s1-daemon-lease",
    // EPIC 025 Story 1 — single-row daemon ownership. Singleton via
    // `id INTEGER PRIMARY KEY CHECK (id = 1)`, mirroring `ai_provider_default`
    // (migration 22). Unlike `daemon_heartbeats` (migration 29, observation
    // only) this row IS the authority: it is claimed with an atomic
    // `UPDATE ... WHERE (unowned OR expired) RETURNING`. `ownerId` is NULL
    // when free. Plain CREATE TABLE, no FK, no rebuild.
    up: (db) =>
      db.exec(`
CREATE TABLE daemon_lease (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  ownerId     TEXT,
  pid         INTEGER,
  expiresAtMs INTEGER
);
INSERT INTO daemon_lease (id, ownerId, pid, expiresAtMs) VALUES (1, NULL, NULL, NULL);
`),
  },
```

The seed row is part of the migration so a claim is always an `UPDATE`, never an
upsert race.

### 2. `src/storage/port.ts` — add the port

Append after `DaemonHeartbeatRepository` (ends `:458`):

```ts
/** One daemon-lease row. `ownerId` is null when the lease is free. */
export interface DaemonLeaseRow {
  readonly ownerId: string | null;
  readonly pid: number | null;
  readonly expiresAtMs: number | null;
}

/**
 * Single-daemon ownership. Unlike `DaemonHeartbeatRepository` this is the
 * authority, not an observation: `claim` is atomic, so two processes racing it
 * produce exactly one winner.
 */
export interface DaemonLeaseRepository {
  /**
   * Take the lease if it is unowned or expired. Returns true iff THIS caller
   * now owns it. Must be a single `UPDATE ... RETURNING`, never read-then-write.
   */
  claim(input: {
    ownerId: string;
    pid: number;
    nowMs: number;
    ttlMs: number;
  }): boolean;
  /** Extend an owned lease. Returns false if `ownerId` no longer owns it. */
  renew(input: { ownerId: string; nowMs: number; ttlMs: number }): boolean;
  /** Free the lease. A non-owner's release is a no-op, never an error. */
  release(ownerId: string): void;
  /** Current row, for tests and diagnostics. */
  read(): DaemonLeaseRow;
}
```

### 3. `src/storage/sqlite/daemon-lease-repository.ts` (new)

Mirror `src/storage/sqlite/daemon-heartbeat-repository.ts:13-28`: provenance
header comment, statements prepared in the constructor, `readonly #db`.

`claim`:

```sql
UPDATE daemon_lease
   SET ownerId = ?, pid = ?, expiresAtMs = ?
 WHERE id = 1
   AND (ownerId IS NULL OR expiresAtMs IS NULL OR expiresAtMs <= ?)
RETURNING ownerId
```

Bind `(ownerId, pid, nowMs + ttlMs, nowMs)`; return `row !== undefined`.

`renew`: `UPDATE daemon_lease SET expiresAtMs = ? WHERE id = 1 AND ownerId = ?`
→ `result.changes > 0`.

`release`: `UPDATE daemon_lease SET ownerId = NULL, pid = NULL, expiresAtMs = NULL
WHERE id = 1 AND ownerId = ?`.

`read`: `SELECT ownerId, pid, expiresAtMs FROM daemon_lease WHERE id = 1`.

### 4. `src/composition.ts` — lazy construction + expose on `CliDeps`

Statements are prepared in the constructor, so it MUST NOT go in the eager block
at `:190-204`. Mirror the documented lazy pattern at `:693-700`:

```ts
let daemonLeaseRepository: SqliteDaemonLeaseRepository | undefined;
const daemonLease = (): DaemonLeaseRepository => {
  if (daemonLeaseRepository === undefined) {
    daemonLeaseRepository = new SqliteDaemonLeaseRepository(db);
  }
  return daemonLeaseRepository;
};
```

Export `daemonLease` on the returned bundle beside `heartbeat` (`:1240`), and
declare it on `CliDeps` beside `heartbeat` (`src/apps/cli/deps.ts:266`):

```ts
/** EPIC 025 Story 1 — single-daemon ownership; constructed lazily. */
daemonLease: () => DaemonLeaseRepository;
```

## Constraints

- Do **not** reuse `repo_locks` (keyed `(repo_id, branch)`, a different concern)
  and do not extend `daemon_heartbeats` — migration 29 documents it as
  observation only and it must keep tolerating a `multiple` reading.
- `claim` MUST be one statement. `SELECT` then `UPDATE` fails the contention test.
- TTL is supplied by the caller; the repository holds no clock and no default.

## Verify

- `node --test src/storage/sqlite/daemon-lease-repository.test.ts` (new; real
  sqlite temp db via the `makeTempDb()` shape of
  `daemon-heartbeat-repository.test.ts:19-25`, local typed as the port):
  - fresh database reads `{ownerId: null, pid: null, expiresAtMs: null}`;
  - `claim` on a free lease returns `true`; `read().ownerId` is the claimer;
  - a second `claim` with a different `ownerId` while the first is live returns
    `false` and leaves `read().ownerId` unchanged;
  - `claim` succeeds when `nowMs` is past `expiresAtMs`;
  - `renew` by the owner returns `true` and pushes `expiresAtMs` out;
  - `renew` by a non-owner returns `false` and changes nothing;
  - `release` by the owner nulls all three columns; by a non-owner it is a no-op
    and does not throw;
  - after `release`, a different `ownerId` can `claim`.
- `node --test src/storage/sqlite/migrations.test.ts` — add, in the style of
  `:2141-2172`:
  - `daemon_lease` exists with exactly `["id","ownerId","pid","expiresAtMs"]`;
  - `CHECK (id = 1)` rejects `INSERT ... VALUES (2, ...)`;
  - the seed row exists (`SELECT count(*)` is 1);
  - a pre-migration database migrates without loss (slice pattern at `:2212-2258`).
    Update `:72` `userVersion`, the table list at `:70-96` (insert `daemon_lease`
    alphabetically), and the head assertion at `:2180-2192`.
- `npm run verify` exits 0.
- Proof: none directly. S1 is the prerequisite for the `025 ownership ok:` line
  S2 and S3 deliver.

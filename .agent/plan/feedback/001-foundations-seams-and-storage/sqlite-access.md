# SU2 Findings — SQLite access path (Epic 000, maintainer spike)

Date: 2026-07-03. Spike run on **Node v24.12.0** (macOS, arm64).

## Decision

**Chosen library: `node:sqlite` (built-in `DatabaseSync`). No fallback needed** —
`better-sqlite3` was not required and adds a native build dependency for nothing.

- **Required runtime flag: NONE.** The module loads unflagged on Node 24.
- It emits a **non-blocking `ExperimentalWarning`** on stderr
  (`SQLite is an experimental feature and might change at any time`). It does
  not affect behavior or exit codes. If log noise matters, launch with
  `--disable-warning=ExperimentalWarning`; do not suppress warnings globally.

## Exact API calls exercised (all worked)

```js
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(dbPath);        // opens/creates the file
db.exec("PRAGMA journal_mode = wal");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)");
const stmt = db.prepare("INSERT INTO t (v) VALUES (?)");
stmt.run("hello");                           // -> { changes, lastInsertRowid }
db.prepare("SELECT ... ").get() / .all();    // row object / array of rows
db.close();
```

## Observed WAL / busy_timeout behavior

- `PRAGMA journal_mode = wal` sticks: a read-back returns
  `{ journal_mode: 'wal' }`, and a **second `DatabaseSync` connection** to the
  same file also reports `wal` and reads committed rows while the first handle
  is open.
- `PRAGMA busy_timeout = 5000` reads back as `{ timeout: 5000 }`.
- Everything is synchronous (`DatabaseSync`); there is no async driver in
  `node:sqlite` as of Node 24 — acceptable for the daemon's store (single
  process, WAL for the concurrent-reader case).

## Constraint for downstream stories

The dev machine also carries Node 23.x; **`node:sqlite` behavior is verified on
24.x only** — engines already pin `node >= 24`, CI uses Node 24 (SU5). Run the
daemon and tests on 24+.

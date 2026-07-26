import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // FINDING (2026-07-25, unconfirmed): `busy_timeout` is set LAST, so the two
  // PRAGMAs below it run with SQLite's default busy timeout of 0 — if another
  // connection holds a lock at that instant, they fail immediately with
  // SQLITE_BUSY instead of retrying for 5s like every later statement does.
  // Two processes opening the same DB concurrently (daemon + a CLI command) is
  // normal usage, so this is a latent robustness gap, not a test-only concern.
  //
  // Suspected in the intermittent failure of "exact race: exactly one child
  // claims, one sees empty" (src/queue/sqlite.test.ts), where a worker exits
  // non-zero *before* printing "ready" — i.e. it dies inside this function.
  //
  // NOT reordered, because it is NOT proven: 24 concurrent opens of one WAL DB
  // and 24 runs of that test file at 8x concurrency reproduced nothing. Do not
  // "fix" this on a hunch and claim the flake is gone. That test now reports the
  // child's stderr, so the next real failure will say whether this is the cause.
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA busy_timeout=5000");
  return db;
}

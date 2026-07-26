import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const WAL_RETRY_BUDGET_MS = 5000;
const WAL_RETRY_POLL_MS = 10;

/**
 * Switches the connection to WAL, retrying while the change is locked out.
 *
 * `busy_timeout` does NOT cover this: SQLite refuses to change a database's
 * journal mode while another connection has it open and returns SQLITE_BUSY
 * *without* consulting the busy handler, so the timeout set above is ignored
 * here. Two processes opening a brand-new database at the same moment (daemon +
 * a CLI command on first run) therefore raced, and one died inside this function
 * with "database is locked". Once the database is already WAL the statement is a
 * no-op and never contends — only the first-ever open is at risk.
 *
 * History: a 2026-07-25 FINDING suspected pragma ORDER was the cause and
 * correctly refused to reorder without proof. Reordering alone does not fix it;
 * the retry does. Proven by "open waits for a contended lock instead of failing
 * instantly" (open.test.ts), which holds a real lock across the open.
 */
function enableWal(db: DatabaseSync): void {
  const deadline = Date.now() + WAL_RETRY_BUDGET_MS;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));

  for (;;) {
    try {
      db.exec("PRAGMA journal_mode=WAL");
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Only a lock conflict is retryable; anything else is a real fault.
      if (!/database is locked|database table is locked|busy/i.test(message))
        throw err;
      if (Date.now() >= deadline) throw err;
      // Synchronous sleep: openDatabase is sync, so we cannot yield here.
      Atomics.wait(sleeper, 0, 0, WAL_RETRY_POLL_MS);
    }
  }
}

export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // `busy_timeout` first, so it governs every later statement on this connection
  // rather than only the ones after it. Note this is NOT sufficient on its own —
  // see enableWal below.
  db.exec("PRAGMA busy_timeout=5000");
  enableWal(db);
  db.exec("PRAGMA foreign_keys=ON");
  return db;
}

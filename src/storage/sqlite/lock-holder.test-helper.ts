// Holds a write lock on a SQLite file for a bounded time, so a test can prove
// that `openDatabase` waits for a contended lock instead of failing instantly.
// Prints "locked" once the lock is held, then releases after --hold-ms.

import { DatabaseSync } from "node:sqlite";
import process from "node:process";

function parseArgs(args: string[]): { dbPath: string; holdMs: number } {
  let dbPath = "";
  let holdMs = 300;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--db" && i + 1 < args.length) {
      dbPath = args[i + 1]!;
      i++;
    } else if (args[i] === "--hold-ms" && i + 1 < args.length) {
      holdMs = Number(args[i + 1]!);
      i++;
    }
  }

  return { dbPath, holdMs };
}

const { dbPath, holdMs } = parseArgs(process.argv.slice(2));

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout=5000");
db.exec("CREATE TABLE IF NOT EXISTS lock_probe (id INTEGER PRIMARY KEY)");

// BEGIN IMMEDIATE takes a RESERVED lock straight away, which is enough to block
// another connection's `PRAGMA journal_mode=WAL` (that needs EXCLUSIVE).
db.exec("BEGIN IMMEDIATE");
db.exec("INSERT INTO lock_probe (id) VALUES (1)");

process.stdout.write("locked\n");

// Sleep synchronously — the lock must still be held when the parent starts its
// open, so we cannot yield to the event loop here.
const sleeper = new Int32Array(new SharedArrayBuffer(4));
Atomics.wait(sleeper, 0, 0, holdMs);

db.exec("COMMIT");
db.close();
process.exit(0);

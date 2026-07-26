import { existsSync } from "node:fs";
import process from "node:process";
import { openDatabase } from "../storage/sqlite/open.ts";
import { SqliteJobQueue } from "./sqlite.ts";

function parseArgs(args: string[]): {
  dbPath: string;
  barrierFile: string;
  batch: boolean;
} {
  let dbPath = "";
  let barrierFile = "";
  let batch = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--db" && i + 1 < args.length) {
      dbPath = args[i + 1]!;
      i++;
    } else if (args[i] === "--wait-for" && i + 1 < args.length) {
      barrierFile = args[i + 1]!;
      i++;
    } else if (args[i] === "--batch") {
      batch = true;
    }
  }

  return { dbPath, barrierFile, batch };
}

const { dbPath, barrierFile, batch } = parseArgs(process.argv.slice(2));

const db = openDatabase(dbPath);
const queue = new SqliteJobQueue(db);

process.stdout.write("ready\n");

/**
 * Bounded wait for the barrier. Two failure modes made the unbounded tight poll
 * that used to live here hang `npm run verify` indefinitely: the parent deletes
 * the temp dir in its `after` hook, so a worker still waiting can never see the
 * barrier appear; and a spinning child keeps the test-file process alive, so
 * `node --test` never exits even after the test itself has timed out.
 * The 1ms sleep keeps the two workers waking within a millisecond of each other
 * — still a real race for a claim — without burning a core, which under load
 * was starving the very parent that had to write the barrier.
 */
const BARRIER_TIMEOUT_MS = 30_000;
const POLL_MS = 1;
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const barrierDeadline = Date.now() + BARRIER_TIMEOUT_MS;

while (!existsSync(barrierFile)) {
  if (Date.now() >= barrierDeadline) {
    process.stderr.write(
      `barrier ${barrierFile} did not appear within ${BARRIER_TIMEOUT_MS}ms; giving up\n`,
    );
    process.exit(2);
  }
  Atomics.wait(sleeper, 0, 0, POLL_MS);
}

if (batch) {
  let result = queue.claim();
  while (result !== undefined) {
    process.stdout.write(`${result.taskId}\n`);
    result = queue.claim();
  }
} else {
  const result = queue.claim();
  if (result !== undefined) {
    process.stdout.write(`claimed ${result.taskId}\n`);
  } else {
    process.stdout.write("empty\n");
  }
}

process.exit(0);

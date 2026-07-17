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

while (!existsSync(barrierFile)) {
  // tight poll
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

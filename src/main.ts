// Composition root — the ONLY file that imports concrete adapters and wires
// them to use cases and the CLI.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { GetStatus } from "./app/status/get-status.ts";
import { buildProgram } from "./apps/cli/index.ts";
import { MIGRATIONS } from "./storage/sqlite/migrations.ts";
import { SqliteStatusStore } from "./storage/sqlite/sqlite-status-store.ts";

const dbPath = process.env.KANTHORD_DB ?? ".data/kanthord.db";
// A clean checkout has no .data/ — create the parent so SQLite can open.
mkdirSync(dirname(dbPath), { recursive: true });

const store = new SqliteStatusStore(dbPath, MIGRATIONS);
try {
  const program = buildProgram({ getStatus: new GetStatus(store) });
  await program.parseAsync(process.argv);
} finally {
  store.close();
}

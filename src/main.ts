// Composition root — the ONLY file that imports concrete adapters and wires
// them to use cases and the CLI.
import { buildProgram } from "./apps/cli/index.ts";
import { openDatabase } from "./storage/sqlite/open.ts";
import { SqliteStatusStore } from "./storage/sqlite/sqlite-status-store.ts";
import { SqliteMigrator } from "./storage/sqlite/sqlite-migrator.ts";
import { MIGRATIONS } from "./storage/sqlite/migrations.ts";
import { MigrateDb } from "./app/db/migrate-db.ts";
import { GetDbStatus } from "./app/db/get-db-status.ts";

const dbPath = process.env.KANTHORD_DB ?? ".data/kanthord.db";
const db = openDatabase(dbPath);

const migrator = new SqliteMigrator(db, MIGRATIONS);
const store = new SqliteStatusStore(db, dbPath);
const migrateDb = new MigrateDb(migrator);
const getDbStatus = new GetDbStatus(store);

try {
  const program = buildProgram({ migrateDb, getDbStatus });
  await program.parseAsync(process.argv);
} finally {
  store.close();
}

// Composition factory — extracted from main.ts so tests can instantiate deps
// without launching a process. Only this file (and main.ts) import concrete adapters.
import type { RouterDeps } from "./apps/cli/router.ts";
import { openDatabase } from "./storage/sqlite/open.ts";
import { SqliteStatusStore } from "./storage/sqlite/sqlite-status-store.ts";
import { SqliteMigrator } from "./storage/sqlite/sqlite-migrator.ts";
import { MIGRATIONS } from "./storage/sqlite/migrations.ts";
import { MigrateDb } from "./app/db/migrate-db.ts";
import { GetDbStatus } from "./app/db/get-db-status.ts";
import { SqliteProjectRepository } from "./storage/sqlite/sqlite-project-repository.ts";
import { SqliteInitiativeRepository } from "./storage/sqlite/sqlite-initiative-repository.ts";
import { SqliteTaskRepository } from "./storage/sqlite/sqlite-task-repository.ts";
import { SqliteReferenceResolver } from "./storage/sqlite/reference-resolver.ts";
import { SqliteTransactor } from "./storage/sqlite/sqlite-transactor.ts";
import { SqliteEventFeed } from "./events/sqlite.ts";

/**
 * Wire all concrete adapters and return the `RouterDeps` bundle.
 * Called once at program start (and by integration tests).
 */
export function buildDeps(dbPath: string): RouterDeps {
  const db = openDatabase(dbPath);
  const migrator = new SqliteMigrator(db, MIGRATIONS);
  const store = new SqliteStatusStore(db, dbPath);
  const migrateDb = new MigrateDb(migrator);
  const getDbStatus = new GetDbStatus(store);
  const projectRepository = new SqliteProjectRepository(db);
  const initiativeRepository = new SqliteInitiativeRepository(db);
  const taskRepository = new SqliteTaskRepository(db);
  const referenceResolver = new SqliteReferenceResolver(db);
  const events = new SqliteEventFeed(db);
  const transactor = new SqliteTransactor(db);
  return {
    migrateDb,
    getDbStatus,
    projectRepository,
    initiativeRepository,
    taskRepository,
    referenceResolver,
    events,
    transactor,
  };
}

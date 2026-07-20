import type { DbStatus } from "../../app/db/get-db-status.ts";
import type { MigrationReport } from "../../app/db/migrate-db.ts";

/** Result shape returned by both db CLI handlers. */
export interface CliResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

interface DatabaseMigrator {
  execute(): Promise<MigrationReport>;
}

interface DatabaseStatusReader {
  execute(): Promise<DbStatus>;
}

/**
 * Run `db migrate`: apply pending migrations and format the report.
 * On success: one `applied: V name` line per entry, or `up to date`.
 * On throw: applied lines to stdout + error line to stderr, exit 1.
 */
export async function runDbMigrate(
  migrateDb: DatabaseMigrator,
): Promise<CliResult> {
  try {
    const report = await migrateDb.execute();
    const stdout =
      report.applied.length === 0
        ? ["up to date"]
        : report.applied.map((e) => `applied: ${e.version} ${e.name}`);
    return { exitCode: 0, stdout, stderr: [] };
  } catch (err: unknown) {
    const e = err as Record<string, unknown>;
    const applied = Array.isArray(e["applied"])
      ? (e["applied"] as Array<{ version: number; name: string }>)
      : [];
    const failedVersion =
      typeof e["failedVersion"] === "number" ? e["failedVersion"] : 0;
    const failedName =
      typeof e["failedName"] === "string" ? e["failedName"] : "";
    const message = err instanceof Error ? err.message : String(err);

    const stdout = applied.map((a) => `applied: ${a.version} ${a.name}`);
    const stderr = [
      `error: migration ${failedVersion} ${failedName} failed: ${message}`,
    ];
    return { exitCode: 1, stdout, stderr };
  }
}

/**
 * Run `db status`: query the store and format db path, schema, journal_mode,
 * and one line per table.
 */
export async function runDbStatus(
  getDbStatus: DatabaseStatusReader,
): Promise<CliResult> {
  const status = await getDbStatus.execute();
  const stdout: string[] = [
    `db: ${status.dbPath}`,
    `schema: ${status.schemaVersion}`,
    `journal_mode: ${status.journalMode}`,
    ...status.tables.map((t) => `${t.name}: ${t.rows}`),
  ];
  return { exitCode: 0, stdout, stderr: [] };
}

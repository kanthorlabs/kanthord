import { Command } from "commander";

import type { MigrateDb } from "../../app/db/migrate-db.ts";
import type { GetDbStatus } from "../../app/db/get-db-status.ts";
import { runGraphCheck } from "./graph-check.ts";
import { runDbMigrate, runDbStatus } from "./db.ts";

/** Use cases the CLI drives. Constructed in main.ts and injected here. */
export interface CliDeps {
  migrateDb: MigrateDb;
  getDbStatus: GetDbStatus;
}

/** Build the `kanthord` command tree. Thin: parse, call use case, format. */
export function buildProgram(deps: CliDeps): Command {
  const program = new Command();
  program.name("kanthord").description("kanthord daemon CLI");

  // ------------------------------------------------------------------
  // check group
  // ------------------------------------------------------------------
  const check = new Command("check").description("validation commands");

  check
    .command("graph")
    .description("validate a task graph YAML file and print readiness")
    .requiredOption("--path <file>", "path to the graph YAML file")
    .action(async (opts: { path: string }) => {
      const result = await runGraphCheck(opts.path);
      for (const line of result.stdout) {
        process.stdout.write(line + "\n");
      }
      for (const line of result.stderr) {
        process.stderr.write(line + "\n");
      }
      process.exitCode = result.exitCode;
    });

  program.addCommand(check);

  // ------------------------------------------------------------------
  // db group
  // ------------------------------------------------------------------
  const db = new Command("db").description("database commands");

  db.command("migrate")
    .description("apply pending migrations")
    .action(async () => {
      const result = await runDbMigrate(deps.migrateDb);
      for (const line of result.stdout) {
        process.stdout.write(line + "\n");
      }
      for (const line of result.stderr) {
        process.stderr.write(line + "\n");
      }
      process.exitCode = result.exitCode;
    });

  db.command("status")
    .description("print database status")
    .action(async () => {
      const result = await runDbStatus(deps.getDbStatus);
      for (const line of result.stdout) {
        process.stdout.write(line + "\n");
      }
      for (const line of result.stderr) {
        process.stderr.write(line + "\n");
      }
      process.exitCode = result.exitCode;
    });

  program.addCommand(db);

  return program;
}

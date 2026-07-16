import { Command } from "commander";

import type { GetStatus } from "../../app/status/get-status.ts";

/** Use cases the CLI drives. Constructed in main.ts and injected here. */
export interface CliDeps {
  getStatus: GetStatus;
}

/** Build the `kanthord` command tree. Thin: parse, call use case, format. */
export function buildProgram(deps: CliDeps): Command {
  const program = new Command();
  program.name("kanthord").description("kanthord daemon CLI");

  program
    .command("status")
    .description("show the database path, schema version, journal mode, task count")
    .action(() => {
      const s = deps.getStatus.execute();
      process.stdout.write(
        `db: ${s.dbPath}\n` +
          `schema: ${s.schemaVersion}\n` +
          `journal_mode: ${s.journalMode}\n` +
          `tasks: ${s.taskCount}\n`,
      );
    });

  return program;
}

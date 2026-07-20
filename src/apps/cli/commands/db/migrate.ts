import { Command } from "commander";

import type { MigrationReport } from "../../../../app/db/migrate-db.ts";
import { runDbMigrate } from "../../db.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildDbMigrateCommand(
  deps: { migrateDb: { execute(): Promise<MigrationReport> } },
  io: CliIo,
): Command {
  return new Command("migrate")
    .description("Apply pending database migrations.")
    .configureHelp({ commandUsage: () => "kanthord db migrate" })
    .addHelpText("after", "\nExample:\n  kanthord db migrate\n")
    .action(async () => {
      emitResult(await runDbMigrate(deps.migrateDb), io);
    });
}

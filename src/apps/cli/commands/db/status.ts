import { Command } from "commander";

import type { DbStatus } from "../../../../app/db/get-db-status.ts";
import { runDbStatus } from "../../db.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildDbStatusCommand(
  deps: { getDbStatus: { execute(): Promise<DbStatus> } },
  io: CliIo,
): Command {
  return new Command("status")
    .description("Show the current database status.")
    .configureHelp({ commandUsage: () => "kanthord db status" })
    .addHelpText("after", "\nExample:\n  kanthord db status\n")
    .action(async () => {
      emitResult(await runDbStatus(deps.getDbStatus), io);
    });
}

import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import { buildDbMigrateCommand } from "./db/migrate.ts";
import { buildDbStatusCommand } from "./db/status.ts";
import type { CliIo } from "./action.ts";

export { buildDbMigrateCommand } from "./db/migrate.ts";
export { buildDbStatusCommand } from "./db/status.ts";

export function buildDbCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("db")
    .description("Manage the kanthord database.")
    .showHelpAfterError()
    .addCommand(buildDbMigrateCommand(deps, io))
    .addCommand(buildDbStatusCommand(deps, io));
}

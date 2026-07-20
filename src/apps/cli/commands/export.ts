import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildExportDiagnosticCommand } from "./export/diagnostic.ts";
import { buildExportInitiativeCommand } from "./export/initiative.ts";

export function buildExportCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("export")
    .name("kanthord export")
    .description("Export kanthord data.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildExportInitiativeCommand(deps, io));
  command.addCommand(buildExportDiagnosticCommand(deps, io));

  return command;
}

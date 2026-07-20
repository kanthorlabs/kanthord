import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildImportGraphCommand } from "./import/graph.ts";
import { buildImportResourceCommand } from "./import/resource.ts";

export function buildImportCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("import")
    .name("kanthord import")
    .description("Import resources and graph packages.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildImportResourceCommand(deps, io));
  command.addCommand(buildImportGraphCommand(deps, io));

  return command;
}

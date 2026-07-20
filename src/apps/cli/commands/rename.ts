import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildRenameInitiativeCommand } from "./rename/initiative.ts";
import { buildRenameObjectiveCommand } from "./rename/objective.ts";
import { buildRenameProjectCommand } from "./rename/project.ts";

export function buildRenameCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("rename")
    .name("kanthord rename")
    .description("Rename kanthord resources.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildRenameProjectCommand(deps, io));
  command.addCommand(buildRenameInitiativeCommand(deps, io));
  command.addCommand(buildRenameObjectiveCommand(deps, io));

  return command;
}

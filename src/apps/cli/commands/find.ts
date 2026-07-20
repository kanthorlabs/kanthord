import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildFindInitiativeCommand } from "./find/initiative.ts";
import { buildFindObjectiveCommand } from "./find/objective.ts";
import { buildFindProjectCommand } from "./find/project.ts";
import { buildFindResourceCommand } from "./find/resource.ts";

export function buildFindCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("find")
    .name("kanthord find")
    .description("Find kanthord resource IDs by name.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildFindProjectCommand(deps, io));
  command.addCommand(buildFindInitiativeCommand(deps, io));
  command.addCommand(buildFindObjectiveCommand(deps, io));
  command.addCommand(buildFindResourceCommand(deps, io));

  return command;
}

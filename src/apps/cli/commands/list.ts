import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildListInitiativeCommand } from "./list/initiative.ts";
import { buildListEventCommand } from "./list/event.ts";
import { buildListModelCommand } from "./list/model.ts";
import { buildListObjectiveCommand } from "./list/objective.ts";
import { buildListTaskCommand } from "./list/task.ts";
import {
  buildListCredentialCommand,
  buildListAiProviderCommand,
  buildListRepositoryCommand,
} from "./list/resource.ts";

export function buildListCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("list")
    .name("kanthord list")
    .description("List kanthord resources.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildListTaskCommand(deps, io));
  command.addCommand(buildListInitiativeCommand(deps, io));
  command.addCommand(buildListObjectiveCommand(deps, io));
  command.addCommand(buildListEventCommand(deps, io));
  command.addCommand(buildListModelCommand(deps, io));
  command.addCommand(buildListCredentialCommand(deps, io));
  command.addCommand(buildListAiProviderCommand(deps, io));
  command.addCommand(buildListRepositoryCommand(deps, io));

  return command;
}

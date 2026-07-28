import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildGetProjectCommand } from "./get/project.ts";
import { buildGetResourceCommand } from "./get/resource.ts";
import { buildGetTaskCommand } from "./get/task.ts";
import { buildGetConflictCommand } from "./get/conflict.ts";
import { buildGetInitiativeCommand } from "./get/initiative.ts";
import { buildGetObjectiveCommand } from "./get/objective.ts";
import { buildGetRepositoryCommand } from "./get/repository.ts";
import { buildGetAiProviderCommand } from "./get/ai-provider.ts";
import { buildGetGraphCommand } from "./get/graph.ts";
import { buildGetOverviewCommand } from "./get/overview.ts";

export function buildGetCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("get")
    .name("kanthord get")
    .description("Get kanthord resources.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildGetTaskCommand(deps, io));
  command.addCommand(buildGetProjectCommand(deps, io));
  command.addCommand(buildGetResourceCommand(deps, io));
  command.addCommand(buildGetConflictCommand(deps, io));
  command.addCommand(buildGetInitiativeCommand(deps, io));
  command.addCommand(buildGetObjectiveCommand(deps, io));
  command.addCommand(buildGetRepositoryCommand(deps, io));
  command.addCommand(buildGetAiProviderCommand(deps, io));
  command.addCommand(buildGetGraphCommand(deps, io));
  command.addCommand(buildGetOverviewCommand(deps, io));

  return command;
}

import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildCreateAiProviderCommand } from "./create/ai-provider.ts";
import { buildCreateCredentialCommand } from "./create/credential.ts";
import { buildCreateFilesystemCommand } from "./create/filesystem.ts";
import { buildCreateInitiativeCommand } from "./create/initiative.ts";
import { buildCreateNotificationCommand } from "./create/notification.ts";
import { buildCreateObjectiveCommand } from "./create/objective.ts";
import { buildCreateProjectCommand } from "./create/project.ts";
import { buildCreateRepositoryCommand } from "./create/repository.ts";
import { buildCreateTaskCommand } from "./create/task.ts";

export function buildCreateCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("create")
    .name("kanthord create")
    .description("Create kanthord resources.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildCreateProjectCommand(deps, io));
  command.addCommand(buildCreateInitiativeCommand(deps, io));
  command.addCommand(buildCreateObjectiveCommand(deps, io));
  command.addCommand(buildCreateNotificationCommand(deps, io));
  command.addCommand(buildCreateFilesystemCommand(deps, io));
  command.addCommand(buildCreateAiProviderCommand(deps, io));
  command.addCommand(buildCreateRepositoryCommand(deps, io));
  command.addCommand(buildCreateCredentialCommand(deps, io));
  command.addCommand(buildCreateTaskCommand(deps, io));

  return command;
}

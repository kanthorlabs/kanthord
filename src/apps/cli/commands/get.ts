import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildGetProjectCommand } from "./get/project.ts";
import { buildGetResourceCommand } from "./get/resource.ts";
import { buildGetTaskCommand } from "./get/task.ts";
import { buildGetConflictCommand } from "./get/conflict.ts";

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

  return command;
}

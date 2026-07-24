import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildRetryTaskCommand } from "./retry/task.ts";
import { buildRetryObjectiveCommand } from "./retry/objective.ts";

export function buildRetryCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("retry")
    .name("kanthord retry")
    .description("Retry kanthord resources.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildRetryTaskCommand(deps, io));
  command.addCommand(buildRetryObjectiveCommand(deps, io));

  return command;
}

import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildRemoveDependencyCommand } from "./remove/dependency.ts";

export function buildRemoveCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("remove")
    .name("kanthord remove")
    .description("Remove kanthord resource relationships.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildRemoveDependencyCommand(deps, io));

  return command;
}

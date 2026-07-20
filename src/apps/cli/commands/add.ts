import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildAddDependencyCommand } from "./add/dependency.ts";

export function buildAddCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("add")
    .name("kanthord add")
    .description("Add kanthord resource relationships.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildAddDependencyCommand(deps, io));

  return command;
}

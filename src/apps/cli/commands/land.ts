import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildLandRepositoryCommand } from "./land/repository.ts";

export function buildLandCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("land")
    .name("kanthord land")
    .description("Land kanthord changes.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildLandRepositoryCommand(deps, io));

  return command;
}

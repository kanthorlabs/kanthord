import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildPublishRepositoryCommand } from "./publish/repository.ts";

export function buildPublishCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("publish")
    .name("kanthord publish")
    .description("Publish kanthord changes to a remote.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildPublishRepositoryCommand(deps, io));

  return command;
}

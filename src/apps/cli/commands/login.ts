import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildLoginProviderCommand } from "./login/provider.ts";

export function buildLoginCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("login")
    .name("kanthord login")
    .description("Log in to an external provider.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildLoginProviderCommand(deps, io));

  return command;
}

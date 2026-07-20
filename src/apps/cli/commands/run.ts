import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildRunDaemonCommand } from "./run/daemon.ts";

export function buildRunCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("run")
    .name("kanthord run")
    .description("Run kanthord processes.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildRunDaemonCommand(deps, io));

  return command;
}

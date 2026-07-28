import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildAbandonTaskCommand } from "./abandon/task.ts";

export function buildAbandonCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("abandon")
    .name("kanthord abandon")
    .description("Abandon a kanthord resource (task = revoke + requeue).")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildAbandonTaskCommand(deps, io));

  return command;
}

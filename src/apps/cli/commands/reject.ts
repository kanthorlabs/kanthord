import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildRejectTaskCommand } from "./reject/task.ts";

export function buildRejectCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("reject")
    .name("kanthord reject")
    .description("Reject kanthord resources.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildRejectTaskCommand(deps, io));

  return command;
}

import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildApproveTaskCommand } from "./approve/task.ts";

export function buildApproveCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("approve")
    .name("kanthord approve")
    .description("Approve kanthord resources.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildApproveTaskCommand(deps, io));

  return command;
}

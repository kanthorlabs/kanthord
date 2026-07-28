import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildAckProjectCommand } from "./ack/project.ts";

export function buildAckCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("ack")
    .name("kanthord ack")
    .description("Acknowledge kanthord activity.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildAckProjectCommand(deps, io));

  return command;
}

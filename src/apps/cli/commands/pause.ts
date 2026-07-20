import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildPauseInitiativeCommand } from "./pause/initiative.ts";

export function buildPauseCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("pause")
    .name("kanthord pause")
    .description("Pause kanthord resources.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildPauseInitiativeCommand(deps, io));

  return command;
}

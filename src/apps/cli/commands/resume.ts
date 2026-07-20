import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildResumeInitiativeCommand } from "./resume/initiative.ts";

export function buildResumeCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("resume")
    .name("kanthord resume")
    .description("Resume kanthord resources.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildResumeInitiativeCommand(deps, io));

  return command;
}

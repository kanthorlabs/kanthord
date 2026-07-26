// src/apps/cli/commands/assign.ts — `assign` verb group (008.2 Story B).

import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildAssignAiProviderCommand } from "./assign/ai-provider.ts";

export function buildAssignCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("assign")
    .name("kanthord assign")
    .description("Assign resources to projects.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildAssignAiProviderCommand(deps, io));

  return command;
}

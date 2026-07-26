// src/apps/cli/commands/unassign.ts — `unassign` verb group (008.2 Story B).

import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildUnassignAiProviderCommand } from "./unassign/ai-provider.ts";

export function buildUnassignCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("unassign")
    .name("kanthord unassign")
    .description("Unassign resources from projects.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildUnassignAiProviderCommand(deps, io));

  return command;
}

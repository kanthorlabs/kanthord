// src/apps/cli/commands/set-default.ts — `set-default` verb group (008.1 Story C).

import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildSetDefaultAiProviderCommand } from "./set-default/ai-provider.ts";

export function buildSetDefaultCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("set-default")
    .name("kanthord set-default")
    .description("Set default global resources.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildSetDefaultAiProviderCommand(deps, io));

  return command;
}

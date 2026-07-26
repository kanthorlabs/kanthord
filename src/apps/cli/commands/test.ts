// src/apps/cli/commands/test.ts — `test` verb group (008.1 Story D).

import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildTestAiProviderCommand } from "./test/ai-provider.ts";

export function buildTestCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("test")
    .name("kanthord test")
    .description("Test resources.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildTestAiProviderCommand(deps, io));

  return command;
}

// src/apps/cli/commands/register.ts — `register` verb group (008.1 Story C).

import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildRegisterAiProviderCommand } from "./register/ai-provider.ts";

export function buildRegisterCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("register")
    .name("kanthord register")
    .description("Register global resources.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildRegisterAiProviderCommand(deps, io));

  return command;
}

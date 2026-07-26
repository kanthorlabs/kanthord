// src/apps/cli/commands/logout.ts — `logout` verb group (008.1 Story D).

import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildLogoutAiProviderCommand } from "./logout/ai-provider.ts";

export function buildLogoutCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("logout")
    .name("kanthord logout")
    .description("Logout global resources.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildLogoutAiProviderCommand(deps, io));

  return command;
}

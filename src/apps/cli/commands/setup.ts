// src/apps/cli/commands/setup.ts — EPIC 015 Story 5
// The `kanthord setup` command group. Mirrors
// `src/apps/cli/commands/run.ts:7-19` exactly (substituting `setup` for
// `run`): a `new Command("setup")` with a `preSubcommand` `copyInheritedSettings`
// hook plus one `addCommand(buildSetupProjectCommand(...))`.

import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildSetupProjectCommand } from "./setup/project.ts";

export function buildSetupCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("setup")
    .name("kanthord setup")
    .description("Guided setup commands.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildSetupProjectCommand(deps, io));

  return command;
}

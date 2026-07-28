import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import { buildCheckGraphCommand } from "./check/graph.ts";
import { buildCheckProjectCommand } from "./check/project.ts";
import type { CliIo } from "./action.ts";

export function buildCheckCommand(deps: CliDeps, io: CliIo): Command {
  const command = new Command("check")
    .name("check")
    .description("Check command output.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildCheckGraphCommand(deps, io));
  command.addCommand(buildCheckProjectCommand(deps, io));

  return command;
}

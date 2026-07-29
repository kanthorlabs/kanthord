import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import type { CliIo } from "./action.ts";
import { buildUpdateAiProviderCommand } from "./update/ai-provider.ts";
import { buildUpdateCredentialCommand } from "./update/credential.ts";
import { buildUpdateFilesystemCommand } from "./update/filesystem.ts";
import { buildUpdateNotificationCommand } from "./update/notification.ts";
import { buildUpdateRepositoryCommand } from "./update/repository.ts";

type UpdateDeps = Pick<
  CliDeps,
  | "updateCredential"
  | "updateRepository"
  | "updateNotification"
  | "updateFilesystem"
  | "updateAiProvider"
>;

export function buildUpdateCommand(deps: UpdateDeps, io: CliIo): Command {
  const command = new Command("update")
    .name("kanthord update")
    .description("Update kanthord resources.")
    .showHelpAfterError();

  command.hook("preSubcommand", (_parent, child) => {
    child.copyInheritedSettings(command);
  });
  command.addCommand(buildUpdateCredentialCommand(deps, io));
  command.addCommand(buildUpdateRepositoryCommand(deps, io));
  command.addCommand(buildUpdateNotificationCommand(deps, io));
  command.addCommand(buildUpdateFilesystemCommand(deps, io));
  command.addCommand(buildUpdateAiProviderCommand(deps, io));

  return command;
}

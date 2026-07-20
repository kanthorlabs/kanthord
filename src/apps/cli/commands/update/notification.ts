import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runUpdateNotification } from "../../resource.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

type UpdateNotificationDeps = Pick<CliDeps, "updateNotification">;

export function buildUpdateNotificationCommand(
  deps: UpdateNotificationDeps,
  io: CliIo,
): Command {
  return new Command("notification")
    .description("Update a notification resource.")
    .configureHelp({ commandUsage: () => "kanthord update notification" })
    .requiredOption("--id <id>", "ID of the notification resource to update")
    .option("--name <name>", "new name for the notification")
    .option("--destination <destination>", "new provider destination")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord update notification --id notification-1 --destination '#ops'\n",
    )
    .action(
      async (opts: { id: string; name?: string; destination?: string }) => {
        emitResult(
          await runUpdateNotification(
            { id: opts.id, name: opts.name, destination: opts.destination },
            deps.updateNotification,
          ),
          io,
        );
      },
    );
}

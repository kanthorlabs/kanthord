import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runCreateNotification } from "../../resource.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildCreateNotificationCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("notification")
    .description("Create a notification resource.")
    .configureHelp({ commandUsage: () => "kanthord create notification" })
    .requiredOption("--project <id>", "project that owns the notification")
    .requiredOption("--name <name>", "name for the notification")
    .requiredOption(
      "--provider <provider>",
      "notification provider: slack or telegram",
    )
    .requiredOption("--destination <destination>", "provider destination")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord create notification --project project-1 --name alerts --provider slack --destination '#ops'\n",
    )
    .action(
      async (opts: {
        project: string;
        name: string;
        provider: string;
        destination: string;
      }) => {
        emitResult(
          await runCreateNotification(
            {
              project: opts.project,
              name: opts.name,
              provider: opts.provider,
              destination: opts.destination,
            },
            deps.addResource,
          ),
          io,
        );
      },
    );
}

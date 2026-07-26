// src/apps/cli/commands/logout/ai-provider.ts — CLI leaf for `logout ai-provider`
// (008.1 Story D: credential lifecycle — logout CLI verb).

import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runLogoutAiProvider } from "../../ai-provider.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildLogoutAiProviderCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("ai-provider")
    .description("Logout a global AI provider.")
    .configureHelp({ commandUsage: () => "kanthord logout ai-provider" })
    .requiredOption("--id <id>", "ID of the AI provider")
    .option(
      "--replacement <id>",
      "Replacement provider ID (required if logging out the default)",
    )
    .option(
      "--confirm-no-default",
      "Confirm logging out the default with no replacement, leaving no default",
    )
    .addHelpText(
      "after",
      "\nExample:\n  kanthord logout ai-provider --id <id>\n",
    )
    .action(
      async (opts: {
        id: string;
        replacement?: string;
        confirmNoDefault?: boolean;
      }) => {
        let record;
        try {
          record = deps.getAiProvider.execute(opts.id);
        } catch {
          record = undefined;
        }
        emitResult(
          runLogoutAiProvider(
            {
              id: opts.id,
              ...(opts.replacement ? { replacement: opts.replacement } : {}),
              ...(opts.confirmNoDefault ? { confirmNoDefault: true } : {}),
            },
            deps.logoutAiProvider,
            record
              ? { name: record.name, provider: record.provider }
              : undefined,
          ),
          io,
        );
      },
    );
}

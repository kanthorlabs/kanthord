// src/apps/cli/commands/remove/ai-provider.ts — CLI leaf for `remove ai-provider`
// (008.1 Story D: credential lifecycle — remove CLI verb).

import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runRemoveAiProvider } from "../../ai-provider.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildRemoveAiProviderCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("ai-provider")
    .description("Remove a global AI provider.")
    .configureHelp({ commandUsage: () => "kanthord remove ai-provider" })
    .requiredOption("--id <id>", "ID of the AI provider")
    .option(
      "--replacement <id>",
      "Replacement provider ID (required if removing the default)",
    )
    .option(
      "--confirm-no-default",
      "Confirm removing the default with no replacement, leaving no default",
    )
    .addHelpText(
      "after",
      "\nExample:\n  kanthord remove ai-provider --id <id>\n",
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
          runRemoveAiProvider(
            {
              id: opts.id,
              ...(opts.replacement ? { replacement: opts.replacement } : {}),
              ...(opts.confirmNoDefault ? { confirmNoDefault: true } : {}),
            },
            deps.removeAiProvider,
            record
              ? { name: record.name, provider: record.provider }
              : undefined,
          ),
          io,
        );
      },
    );
}

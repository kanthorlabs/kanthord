import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runUpdateAiProvider } from "../../resource.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

type UpdateAiProviderDeps = Pick<CliDeps, "updateAiProvider">;

export function buildUpdateAiProviderCommand(
  deps: UpdateAiProviderDeps,
  io: CliIo,
): Command {
  return new Command("ai-provider")
    .description("Update an AI provider resource.")
    .configureHelp({ commandUsage: () => "kanthord update ai-provider" })
    .requiredOption("--id <id>", "ID of the AI provider resource to update")
    .option("--name <name>", "new name for the AI provider")
    .option("--model <model>", "new model identifier")
    .option(
      "--effort <effort>",
      "new reasoning effort: minimal, low, medium, high, or xhigh",
    )
    .option("--clear-effort", "remove the configured reasoning effort")
    .option("--clear-base-url", "remove the configured provider base URL")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord update ai-provider --id provider-1 --model gpt-5.6-terra --effort high\n",
    )
    .action(
      async (opts: {
        id: string;
        name?: string;
        model?: string;
        effort?: string;
        clearEffort?: boolean;
        clearBaseUrl?: boolean;
      }) => {
        emitResult(
          await runUpdateAiProvider(
            {
              id: opts.id,
              name: opts.name,
              model: opts.model,
              effort: opts.effort,
              "clear-effort": opts.clearEffort,
              "clear-base-url": opts.clearBaseUrl,
            },
            deps.updateAiProvider,
          ),
          io,
        );
      },
    );
}

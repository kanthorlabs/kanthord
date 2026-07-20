import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runCreateAiProvider } from "../../resource.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildCreateAiProviderCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("ai-provider")
    .description("Create an AI provider resource.")
    .configureHelp({ commandUsage: () => "kanthord create ai-provider" })
    .requiredOption("--project <id>", "project that owns the AI provider")
    .requiredOption("--name <name>", "name for the AI provider")
    .requiredOption("--provider <provider>", "AI provider")
    .requiredOption("--model <model>", "model identifier")
    .option(
      "--effort <effort>",
      "reasoning effort: minimal, low, medium, high, or xhigh",
    )
    .addHelpText(
      "after",
      "\nExample:\n  kanthord create ai-provider --project project-1 --name primary --provider openai-codex --model gpt-5.6-terra --effort high\n",
    )
    .action(
      async (opts: {
        project: string;
        name: string;
        provider: string;
        model: string;
        effort?: string;
      }) => {
        emitResult(
          await runCreateAiProvider(
            {
              project: opts.project,
              name: opts.name,
              provider: opts.provider,
              model: opts.model,
              effort: opts.effort,
            },
            deps.addResource,
          ),
          io,
        );
      },
    );
}

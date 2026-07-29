import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runUpdateAiProvider } from "../../ai-provider.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

type UpdateAiProviderDeps = Pick<CliDeps, "updateAiProvider">;

export function buildUpdateAiProviderCommand(
  deps: UpdateAiProviderDeps,
  io: CliIo,
): Command {
  return new Command("ai-provider")
    .description("Update a registered AI provider.")
    .configureHelp({ commandUsage: () => "kanthord update ai-provider" })
    .requiredOption("--id <id>", "ID of the AI provider to update")
    .option("--model <model>", "new model identifier")
    .option("--base-url <url>", "new base URL for the provider API")
    .option("--effort <effort>", "new reasoning effort")
    .option(
      "--api <flavor>",
      "new API flavor for custom OpenAI-compatible providers (openai-completions|openai-responses)",
    )
    .option("--context-window <n>", "new context window token count")
    .option("--max-tokens <n>", "new max output tokens")
    .option(
      "--allow-insecure",
      "allow plain HTTP or private-network base URL for custom providers",
    )
    .option("--value-file <path|->", "credential file, or - for standard input")
    .option(
      "--value-timeout <duration>",
      "credential read timeout, such as 30s",
    )
    .addHelpText(
      "after",
      "\nExample:\n  kanthord update ai-provider --id aip-1 --model gpt-5.6-terra\n",
    )
    .action(
      async (opts: {
        id: string;
        model?: string;
        baseUrl?: string;
        effort?: string;
        api?: string;
        contextWindow?: string;
        maxTokens?: string;
        allowInsecure?: boolean;
        valueFile?: string;
        valueTimeout?: string;
      }) => {
        const reader = {
          tty: process.stdin.isTTY ? process.stdin : undefined,
          stdin: process.stdin,
        };
        emitResult(
          await runUpdateAiProvider(
            {
              id: opts.id,
              model: opts.model,
              baseUrl: opts.baseUrl,
              effort: opts.effort,
              api: opts.api,
              contextWindow: opts.contextWindow,
              maxTokens: opts.maxTokens,
              allowInsecure: opts.allowInsecure,
              valueFile: opts.valueFile,
              "value-timeout": opts.valueTimeout,
            },
            deps.updateAiProvider,
            reader,
          ),
          io,
        );
      },
    );
}

// src/apps/cli/commands/register/ai-provider.ts — CLI leaf for `register ai-provider`
// (008.1 Story C: CLI register verb with --name --provider --model --base-url
// --effort --value-file).

import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runRegisterAiProvider } from "../../ai-provider.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildRegisterAiProviderCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("ai-provider")
    .description("Register a global AI provider.")
    .configureHelp({ commandUsage: () => "kanthord register ai-provider" })
    .requiredOption("--name <name>", "Name for the AI provider")
    .option(
      "--provider <provider>",
      "Provider identifier (required for builtin providers; optional when --api is set)",
    )
    .requiredOption("--model <model>", "Model identifier")
    .option("--base-url <url>", "Base URL for the provider API")
    .option("--effort <effort>", "Reasoning effort")
    .option(
      "--api <flavor>",
      "API flavor for custom OpenAI-compatible providers (openai-completions|openai-responses)",
    )
    .option(
      "--custom-provider-id <id>",
      "Provider id override for custom providers (effective provider in the registry)",
    )
    .option(
      "--context-window <n>",
      "Context window token count for custom providers (default 32768)",
    )
    .option(
      "--max-tokens <n>",
      "Max output tokens for custom providers (default 4096)",
    )
    .option(
      "--allow-insecure",
      "Allow plain HTTP or private-network base URL for custom providers",
    )
    .requiredOption(
      "--value-file <path>",
      "Path to file containing the credential value (use - for stdin)",
    )
    .addHelpText(
      "after",
      "\nExample:\n  kanthord register ai-provider --name alpha --provider openai-codex --model gpt-5.6-terra --value-file ./secret.txt\n",
    )
    .action(
      async (opts: {
        name: string;
        provider: string;
        model: string;
        baseUrl?: string;
        effort?: string;
        valueFile: string;
        api?: string;
        customProviderId?: string;
        contextWindow?: string;
        maxTokens?: string;
        allowInsecure?: boolean;
      }) => {
        emitResult(
          await runRegisterAiProvider(
            {
              name: opts.name,
              provider: opts.provider,
              model: opts.model,
              ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
              ...(opts.effort ? { effort: opts.effort } : {}),
              ...(opts.api ? { api: opts.api } : {}),
              ...(opts.customProviderId
                ? { customProviderId: opts.customProviderId }
                : {}),
              ...(opts.contextWindow
                ? { contextWindow: opts.contextWindow }
                : {}),
              ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
              ...(opts.allowInsecure
                ? { allowInsecure: opts.allowInsecure }
                : {}),
              valueFile: opts.valueFile,
            },
            deps.registerAiProvider,
          ),
          io,
        );
      },
    );
}

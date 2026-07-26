// src/apps/cli/commands/test/ai-provider.ts — CLI leaf for `test ai-provider`
// (008.1 Story D: one-shot completion test of an AI provider).

import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runTestAiProvider } from "../../ai-provider.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildTestAiProviderCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("ai-provider")
    .description(
      "Test an AI provider by sending a prompt and printing the response.",
    )
    .configureHelp({ commandUsage: () => "kanthord test ai-provider" })
    .requiredOption("--id <id>", "AI provider id")
    .option(
      "--prompt <text>",
      "Prompt to send to the model",
      "What is today's datetime?",
    )
    .addHelpText(
      "after",
      "\nExample:\n  kanthord test ai-provider --id 01ABCDEFGHIJKLMNOPQRSTUVWX\n",
    )
    .action(async (opts: { id: string; prompt: string }) => {
      emitResult(
        await runTestAiProvider(
          { id: opts.id, prompt: opts.prompt },
          deps.testAiProvider,
        ),
        io,
      );
    });
}

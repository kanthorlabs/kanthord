// src/apps/cli/commands/get/ai-provider.ts — CLI leaf for `get ai-provider --id`
// (008.1 Story C: read/register CLI).

import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runGetAiProvider } from "../../ai-provider.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildGetAiProviderCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("ai-provider")
    .description("Get a global AI provider.")
    .configureHelp({ commandUsage: () => "kanthord get ai-provider" })
    .requiredOption("--id <id>", "ID of the AI provider")
    .option("--json", "print the AI provider as JSON")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord get ai-provider --id <id> --json\n",
    )
    .action(async (opts: { id: string; json?: boolean }) => {
      emitResult(
        runGetAiProvider(
          { id: opts.id, ...(opts.json ? { json: true } : {}) },
          deps.getAiProvider,
        ),
        io,
      );
    });
}

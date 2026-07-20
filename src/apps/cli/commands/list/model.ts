import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runGetModels } from "../../models.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildListModelCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("model")
    .description("List available AI models.")
    .configureHelp({ commandUsage: () => "kanthord list model" })
    .option("--provider <provider>", "limit models to an AI provider")
    .option("--json", "print models as JSON")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord list model --provider openai-codex --json\n",
    )
    .action((opts: { provider?: string; json?: boolean }) => {
      emitResult(
        runGetModels(
          {
            ...(opts.provider ? { provider: opts.provider } : {}),
            ...(opts.json ? { json: true } : {}),
          },
          deps.listModels,
        ),
        io,
      );
    });
}

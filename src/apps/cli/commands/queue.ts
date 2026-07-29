import { Command } from "commander";

import type { CliDeps } from "../deps.ts";
import { runQueueList } from "../queue.ts";
import { emitResult } from "./action.ts";
import type { CliIo } from "./action.ts";

export function buildQueueCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("queue")
    .description("List every decision waiting on a human, ranked by impact.")
    .configureHelp({ commandUsage: () => "kanthord queue" })
    .option("--json", "print the queue as JSON")
    .option("--limit <n>", "maximum items to print")
    .addHelpText("after", "\nExample:\n  kanthord queue --json\n")
    .action(async (opts: { json?: boolean; limit?: string }) => {
      emitResult(
        await runQueueList(
          {
            ...(opts.json ? { json: true } : {}),
            ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
          },
          deps.getDecisionQueue,
        ),
        io,
      );
    });
}

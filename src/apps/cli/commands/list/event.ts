import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runEvents } from "../../events.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildListEventCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("event")
    .description("List task events after a cursor.")
    .configureHelp({ commandUsage: () => "kanthord list event" })
    .requiredOption("--after <cursor>", "event cursor to start after")
    .option("--limit <count>", "maximum events to read per page")
    .option("--json", "print events as newline-delimited JSON")
    .option("--follow", "keep polling for new events")
    .option("--poll-interval <ms>", "milliseconds to wait between polls")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord list event --after 0 --json\n",
    )
    .action(
      async (opts: {
        after: string;
        limit?: string;
        json?: boolean;
        follow?: boolean;
        pollInterval?: string;
      }) => {
        const ac = new AbortController();
        const onSigint = () => ac.abort();
        process.once("SIGINT", onSigint);
        try {
          emitResult(
            await runEvents(
              {
                after: opts.after,
                ...(opts.limit ? { limit: opts.limit } : {}),
                ...(opts.json ? { json: true } : {}),
                ...(opts.follow ? { follow: true } : {}),
                ...(opts.pollInterval
                  ? { "poll-interval": opts.pollInterval }
                  : {}),
              },
              deps.listEvents,
              (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
              ac.signal,
            ),
            io,
          );
        } finally {
          process.removeListener("SIGINT", onSigint);
        }
      },
    );
}

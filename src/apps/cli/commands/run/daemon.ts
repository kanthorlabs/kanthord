import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runDaemon } from "../../daemon.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildRunDaemonCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("daemon")
    .description("Run the kanthord daemon.")
    .configureHelp({ commandUsage: () => "kanthord run daemon" })
    .option(
      "--fail <id>",
      "task ID to fail; repeat for each task",
      (value, values: string[]) => (values.push(value), values),
      [],
    )
    .option(
      "--fail-transient <id:count>",
      "task ID to fail transiently <count> times then succeed; repeat for each task",
      (value, values: string[]) => (values.push(value), values),
      [],
    )
    .option("--until-idle", "stop after the daemon has no work")
    .option("--poll-interval <ms>", "positive polling interval in milliseconds")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord run daemon --until-idle --poll-interval 1000\n",
    )
    .action(
      async (opts: {
        fail: string[];
        failTransient: string[];
        untilIdle?: boolean;
        pollInterval?: string;
      }) => {
        emitResult(
          await runDaemon(
            {
              fail: opts.fail,
              "fail-transient": opts.failTransient,
              "until-idle": opts.untilIdle,
              "poll-interval": opts.pollInterval,
            },
            deps.buildDaemon,
            deps.logger,
          ),
          io,
        );
      },
    );
}

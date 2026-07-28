import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runAckProject } from "../../project.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildAckProjectCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("project")
    .description("Acknowledge a project's activity up to a cursor.")
    .configureHelp({ commandUsage: () => "kanthord ack project" })
    .requiredOption("--id <id>", "ID of the project to acknowledge")
    .requiredOption("--cursor <ulid>", "event id to acknowledge up to")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord ack project --id project-1 --cursor 01JZZZZZZZZZZZZZZZZZZZZZZZ\n",
    )
    .action(async (opts: { id: string; cursor: string }) => {
      emitResult(
        await runAckProject(
          { id: opts.id, cursor: opts.cursor },
          deps.ackProject,
        ),
        io,
      );
    });
}

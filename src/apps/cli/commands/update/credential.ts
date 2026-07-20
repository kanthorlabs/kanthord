import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runUpdateCredential } from "../../resource.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

type UpdateCredentialDeps = Pick<CliDeps, "updateCredential">;

export function buildUpdateCredentialCommand(
  deps: UpdateCredentialDeps,
  io: CliIo,
): Command {
  return new Command("credential")
    .description("Update a credential resource.")
    .configureHelp({ commandUsage: () => "kanthord update credential" })
    .requiredOption("--id <id>", "ID of the credential resource to update")
    .option("--name <name>", "new name for the credential")
    .option("--value-file <path|->", "credential file, or - for standard input")
    .option(
      "--value-timeout <duration>",
      "credential read timeout, such as 30s",
    )
    .addHelpText(
      "after",
      "\nExample:\n  kanthord update credential --id credential-1 --value-file ./credential.txt\n",
    )
    .action(
      async (opts: {
        id: string;
        name?: string;
        valueFile?: string;
        valueTimeout?: string;
      }) => {
        const reader = {
          tty: process.stdin.isTTY ? process.stdin : undefined,
          stdin: process.stdin,
        };
        emitResult(
          await runUpdateCredential(
            {
              id: opts.id,
              name: opts.name,
              "value-file": opts.valueFile,
              "value-timeout": opts.valueTimeout,
            },
            deps.updateCredential,
            reader,
          ),
          io,
        );
      },
    );
}

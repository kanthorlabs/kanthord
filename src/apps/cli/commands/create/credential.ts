import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runCreateCredential } from "../../resource.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildCreateCredentialCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("credential")
    .description("Create a credential resource.")
    .configureHelp({ commandUsage: () => "kanthord create credential" })
    .requiredOption("--project <id>", "project that owns the credential")
    .requiredOption("--name <name>", "name for the credential")
    .requiredOption("--provider <provider>", "credential provider")
    .option("--value-file <path|->", "credential file, or - for standard input")
    .option(
      "--value-timeout <duration>",
      "credential read timeout, such as 30s",
    )
    .addHelpText(
      "after",
      "\nExample:\n  kanthord create credential --project project-1 --name anthropic-key --provider anthropic --value-file ./anthropic-key.txt\n",
    )
    .action(
      async (opts: {
        project: string;
        name: string;
        provider: string;
        valueFile?: string;
        valueTimeout?: string;
      }) => {
        const reader = {
          tty: process.stdin.isTTY ? process.stdin : undefined,
          stdin: process.stdin,
        };
        emitResult(
          await runCreateCredential(
            {
              project: opts.project,
              name: opts.name,
              provider: opts.provider,
              "value-file": opts.valueFile,
              "value-timeout": opts.valueTimeout,
            },
            deps.addResource,
            reader,
          ),
          io,
        );
      },
    );
}

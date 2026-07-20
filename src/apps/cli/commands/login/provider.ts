import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runLogin } from "../../login.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildLoginProviderCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("provider")
    .description("Log in to an external AI provider.")
    .configureHelp({ commandUsage: () => "kanthord login provider" })
    .requiredOption("--provider <provider>", "provider identifier to log in to")
    .requiredOption("--project <id>", "project that owns the credential")
    .requiredOption("--name <name>", "name for the credential")
    .option(
      "--method <method>",
      "OAuth login method: browser or device_code (default: browser)",
    )
    .addHelpText(
      "after",
      "\nExample:\n  kanthord login provider --provider openai-codex --project project-1 --name openai\n",
    )
    .action(
      async (opts: {
        provider: string;
        project: string;
        name: string;
        method?: string;
      }) => {
        emitResult(
          await runLogin(
            opts.provider,
            {
              provider: opts.provider,
              project: opts.project,
              name: opts.name,
              method: opts.method,
            },
            deps.login,
          ),
          io,
        );
      },
    );
}

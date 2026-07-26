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
    .requiredOption("--name <name>", "name for the AI provider")
    .option(
      "--method <method>",
      "OAuth login method: browser or device_code (default: browser)",
    )
    .option(
      "--model <model>",
      "Model identifier (default: interactive selection)",
    )
    .option("--base-url <url>", "Base URL for the provider API")
    .option("--effort <effort>", "Reasoning effort")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord login provider --provider openai-codex --name openai --model gpt-5.6-sol\n",
    )
    .action(
      async (opts: {
        provider: string;
        name: string;
        method?: string;
        model?: string;
        baseUrl?: string;
        effort?: string;
      }) => {
        emitResult(
          await runLogin(
            opts.provider,
            {
              name: opts.name,
              method: opts.method,
              model: opts.model,
              baseUrl: opts.baseUrl,
              effort: opts.effort,
            },
            deps.login,
          ),
          io,
        );
      },
    );
}

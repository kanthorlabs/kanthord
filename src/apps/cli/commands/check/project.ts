// src/apps/cli/commands/check/project.ts — EPIC 014 Story 6
// Leaf for `kanthord check project`. Mirrors `src/apps/cli/commands/check/graph.ts`
// exactly: same imports style, same `.addHelpText("after", …)` shape, no
// `.configureHelp` (the architecture help test at
// `src/apps/cli/architecture.test.ts:120-127` scans every leaf for `Usage:`
// and `Example`, so both must appear).

import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runCheckProject } from "../../project-readiness.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildCheckProjectCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("project")
    .description("Diagnose whether a project is ready to run work.")
    .requiredOption("--id <id>", "project id")
    .option("--json", "print the readiness report as JSON")
    .option(
      "--probe-repositories",
      "probe each repository remote with git ls-remote",
    )
    .option(
      "--probe-provider",
      "probe the assigned ai provider (billable: makes a real model call)",
    )
    .addHelpText(
      "after",
      "\nExample:\n  kanthord check project --id 01J0000000000000000000000A --json\n",
    )
    .action(
      async (opts: {
        id: string;
        json?: boolean;
        probeRepositories?: boolean;
        probeProvider?: boolean;
      }) => {
        emitResult(
          await runCheckProject(
            {
              id: opts.id,
              ...(opts.json ? { json: true } : {}),
              ...(opts.probeRepositories ? { "probe-repositories": true } : {}),
              ...(opts.probeProvider ? { "probe-provider": true } : {}),
            },
            deps.checkProject,
          ),
          io,
        );
      },
    );
}

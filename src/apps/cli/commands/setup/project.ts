// src/apps/cli/commands/setup/project.ts — EPIC 015 Story 5
// The `kanthord setup project` leaf. Mirrors the option + help pattern at
// `src/apps/cli/commands/get/project.ts:8-27` exactly: same Commander
// construction, same `configureHelp` + `addHelpText` shape, same
// `emitResult` round-trip. The leaf builds the `RunSetupDeps` bundle
// with arrow wrappers (never bare method references — the `apps → app`
// import direction means the leaf is the right home for
// `readCredentialValue` and `readGraphPackageDir`).
//
// The bundle's `findResourcesByName` and `getResource` mirror the
// `import graph` leaf byte-for-byte (`src/apps/cli/commands/import/graph.ts:78-94`)
// so the graph-binding resolver sees the same shape the existing tests
// already exercise.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Command } from "commander";

import { readCredentialValue } from "../../credential-input.ts";
import { parseGraphPackage } from "../../../../app/graph/graph-codec.ts";
import { readGraphPackageDir } from "../../graph-md/parse.ts";
import { runSetup } from "../../setup/run-setup.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";
import type { CliDeps } from "../../deps.ts";

/**
 * Build the `kanthord setup project` Commander command. The action
 * hands off to `runSetup` with the answer-file path and the
 * `--non-interactive` flag; the orchestrator owns the merge, the prompt
 * loop, the plan, the steps, and the closing output.
 */
export function buildSetupProjectCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("project")
    .description(
      "Set up a project end to end: repository, credential, AI provider, and an optional graph.",
    )
    .configureHelp({ commandUsage: () => "kanthord setup project [options]" })
    .option("--answers <file>", "path to an answers file (key=value per line)")
    .option(
      "--non-interactive",
      "never prompt; every answer must come from --answers",
    )
    .addHelpText(
      "after",
      "\nExample:\n  kanthord setup project --answers ./setup.answers --non-interactive\n",
    )
    .action(async (opts: { answers?: string; nonInteractive?: boolean }) => {
      const baseDir =
        opts.answers !== undefined
          ? dirname(resolve(opts.answers))
          : process.cwd();
      emitResult(
        await runSetup(
          {
            ...(opts.answers !== undefined
              ? { answersPath: opts.answers }
              : {}),
            nonInteractive: opts.nonInteractive === true,
            baseDir,
          },
          {
            observeSetupFacts: deps.observeSetupFacts,
            createProject: deps.createProject,
            addResource: deps.addResource,
            registerAiProvider: deps.registerAiProvider,
            assignAiProvider: deps.assignAiProvider,
            login: deps.login,
            createGraph: deps.createGraph,
            checkProject: deps.checkProject,
            repositoryProbe: deps.repositoryProbe,
            providerProbe: deps.providerProbe,
            newId: deps.newId,
            readTextFile: (p: string) => readFile(p, "utf8"),
            readSecretFile: (p: string) =>
              readCredentialValue({ valuefile: p, timeoutMs: 180_000 }),
            readGraphPackage: async (dir: string) =>
              parseGraphPackage(await readGraphPackageDir(dir)),
            findResourcesByName: async (projectId: string, name: string) => {
              try {
                const id = await deps.findResource.execute({ projectId, name });
                return [{ id }];
              } catch {
                return [];
              }
            },
            getResource: async (id: string) => {
              try {
                return await deps.getResource.execute(id);
              } catch {
                return undefined;
              }
            },
            prompt: deps.setupPrompt,
            stdinIsTty: deps.stdinIsTty,
          },
        ),
        io,
      );
    });
}

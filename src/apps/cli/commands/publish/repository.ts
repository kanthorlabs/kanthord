import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";
import { toResult } from "../../error-map.ts";

export function buildPublishRepositoryCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("repository")
    .description("Publish a landed repository branch to its remote.")
    .configureHelp({ commandUsage: () => "kanthord publish repository" })
    .requiredOption("--repository <id>", "ID of the repository resource")
    .requiredOption("--branch <b>", "branch to publish")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord publish repository --repository repository-1 --branch main\n",
    )
    .action(async (opts: { repository: string; branch: string }) => {
      try {
        const outcome = await deps.publishRepository.execute({
          repositoryId: opts.repository,
          branch: opts.branch,
        });

        if (outcome.kind === "published") {
          emitResult(
            {
              exitCode: 0,
              stdout: [outcome.remoteOID],
              stderr: [
                `repository published: ${outcome.repositoryId} -> ${outcome.remoteOID}`,
              ],
            },
            io,
          );
        } else if (outcome.kind === "diverged") {
          emitResult(
            {
              exitCode: 1,
              stdout: [],
              stderr: [
                `repository publish diverged: remote moved to ${outcome.remoteOID} — resolve before publishing`,
              ],
            },
            io,
          );
        } else {
          emitResult(
            {
              exitCode: 1,
              stdout: [],
              stderr: [
                `repository publish failed: ${outcome.repositoryId} — ${outcome.message}`,
              ],
            },
            io,
          );
        }
      } catch (err) {
        const result = toResult(err);
        emitResult(
          { exitCode: result.exitCode, stdout: [], stderr: result.stderr },
          io,
        );
      }
    });
}

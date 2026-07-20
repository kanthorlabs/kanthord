import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runGraphCheck } from "../../graph-check.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildCheckGraphCommand(_deps: CliDeps, io: CliIo): Command {
  return new Command("graph")
    .description("Check task readiness in a graph YAML file.")
    .requiredOption("--path <file>", "path to the graph YAML file")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord check graph --path ./graph.yaml\n",
    )
    .action(async (opts: { path: string }) => {
      emitResult(await runGraphCheck(opts.path), io);
    });
}

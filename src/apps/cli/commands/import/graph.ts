import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runImportGraph } from "../../import-graph.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildImportGraphCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("graph")
    .description("Import a graph package from a directory.")
    .configureHelp({ commandUsage: () => "kanthord import graph" })
    .argument("[dir]", "graph directory", ".")
    .option("--create", "create the graph in a project")
    .option("--project <id>", "project that receives a created graph")
    .option("--apply", "apply the graph to an initiative")
    .option("--initiative <id>", "initiative that receives an applied graph")
    .option("--dry-run", "show apply changes without writing them")
    .option("--delete-missing", "plan deletion of missing graph nodes")
    .option("--confirm-delete", "delete missing graph nodes")
    .option(
      "--bind <alias=id>",
      "bind a graph resource alias; repeat for each alias",
      (value, values: string[]) => (values.push(value), values),
      [],
    )
    .addHelpText(
      "after",
      "\nExample:\n  kanthord import graph ./graph --create --project project-1 --bind repository=resource-1\n",
    )
    .action(
      async (
        dir: string | undefined,
        opts: {
          create?: boolean;
          apply?: boolean;
          dryRun?: boolean;
          deleteMissing?: boolean;
          confirmDelete?: boolean;
          project?: string;
          initiative?: string;
          bind: string[];
        },
      ) => {
        const bind: Record<string, string> | undefined = opts.bind.length
          ? Object.fromEntries(
              opts.bind.map((entry) => {
                const eq = entry.indexOf("=");
                return eq === -1
                  ? [entry, ""]
                  : [entry.slice(0, eq), entry.slice(eq + 1)];
              }),
            )
          : undefined;

        emitResult(
          await runImportGraph(
            {
              dir: dir ?? ".",
              create: opts.create ?? false,
              apply: opts.apply ?? false,
              dryRun: opts.dryRun ?? false,
              deleteMissing: opts.deleteMissing ?? false,
              confirmDelete: opts.confirmDelete ?? false,
              project: opts.project,
              initiative: opts.initiative,
              bind,
            },
            {
              createGraph: deps.createGraph,
              applyGraph: deps.applyGraph,
              newId: deps.newId,
              getResource: async (id: string) => {
                try {
                  return deps.getResource.execute(id);
                } catch {
                  return undefined;
                }
              },
              findResourcesByName: async (projectId: string, name: string) => {
                try {
                  const id = await deps.findResource.execute({
                    projectId,
                    name,
                  });
                  return [{ id }];
                } catch {
                  return [];
                }
              },
            },
          ),
          io,
        );
      },
    );
}

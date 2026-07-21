import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runCreateTask } from "../../task.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildCreateTaskCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("task")
    .description("Create a task.")
    .configureHelp({ commandUsage: () => "kanthord create task" })
    .requiredOption("--objective <id>", "objective that owns the task")
    .requiredOption("--title <title>", "title for the task")
    .requiredOption("--instructions <text>", "instructions for the task")
    .option(
      "--ac <criterion>",
      "acceptance criterion; repeat for each criterion",
      (value, values: string[]) => (values.push(value), values),
      [],
    )
    .option(
      "--verification <command>",
      "verification command; repeat for each command",
      (value, values: string[]) => (values.push(value), values),
      [],
    )
    .option(
      "--dependencies <id>",
      "task dependency; repeat for each dependency",
      (value, values: string[]) => (values.push(value), values),
      [],
    )
    .option(
      "--context <type=resource-id>",
      "resource context; repeat for each resource",
      (value, values: string[]) => (values.push(value), values),
      [],
    )
    .option("--agent <agent>", "agent to run the task")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord create task --objective objective-1 --title 'Migrate parser' --instructions 'Use Commander.js.' --ac 'CLI parses commands'\n",
    )
    .action(
      async (opts: {
        objective: string;
        title: string;
        instructions: string;
        ac: string[];
        verification: string[];
        dependencies: string[];
        context: string[];
        agent?: string;
      }) => {
        emitResult(
          await runCreateTask(
            {
              objective: opts.objective,
              title: opts.title,
              instructions: opts.instructions,
              ac: opts.ac,
              verification: opts.verification,
              dependencies: opts.dependencies,
              context: opts.context,
              agent: opts.agent,
            },
            deps.createTask,
          ),
          io,
        );
      },
    );
}

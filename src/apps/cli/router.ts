import { parseArgs } from "node:util";
import type { ParseArgsConfig } from "node:util";

import type { MigrateDb } from "../../app/db/migrate-db.ts";
import type { GetDbStatus } from "../../app/db/get-db-status.ts";
import type {
  ProjectRepository,
  InitiativeRepository,
  TaskRepository,
  ReferenceResolver,
  Transactor,
} from "../../storage/port.ts";
import type { EventFeed } from "../../events/port.ts";
import { runGraphCheck } from "./graph-check.ts";
import { runDbMigrate, runDbStatus } from "./db.ts";
import { runCreateProject, runRenameProject } from "./project.ts";
import { runCreateInitiative, runRenameInitiative } from "./initiative.ts";
import { runCreateObjective, runRenameObjective } from "./objective.ts";
import {
  runCreateRepository,
  runCreateCredential,
  runCreateNotification,
  runCreateAiProvider,
  runCreateFilesystem,
} from "./resource.ts";
import { runCreateTask } from "./task.ts";
import { runAddDependency, runRemoveDependency } from "./dependency.ts";
import { runListTasks } from "./list-tasks.ts";
import { runGetProject } from "./get.ts";
import {
  runFindProject,
  runFindInitiative,
  runFindObjective,
  runFindResource,
} from "./find.ts";

/** Composition-root bundle injected by main.ts; extended by later Tasks. */
export interface RouterDeps {
  migrateDb: MigrateDb;
  getDbStatus: GetDbStatus;
  projectRepository: ProjectRepository;
  initiativeRepository: InitiativeRepository;
  taskRepository: TaskRepository;
  referenceResolver: ReferenceResolver;
  events: EventFeed;
  transactor: Transactor;
}

/** Shape of each command entry in the COMMANDS table. */
interface CommandEntry {
  usage: string;
  parse: ParseArgsConfig["options"];
  handler(
    args: Record<string, unknown>,
    deps: RouterDeps,
  ): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }>;
}

/** Return type shared by dispatch and handlers. */
export interface DispatchResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

/**
 * Grep-able command table — one entry per `"<verb> <object>"` key,
 * mapping 1:1 to a use-case class (AGENTS.md Architecture § CLI).
 */
export const COMMANDS: Record<string, CommandEntry> = {
  "check graph": {
    usage: "usage: check graph --path <file>",
    parse: {
      path: { type: "string" },
    },
    async handler(args, _deps) {
      return runGraphCheck(args["path"] as string);
    },
  },

  "db migrate": {
    usage: "usage: db migrate",
    parse: {},
    async handler(_args, deps) {
      return runDbMigrate(deps.migrateDb);
    },
  },

  "db status": {
    usage: "usage: db status",
    parse: {},
    async handler(_args, deps) {
      return runDbStatus(deps.getDbStatus);
    },
  },

  "create project": {
    usage: "usage: create project --name <name>",
    parse: {
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runCreateProject(args, deps);
    },
  },

  "rename project": {
    usage: "usage: rename project --id <id> --name <name>",
    parse: {
      id: { type: "string" },
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runRenameProject(args, deps);
    },
  },

  "create initiative": {
    usage: "usage: create initiative --project <id> --name <name>",
    parse: {
      project: { type: "string" },
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runCreateInitiative(args, {
        initiativeRepository: deps.initiativeRepository,
        referenceResolver: deps.referenceResolver,
      });
    },
  },

  "rename initiative": {
    usage: "usage: rename initiative --id <id> --name <name>",
    parse: {
      id: { type: "string" },
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runRenameInitiative(args, {
        initiativeRepository: deps.initiativeRepository,
      });
    },
  },

  "create objective": {
    usage: "usage: create objective --initiative <id> --name <name>",
    parse: {
      initiative: { type: "string" },
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runCreateObjective(args, {
        initiativeRepository: deps.initiativeRepository,
        referenceResolver: deps.referenceResolver,
      });
    },
  },

  "rename objective": {
    usage: "usage: rename objective --id <id> --name <name>",
    parse: {
      id: { type: "string" },
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runRenameObjective(args, {
        initiativeRepository: deps.initiativeRepository,
      });
    },
  },

  "create repository": {
    usage:
      "usage: create repository --project <id> --name <name> --organization <org> --branch <branch>",
    parse: {
      project: { type: "string" },
      name: { type: "string" },
      organization: { type: "string" },
      branch: { type: "string" },
      path: { type: "string" },
    },
    async handler(args, deps) {
      return runCreateRepository(args, {
        projectRepository: deps.projectRepository,
        referenceResolver: deps.referenceResolver,
      });
    },
  },

  "create credential": {
    usage:
      "usage: create credential --project <id> --name <name> --provider <provider> --value <value>",
    parse: {
      project: { type: "string" },
      name: { type: "string" },
      provider: { type: "string" },
      value: { type: "string" },
    },
    async handler(args, deps) {
      return runCreateCredential(args, {
        projectRepository: deps.projectRepository,
        referenceResolver: deps.referenceResolver,
      });
    },
  },

  "create notification": {
    usage:
      "usage: create notification --project <id> --name <name> --provider <slack|telegram> --destination <dest>",
    parse: {
      project: { type: "string" },
      name: { type: "string" },
      provider: { type: "string" },
      destination: { type: "string" },
    },
    async handler(args, deps) {
      return runCreateNotification(args, {
        projectRepository: deps.projectRepository,
        referenceResolver: deps.referenceResolver,
      });
    },
  },

  "create ai-provider": {
    usage:
      "usage: create ai-provider --project <id> --name <name> --provider <provider> --model <model>",
    parse: {
      project: { type: "string" },
      name: { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      "base-url": { type: "string" },
    },
    async handler(args, deps) {
      return runCreateAiProvider(args, {
        projectRepository: deps.projectRepository,
        referenceResolver: deps.referenceResolver,
      });
    },
  },

  "create filesystem": {
    usage:
      "usage: create filesystem --project <id> --name <name> --path <path>",
    parse: {
      project: { type: "string" },
      name: { type: "string" },
      path: { type: "string" },
    },
    async handler(args, deps) {
      return runCreateFilesystem(args, {
        projectRepository: deps.projectRepository,
        referenceResolver: deps.referenceResolver,
      });
    },
  },

  "create task": {
    usage:
      "usage: create task --objective <id> --title <title> [--depends-on <id>]... [--context type=<resource-id>]...",
    parse: {
      objective: { type: "string" },
      title: { type: "string" },
      "depends-on": { type: "string", multiple: true },
      context: { type: "string", multiple: true },
    },
    async handler(args, deps) {
      return runCreateTask(args, {
        taskRepository: deps.taskRepository,
        initiativeRepository: deps.initiativeRepository,
        projectRepository: deps.projectRepository,
        referenceResolver: deps.referenceResolver,
      });
    },
  },

  "add dependency": {
    usage: "usage: add dependency --task <id> --depends-on <id>",
    parse: {
      task: { type: "string" },
      "depends-on": { type: "string" },
    },
    async handler(args, deps) {
      return runAddDependency(args, {
        taskRepository: deps.taskRepository,
        initiativeRepository: deps.initiativeRepository,
        referenceResolver: deps.referenceResolver,
        events: deps.events,
        transactor: deps.transactor,
      });
    },
  },

  "remove dependency": {
    usage: "usage: remove dependency --task <id> --depends-on <id>",
    parse: {
      task: { type: "string" },
      "depends-on": { type: "string" },
    },
    async handler(args, deps) {
      return runRemoveDependency(args, {
        taskRepository: deps.taskRepository,
        initiativeRepository: deps.initiativeRepository,
        referenceResolver: deps.referenceResolver,
        events: deps.events,
        transactor: deps.transactor,
      });
    },
  },

  "list task": {
    usage: "usage: list task --initiative <id> [--json]",
    parse: {
      initiative: { type: "string" },
      json: { type: "boolean" },
    },
    async handler(args, deps) {
      return runListTasks(args, { taskRepository: deps.taskRepository });
    },
  },

  "get project": {
    usage: "usage: get project --id <id> [--json]",
    parse: {
      id: { type: "string" },
      json: { type: "boolean" },
    },
    async handler(args, deps) {
      return runGetProject(args, { projectRepository: deps.projectRepository });
    },
  },

  "find project": {
    usage: "usage: find project --name <name>",
    parse: {
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runFindProject(args, {
        projectRepository: deps.projectRepository,
      });
    },
  },

  "find initiative": {
    usage: "usage: find initiative --project <id> --name <name>",
    parse: {
      project: { type: "string" },
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runFindInitiative(args, {
        initiativeRepository: deps.initiativeRepository,
      });
    },
  },

  "find objective": {
    usage: "usage: find objective --initiative <id> --name <name>",
    parse: {
      initiative: { type: "string" },
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runFindObjective(args, {
        initiativeRepository: deps.initiativeRepository,
      });
    },
  },

  "find resource": {
    usage: "usage: find resource --project <id> --name <name>",
    parse: {
      project: { type: "string" },
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runFindResource(args, {
        projectRepository: deps.projectRepository,
      });
    },
  },
};

/**
 * Dispatches `argv` (the slice after the node / script args) through the
 * command table.  Returns a result object — never throws, never calls
 * `process.exit`.
 */
export async function dispatch(
  argv: string[],
  deps: RouterDeps,
): Promise<DispatchResult> {
  const verb = argv[0] ?? "";
  const obj = argv[1] ?? "";
  const key = `${verb} ${obj}`;
  const rest = argv.slice(2);

  const entry = COMMANDS[key];

  // Unknown command
  if (entry === undefined) {
    const known = Object.keys(COMMANDS)
      .map((k) => `  ${k}`)
      .join("\n");
    return {
      exitCode: 1,
      stdout: [],
      stderr: [`error: unknown command: ${key}`, `known commands:\n${known}`],
    };
  }

  // --help / -h
  if (rest.includes("--help") || rest.includes("-h")) {
    return {
      exitCode: 0,
      stdout: [entry.usage],
      stderr: [],
    };
  }

  // Parse remaining flags in strict mode
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: rest,
      options: entry.parse,
      strict: true,
      allowPositionals: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      stdout: [],
      stderr: [`error: ${msg}`, `usage: ${entry.usage}`],
    };
  }

  return entry.handler(parsed.values as Record<string, unknown>, deps);
}

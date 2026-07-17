import { parseArgs } from "node:util";
import type { ParseArgsConfig } from "node:util";

import type { MigrateDb } from "../../app/db/migrate-db.ts";
import type { GetDbStatus } from "../../app/db/get-db-status.ts";
import type { CreateProject } from "../../app/project/create-project.ts";
import type { RenameProject } from "../../app/project/rename-project.ts";
import type { GetProject } from "../../app/project/get-project.ts";
import type { FindProject } from "../../app/project/find-project.ts";
import type { CreateInitiative } from "../../app/initiative/create-initiative.ts";
import type { RenameInitiative } from "../../app/initiative/rename-initiative.ts";
import type { FindInitiative } from "../../app/initiative/find-initiative.ts";
import type { CreateObjective } from "../../app/objective/create-objective.ts";
import type { RenameObjective } from "../../app/objective/rename-objective.ts";
import type { FindObjective } from "../../app/objective/find-objective.ts";
import type { AddResource } from "../../app/resource/add-resource.ts";
import type { FindResource } from "../../app/resource/find-resource.ts";
import type { CreateTask } from "../../app/task/create-task.ts";
import type { AddDependency } from "../../app/task/add-dependency.ts";
import type { RemoveDependency } from "../../app/task/remove-dependency.ts";
import type { ListTasks } from "../../app/task/list-tasks.ts";
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
  createProject: CreateProject;
  renameProject: RenameProject;
  getProject: GetProject;
  findProject: FindProject;
  createInitiative: CreateInitiative;
  renameInitiative: RenameInitiative;
  findInitiative: FindInitiative;
  createObjective: CreateObjective;
  renameObjective: RenameObjective;
  findObjective: FindObjective;
  addResource: AddResource;
  findResource: FindResource;
  createTask: CreateTask;
  addDependency: AddDependency;
  removeDependency: RemoveDependency;
  listTasks: ListTasks;
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
      return runCreateProject(args, deps.createProject);
    },
  },

  "rename project": {
    usage: "usage: rename project --id <id> --name <name>",
    parse: {
      id: { type: "string" },
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runRenameProject(args, deps.renameProject);
    },
  },

  "create initiative": {
    usage: "usage: create initiative --project <id> --name <name>",
    parse: {
      project: { type: "string" },
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runCreateInitiative(args, deps.createInitiative);
    },
  },

  "rename initiative": {
    usage: "usage: rename initiative --id <id> --name <name>",
    parse: {
      id: { type: "string" },
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runRenameInitiative(args, deps.renameInitiative);
    },
  },

  "create objective": {
    usage: "usage: create objective --initiative <id> --name <name>",
    parse: {
      initiative: { type: "string" },
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runCreateObjective(args, deps.createObjective);
    },
  },

  "rename objective": {
    usage: "usage: rename objective --id <id> --name <name>",
    parse: {
      id: { type: "string" },
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runRenameObjective(args, deps.renameObjective);
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
      return runCreateRepository(args, deps.addResource);
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
      return runCreateCredential(args, deps.addResource);
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
      return runCreateNotification(args, deps.addResource);
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
      return runCreateAiProvider(args, deps.addResource);
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
      return runCreateFilesystem(args, deps.addResource);
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
      return runCreateTask(args, deps.createTask);
    },
  },

  "add dependency": {
    usage: "usage: add dependency --task <id> --depends-on <id>",
    parse: {
      task: { type: "string" },
      "depends-on": { type: "string" },
    },
    async handler(args, deps) {
      return runAddDependency(args, deps.addDependency);
    },
  },

  "remove dependency": {
    usage: "usage: remove dependency --task <id> --depends-on <id>",
    parse: {
      task: { type: "string" },
      "depends-on": { type: "string" },
    },
    async handler(args, deps) {
      return runRemoveDependency(args, deps.removeDependency);
    },
  },

  "list task": {
    usage: "usage: list task --initiative <id> [--json]",
    parse: {
      initiative: { type: "string" },
      json: { type: "boolean" },
    },
    async handler(args, deps) {
      return runListTasks(args, deps.listTasks);
    },
  },

  "get project": {
    usage: "usage: get project --id <id> [--json]",
    parse: {
      id: { type: "string" },
      json: { type: "boolean" },
    },
    async handler(args, deps) {
      return runGetProject(args, deps.getProject);
    },
  },

  "find project": {
    usage: "usage: find project --name <name>",
    parse: {
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runFindProject(args, deps.findProject);
    },
  },

  "find initiative": {
    usage: "usage: find initiative --project <id> --name <name>",
    parse: {
      project: { type: "string" },
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runFindInitiative(args, deps.findInitiative);
    },
  },

  "find objective": {
    usage: "usage: find objective --initiative <id> --name <name>",
    parse: {
      initiative: { type: "string" },
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runFindObjective(args, deps.findObjective);
    },
  },

  "find resource": {
    usage: "usage: find resource --project <id> --name <name>",
    parse: {
      project: { type: "string" },
      name: { type: "string" },
    },
    async handler(args, deps) {
      return runFindResource(args, deps.findResource);
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

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
import type { PauseInitiative } from "../../app/initiative/pause-initiative.ts";
import type { ResumeInitiative } from "../../app/initiative/resume-initiative.ts";
import type { CreateObjective } from "../../app/objective/create-objective.ts";
import type { RenameObjective } from "../../app/objective/rename-objective.ts";
import type { FindObjective } from "../../app/objective/find-objective.ts";
import type { AddResource } from "../../app/resource/add-resource.ts";
import type { FindResource } from "../../app/resource/find-resource.ts";
import type { GetResource } from "../../app/resource/get-resource.ts";
import type { UpdateAiProvider } from "../../app/resource/update-ai-provider.ts";
import type { UpdateCredential } from "../../app/resource/update-credential.ts";
import type { UpdateRepository } from "../../app/resource/update-repository.ts";
import type { UpdateNotification } from "../../app/resource/update-notification.ts";
import type { UpdateFilesystem } from "../../app/resource/update-filesystem.ts";
import type { CreateTask } from "../../app/task/create-task.ts";
import type { AddDependency } from "../../app/task/add-dependency.ts";
import type { RemoveDependency } from "../../app/task/remove-dependency.ts";
import type { ListTasks } from "../../app/task/list-tasks.ts";
import type { RetryTask } from "../../app/task/retry-task.ts";
import type { GetTask } from "../../app/task/get-task.ts";
import type { ApproveTask } from "../../app/task/approve-task.ts";
import type { RejectTask } from "../../app/task/reject-task.ts";
import type { RunDaemon } from "../../app/task/run-daemon.ts";
import type { ListEvents } from "../../app/task/list-events.ts";
import type { ImportResources } from "../../app/resource/import-resources.ts";
import type { ExportInitiative } from "../../app/graph/export-initiative.ts";
import type { CreateGraph } from "../../app/graph/create-graph.ts";
import type { ApplyGraph } from "../../app/graph/apply-graph.ts";
import type { ListInitiatives } from "../../app/initiative/list-initiatives.ts";
import type { ListObjectives } from "../../app/objective/list-objectives.ts";
import { runGraphCheck } from "./graph-check.ts";
import { runDbMigrate, runDbStatus } from "./db.ts";
import { runCreateProject, runRenameProject } from "./project.ts";
import {
  runCreateInitiative,
  runRenameInitiative,
  runPauseInitiative,
  runResumeInitiative,
  runListInitiatives,
} from "./initiative.ts";
import {
  runCreateObjective,
  runRenameObjective,
  runListObjectives,
} from "./objective.ts";
import {
  runCreateRepository,
  runCreateCredential,
  runCreateNotification,
  runCreateAiProvider,
  runCreateFilesystem,
  runGetResource,
  runUpdateAiProvider,
  runUpdateCredential,
  runUpdateRepository,
  runUpdateNotification,
  runUpdateFilesystem,
} from "./resource.ts";
import {
  runCreateTask,
  runRetryTask,
  runGetTask,
  runApproveTask,
  runRejectTask,
} from "./task.ts";
import { runDaemon } from "./daemon.ts";

// Minimal structural Logger — avoids apps/ importing an adapter port directly.
interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
import { runAddDependency, runRemoveDependency } from "./dependency.ts";
import { runListTasks } from "./list-tasks.ts";
import { runEvents } from "./events.ts";
import { runGetProject } from "./get.ts";
import {
  runFindProject,
  runFindInitiative,
  runFindObjective,
  runFindResource,
} from "./find.ts";
import { runImportResource } from "./import.ts";
import { runExportInitiative } from "./export.ts";
import { runImportGraph } from "./import-graph.ts";
import { runLogin } from "./login.ts";
import type { LoginDeps } from "./login.ts";
import { runGetModels } from "./models.ts";
import type { ListModels } from "./models.ts";
import type { DiagnosticsExport } from "../../app/observability/diagnostics-export.ts";
import { runDiagnosticsExport } from "./diagnostics.ts";
import type { RepositoryLanding } from "../../app/errors.ts";
import { runRepoLand } from "./repo.ts";

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
  pauseInitiative: PauseInitiative;
  resumeInitiative: ResumeInitiative;
  createObjective: CreateObjective;
  renameObjective: RenameObjective;
  findObjective: FindObjective;
  addResource: AddResource;
  findResource: FindResource;
  getResource: GetResource;
  updateAiProvider: UpdateAiProvider;
  updateCredential: UpdateCredential;
  updateRepository: UpdateRepository;
  updateNotification: UpdateNotification;
  updateFilesystem: UpdateFilesystem;
  createTask: CreateTask;
  addDependency: AddDependency;
  removeDependency: RemoveDependency;
  listTasks: ListTasks;
  retryTask: RetryTask;
  getTask: GetTask;
  approveTask: ApproveTask;
  rejectTask: RejectTask;
  buildDaemon: (failTaskIds: string[], logger?: Logger) => RunDaemon;
  logger: Logger;
  listEvents: ListEvents;
  importResources: ImportResources;
  exportInitiative: ExportInitiative;
  createGraph: CreateGraph;
  applyGraph: ApplyGraph;
  listInitiatives: ListInitiatives;
  listObjectives: ListObjectives;
  login: LoginDeps;
  listModels: ListModels;
  diagnosticsExport: DiagnosticsExport;
  repoLanding: RepositoryLanding;
  resolveHomeDir: (repoId: string) => string;
  newId: () => string;
}

/** Shape of each command entry in the COMMANDS table. */
interface CommandEntry {
  usage: string;
  parse: ParseArgsConfig["options"];
  /**
   * When set, the first positional argument (e.g. `import graph <dir>`) is
   * accepted and promoted to this named flag when the flag is not already
   * supplied.  Keeps flag-based invocations working unchanged.
   */
  positional?: string;
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

  "pause initiative": {
    usage: "usage: pause initiative --id <id>",
    parse: {
      id: { type: "string" },
    },
    async handler(args, deps) {
      return runPauseInitiative(args, deps.pauseInitiative);
    },
  },

  "resume initiative": {
    usage: "usage: resume initiative --id <id>",
    parse: {
      id: { type: "string" },
    },
    async handler(args, deps) {
      return runResumeInitiative(args, deps.resumeInitiative);
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
      "usage: create repository --project <id> --name <name> --remote-url <url> --branch <branch> [--auth ambient|https-token|ssh-agent] [--credential <id>] [--path <path>]",
    parse: {
      project: { type: "string" },
      name: { type: "string" },
      "remote-url": { type: "string" },
      branch: { type: "string" },
      auth: { type: "string" },
      credential: { type: "string" },
      path: { type: "string" },
    },
    async handler(args, deps) {
      return runCreateRepository(args, deps.addResource);
    },
  },

  "create credential": {
    usage:
      "usage: create credential --project <id> --name <name> --provider <provider> --value-file <path|-> [--value-timeout <duration>]",
    parse: {
      project: { type: "string" },
      name: { type: "string" },
      provider: { type: "string" },
      "value-file": { type: "string" },
      "value-timeout": { type: "string" },
    },
    async handler(args, deps) {
      return runCreateCredential(args, deps.addResource, {
        tty: process.stdin.isTTY
          ? (process.stdin as unknown as NodeJS.ReadStream)
          : undefined,
        stdin: process.stdin as unknown as NodeJS.ReadableStream,
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
      return runCreateNotification(args, deps.addResource);
    },
  },

  "create ai-provider": {
    usage:
      "usage: create ai-provider --project <id> --name <name> --provider <provider> --model <model> [--effort minimal|low|medium|high|xhigh]",
    parse: {
      project: { type: "string" },
      name: { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      effort: { type: "string" },
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
      "usage: create task --objective <id> --title <title> --instructions <text> --ac <criterion>... [--agent <ref>] [--verification <cmd>]... [--depends-on <id>]... [--context type=<resource-id>]...",
    parse: {
      objective: { type: "string" },
      title: { type: "string" },
      instructions: { type: "string" },
      ac: { type: "string", multiple: true },
      agent: { type: "string" },
      verification: { type: "string", multiple: true },
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

  "retry task": {
    usage: "usage: retry task --id <id>",
    parse: {
      id: { type: "string" },
    },
    async handler(args, deps) {
      return runRetryTask(args, deps.retryTask);
    },
  },

  "approve task": {
    usage: "usage: approve task --id <id>",
    parse: {
      id: { type: "string" },
    },
    async handler(args, deps) {
      return runApproveTask(args, deps.approveTask);
    },
  },

  "reject task": {
    usage:
      "usage: reject task --id <id> --resolution <retry|discard> [--reason <text>]",
    parse: {
      id: { type: "string" },
      resolution: { type: "string" },
      reason: { type: "string" },
    },
    async handler(args, deps) {
      return runRejectTask(args, deps.rejectTask);
    },
  },

  "get task": {
    usage: "usage: get task --id <id> [--json] [--result]",
    parse: {
      id: { type: "string" },
      json: { type: "boolean" },
      result: { type: "boolean" },
    },
    async handler(args, deps) {
      return runGetTask(args, deps.getTask);
    },
  },

  "daemon run": {
    usage:
      "usage: daemon run [--fail <id>]... [--until-idle] [--poll-interval <ms>]",
    parse: {
      fail: { type: "string", multiple: true },
      "until-idle": { type: "boolean" },
      "poll-interval": { type: "string" },
    },
    async handler(args, deps) {
      return runDaemon(args, deps.buildDaemon, deps.logger);
    },
  },

  "list task": {
    usage:
      "usage: list task --initiative <id> [--objective <id>] [--status <status>] [--json]",
    parse: {
      initiative: { type: "string" },
      objective: { type: "string" },
      status: { type: "string" },
      json: { type: "boolean" },
    },
    async handler(args, deps) {
      return runListTasks(args, deps.listTasks);
    },
  },

  "list initiative": {
    usage: "usage: list initiative --project <id> [--json]",
    parse: {
      project: { type: "string" },
      json: { type: "boolean" },
    },
    handler(args, deps) {
      return Promise.resolve(runListInitiatives(args, deps.listInitiatives));
    },
  },

  "list objective": {
    usage: "usage: list objective --initiative <id> [--json]",
    parse: {
      initiative: { type: "string" },
      json: { type: "boolean" },
    },
    handler(args, deps) {
      return Promise.resolve(runListObjectives(args, deps.listObjectives));
    },
  },

  events: {
    usage:
      "usage: events --after <cursor> [--limit n] [--json] [--follow] [--poll-interval ms]",
    parse: {
      after: { type: "string" },
      limit: { type: "string" },
      json: { type: "boolean" },
      follow: { type: "boolean" },
      "poll-interval": { type: "string" },
    },
    async handler(args, deps) {
      const ac = new AbortController();
      const onSigint = () => ac.abort();
      process.once("SIGINT", onSigint);
      try {
        return await runEvents(
          args,
          deps.listEvents,
          (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
          ac.signal,
        );
      } finally {
        process.removeListener("SIGINT", onSigint);
      }
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

  "get resource": {
    usage: "usage: get resource --id <id> [--json]",
    parse: {
      id: { type: "string" },
      json: { type: "boolean" },
    },
    async handler(args, deps) {
      return runGetResource(args, deps.getResource);
    },
  },

  "update ai-provider": {
    usage:
      "usage: update ai-provider --id <id> [--name <name>] [--model <model>] [--effort <effort>] [--clear-effort] [--clear-base-url]",
    parse: {
      id: { type: "string" },
      name: { type: "string" },
      model: { type: "string" },
      effort: { type: "string" },
      "clear-effort": { type: "boolean" },
      "clear-base-url": { type: "boolean" },
    },
    async handler(args, deps) {
      return runUpdateAiProvider(args, deps.updateAiProvider);
    },
  },

  "update credential": {
    usage:
      "usage: update credential --id <id> [--name <name>] [--value-file <path|->] [--value-timeout <duration>]",
    parse: {
      id: { type: "string" },
      name: { type: "string" },
      "value-file": { type: "string" },
      "value-timeout": { type: "string" },
    },
    async handler(args, deps) {
      return runUpdateCredential(args, deps.updateCredential, {
        tty: process.stdin.isTTY
          ? (process.stdin as unknown as NodeJS.ReadStream)
          : undefined,
        stdin: process.stdin as unknown as NodeJS.ReadableStream,
      });
    },
  },

  "update repository": {
    usage:
      "usage: update repository --id <id> [--name <name>] [--branch <branch>] [--remote-url <url>] [--reclone]",
    parse: {
      id: { type: "string" },
      name: { type: "string" },
      branch: { type: "string" },
      "remote-url": { type: "string" },
      reclone: { type: "boolean" },
    },
    async handler(args, deps) {
      return runUpdateRepository(args, deps.updateRepository);
    },
  },

  "update notification": {
    usage:
      "usage: update notification --id <id> [--name <name>] [--destination <dest>]",
    parse: {
      id: { type: "string" },
      name: { type: "string" },
      destination: { type: "string" },
    },
    async handler(args, deps) {
      return runUpdateNotification(args, deps.updateNotification);
    },
  },

  "update filesystem": {
    usage: "usage: update filesystem --id <id> [--name <name>] [--path <path>]",
    parse: {
      id: { type: "string" },
      name: { type: "string" },
      path: { type: "string" },
    },
    async handler(args, deps) {
      return runUpdateFilesystem(args, deps.updateFilesystem);
    },
  },

  "import resource": {
    usage: "usage: import resource --path <file>",
    parse: {
      path: { type: "string" },
    },
    async handler(args, deps) {
      return runImportResource(args, deps.importResources);
    },
  },

  "import graph": {
    usage:
      "usage: import graph <dir> [--create --project <id>] [--apply --initiative <id>] [--dry-run] [--delete-missing [--confirm-delete]] [--bind alias=<id>]...",
    positional: "dir",
    parse: {
      dir: { type: "string" },
      create: { type: "boolean" },
      apply: { type: "boolean" },
      "dry-run": { type: "boolean" },
      "delete-missing": { type: "boolean" },
      "confirm-delete": { type: "boolean" },
      project: { type: "string" },
      initiative: { type: "string" },
      bind: { type: "string", multiple: true },
    },
    async handler(args, deps) {
      // Parse --bind alias=value pairs into a Record<string, string>
      const bindRaw = args["bind"] as string[] | undefined;
      const bind: Record<string, string> | undefined = bindRaw
        ? Object.fromEntries(
            bindRaw.map((entry) => {
              const eq = entry.indexOf("=");
              return eq === -1
                ? [entry, ""]
                : [entry.slice(0, eq), entry.slice(eq + 1)];
            }),
          )
        : undefined;

      return runImportGraph(
        {
          dir: (args["dir"] as string | undefined) ?? ".",
          create: (args["create"] as boolean | undefined) ?? false,
          apply: (args["apply"] as boolean | undefined) ?? false,
          dryRun: (args["dry-run"] as boolean | undefined) ?? false,
          deleteMissing:
            (args["delete-missing"] as boolean | undefined) ?? false,
          confirmDelete:
            (args["confirm-delete"] as boolean | undefined) ?? false,
          project: args["project"] as string | undefined,
          initiative: args["initiative"] as string | undefined,
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
              const id = await deps.findResource.execute({ projectId, name });
              return [{ id }];
            } catch {
              return [];
            }
          },
        },
      );
    },
  },

  "export initiative": {
    usage: "usage: export initiative <id> --out <dir>",
    positional: "id",
    parse: {
      id: { type: "string" },
      out: { type: "string" },
    },
    async handler(args, deps) {
      return runExportInitiative(
        { id: args["id"] as string, out: args["out"] as string | undefined },
        deps.exportInitiative,
      );
    },
  },

  login: {
    usage:
      "usage: login <provider> --project <id> --name <name> [--method browser|device_code]",
    positional: "provider",
    parse: {
      provider: { type: "string" },
      project: { type: "string" },
      name: { type: "string" },
      method: { type: "string" },
    },
    async handler(args, deps) {
      return runLogin(args["provider"] as string, args, deps.login);
    },
  },

  "get models": {
    usage: "usage: get models [--provider <provider>] [--json]",
    parse: {
      provider: { type: "string" },
      json: { type: "boolean" },
    },
    handler(args, deps) {
      return Promise.resolve(runGetModels(args, deps.listModels));
    },
  },

  "diagnostics export": {
    usage:
      "usage: diagnostics export --initiative <id> --out <path> [--task <id>] [--debug]",
    parse: {
      initiative: { type: "string" },
      task: { type: "string" },
      out: { type: "string" },
      debug: { type: "boolean" },
    },
    async handler(args, deps) {
      return runDiagnosticsExport(args, deps.diagnosticsExport);
    },
  },

  "repo land": {
    usage:
      "usage: repo land --repository <id> --workspace <dir> --base <branch> --candidate <sha>",
    parse: {
      repository: { type: "string" },
      workspace: { type: "string" },
      base: { type: "string" },
      candidate: { type: "string" },
    },
    async handler(args, deps) {
      return runRepoLand(args, deps.repoLanding, deps.resolveHomeDir);
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

  let entry = COMMANDS[key];
  let rest = argv.slice(2);

  // Single-word command: the "object" slot contains a flag, is absent, or is
  // the leading positional of a command that declares one (e.g. `login <provider>`).
  // Try looking up by verb alone and consume from argv[1] onward.
  if (entry === undefined) {
    const singleEntry = COMMANDS[verb];
    if (
      singleEntry !== undefined &&
      (obj === "" ||
        obj.startsWith("-") ||
        singleEntry.positional !== undefined)
    ) {
      entry = singleEntry;
      rest = argv.slice(1);
    }
  }

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

  // Parse remaining flags in strict mode.
  // Commands that declare `positional` accept one leading positional arg.
  const allowPositionals = entry.positional !== undefined;
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: rest,
      options: entry.parse,
      strict: true,
      allowPositionals,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      stdout: [],
      stderr: [`error: ${msg}`, `usage: ${entry.usage}`],
    };
  }

  // Promote the first positional to the declared named flag when not already set.
  let values = parsed.values as Record<string, unknown>;
  if (
    entry.positional !== undefined &&
    parsed.positionals.length > 0 &&
    values[entry.positional] === undefined
  ) {
    values = { ...values, [entry.positional]: parsed.positionals[0] };
  }

  return entry.handler(values, deps);
}

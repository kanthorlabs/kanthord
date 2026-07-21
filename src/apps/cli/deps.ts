import type { GetDbStatus } from "../../app/db/get-db-status.ts";
import type { MigrateDb } from "../../app/db/migrate-db.ts";
import type { ExportInitiative } from "../../app/graph/export-initiative.ts";
import type { CreateInitiative } from "../../app/initiative/create-initiative.ts";
import type { FindInitiative } from "../../app/initiative/find-initiative.ts";
import type { ListInitiatives } from "../../app/initiative/list-initiatives.ts";
import type { PauseInitiative } from "../../app/initiative/pause-initiative.ts";
import type { RenameInitiative } from "../../app/initiative/rename-initiative.ts";
import type { ResumeInitiative } from "../../app/initiative/resume-initiative.ts";
import type { DiagnosticsExport } from "../../app/observability/diagnostics-export.ts";
import type { CreateObjective } from "../../app/objective/create-objective.ts";
import type { FindObjective } from "../../app/objective/find-objective.ts";
import type { ListObjectives } from "../../app/objective/list-objectives.ts";
import type { RenameObjective } from "../../app/objective/rename-objective.ts";
import type { CreateProject } from "../../app/project/create-project.ts";
import type { FindProject } from "../../app/project/find-project.ts";
import type { GetProject } from "../../app/project/get-project.ts";
import type { RenameProject } from "../../app/project/rename-project.ts";
import type { AddResource } from "../../app/resource/add-resource.ts";
import type { FindResource } from "../../app/resource/find-resource.ts";
import type { GetResource } from "../../app/resource/get-resource.ts";
import type { ImportResources } from "../../app/resource/import-resources.ts";
import type { UpdateAiProvider } from "../../app/resource/update-ai-provider.ts";
import type { UpdateCredential } from "../../app/resource/update-credential.ts";
import type { UpdateFilesystem } from "../../app/resource/update-filesystem.ts";
import type { UpdateNotification } from "../../app/resource/update-notification.ts";
import type { UpdateRepository } from "../../app/resource/update-repository.ts";
import type { AddDependency } from "../../app/task/add-dependency.ts";
import type { ApproveTask } from "../../app/task/approve-task.ts";
import type { GetTask } from "../../app/task/get-task.ts";
import type { ListEvents } from "../../app/task/list-events.ts";
import type { ListTasks } from "../../app/task/list-tasks.ts";
import type { RejectTask } from "../../app/task/reject-task.ts";
import type { RemoveDependency } from "../../app/task/remove-dependency.ts";
import type { GetConflict } from "../../app/task/get-conflict.ts";
import type { RetryTask } from "../../app/task/retry-task.ts";
import type { RunDaemon } from "../../app/task/run-daemon.ts";
import type { CreateTask } from "../../app/task/create-task.ts";
import type { CreateGraph } from "../../app/graph/create-graph.ts";
import type { ApplyGraph } from "../../app/graph/apply-graph.ts";
import type { LoginDeps } from "./login.ts";
import type { ListModels } from "./models.ts";

/**
 * Minimal structural surface of the workspace manager that the CLI bundle
 * exposes. Declared locally (rather than importing `WorkspaceManager` from
 * `workspace/port.ts`) so this `apps/` module honors the architecture boundary:
 * `apps/` may depend on `app/` only, never a capability port. The concrete
 * `LocalWorkspaceManager` (an adapter) remains structurally assignable to this
 * shape, so `composition.ts` can return it as part of `CliDeps`.
 */
export interface CliWorkspace {
  dir: string;
  branch: string;
  baseCommit: string;
}
export interface CliWorkspaceManager {
  prepare(taskId: string, source: unknown): Promise<CliWorkspace>;
  homeDir?(repoId: string): string;
}

/**
 * Minimal structural surface of the repository-landing capability that the CLI
 * bundle exposes. Declared locally (rather than importing `RepositoryLanding`
 * from `landing/port.ts` via `app/errors.ts`) so this `apps/` module honors the
 * architecture boundary: `apps/` may depend on `app/` only, never a capability
 * port type. The concrete `GitRepositoryLanding` (an adapter) remains
 * structurally assignable to this shape, so `composition.ts` can return it as
 * part of `CliDeps`. Mirrors the `CliWorkspaceManager` pattern.
 */
export interface CliRepositoryLanding {
  land(
    homeDir: string,
    candidate: unknown,
  ): Promise<{
    outcome:
      | { kind: "fast-forward" }
      | { kind: "merge"; mergeCommit: string }
      | { kind: "conflict"; files: string[] }
      | { kind: "already-landed"; canonicalSHA: string };
    canonicalSHA: string;
  }>;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Composition-root bundle injected by main.ts; extended by later Tasks. */
export interface CliDeps {
  // Index signature allows safe cast to Record<string, unknown> in tests.
  [key: string]: unknown;
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
  getConflict: GetConflict;
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
  repoLanding: CliRepositoryLanding;
  resolveHomeDir: (repoId: string) => string;
  workspaces: CliWorkspaceManager;
  newId: () => string;
  /** S3 (007.6): reads back the note (and optional conflict context) persisted at retry time. */
  getPriorFeedback: (
    taskId: string,
  ) =>
    | { note?: string; conflictContext?: string; priorSummary?: string }
    | undefined;
}

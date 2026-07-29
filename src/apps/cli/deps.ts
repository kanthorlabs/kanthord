import type { GetDbStatus } from "../../app/db/get-db-status.ts";
import type { MigrateDb } from "../../app/db/migrate-db.ts";
import type { ExportInitiative } from "../../app/graph/export-initiative.ts";
import type { CreateInitiative } from "../../app/initiative/create-initiative.ts";
import type { FindInitiative } from "../../app/initiative/find-initiative.ts";
import type { GetInitiative } from "../../app/initiative/get-initiative.ts";
import type { GetInitiativeGraph } from "../../app/initiative/get-initiative-graph.ts";
import type { ListInitiatives } from "../../app/initiative/list-initiatives.ts";
import type { PauseInitiative } from "../../app/initiative/pause-initiative.ts";
import type { RenameInitiative } from "../../app/initiative/rename-initiative.ts";
import type { ResumeInitiative } from "../../app/initiative/resume-initiative.ts";
import type { DiagnosticsExport } from "../../app/observability/diagnostics-export.ts";
import type { CreateObjective } from "../../app/objective/create-objective.ts";
import type { FindObjective } from "../../app/objective/find-objective.ts";
import type { GetObjective } from "../../app/objective/get-objective.ts";
import type { ListObjectives } from "../../app/objective/list-objectives.ts";
import type { RenameObjective } from "../../app/objective/rename-objective.ts";
import type { CreateProject } from "../../app/project/create-project.ts";
import type { FindProject } from "../../app/project/find-project.ts";
import type { GetProject } from "../../app/project/get-project.ts";
import type { ListProjects } from "../../app/project/list-projects.ts";
import type { RenameProject } from "../../app/project/rename-project.ts";
import type { AckProject } from "../../app/project/ack-project.ts";
import type { GetProjectOverview } from "../../app/project/get-project-overview.ts";
import type { GetDecisionQueue } from "../../app/project/get-decision-queue.ts";
import type { AddResource } from "../../app/resource/add-resource.ts";
import type { FindResource } from "../../app/resource/find-resource.ts";
import type { GetResource } from "../../app/resource/get-resource.ts";
import type { ImportResources } from "../../app/resource/import-resources.ts";
import type { ListResources } from "../../app/resource/list-resources.ts";
import type { UpdateCredential } from "../../app/resource/update-credential.ts";
import type { UpdateFilesystem } from "../../app/resource/update-filesystem.ts";
import type { UpdateNotification } from "../../app/resource/update-notification.ts";
import type { UpdateRepository } from "../../app/resource/update-repository.ts";
import type { AddDependency } from "../../app/task/add-dependency.ts";
import type { AddInitiativeDependency } from "../../app/initiative/add-initiative-dependency.ts";
import type { RemoveInitiativeDependency } from "../../app/initiative/remove-initiative-dependency.ts";
import type { AddObjectiveDependency } from "../../app/objective/add-objective-dependency.ts";
import type { RemoveObjectiveDependency } from "../../app/objective/remove-objective-dependency.ts";
import type { ApproveTask } from "../../app/task/approve-task.ts";
import type { ApproveObjective } from "../../app/objective/approve-objective.ts";
import type { RetryObjective } from "../../app/objective/retry-objective.ts";
import type { RejectObjective } from "../../app/objective/reject-objective.ts";
import type { GetTask } from "../../app/task/get-task.ts";
import type { ListEvents } from "../../app/task/list-events.ts";
import type { ListTasks } from "../../app/task/list-tasks.ts";
import type { RejectTask } from "../../app/task/reject-task.ts";
import type { AbandonTask } from "../../app/task/abandon-task.ts";
import type { RemoveDependency } from "../../app/task/remove-dependency.ts";
import type { GetConflict } from "../../app/task/get-conflict.ts";
import type { GetObjectiveConflict } from "../../app/objective/get-objective-conflict.ts";
import type { RetryTask } from "../../app/task/retry-task.ts";
import type { RunDaemon } from "../../app/task/run-daemon.ts";
import type { CreateTask } from "../../app/task/create-task.ts";
import type { PublishRepository } from "../../app/repository/publish-repository.ts";
import type { RegisterAiProvider } from "../../app/ai-provider/register-ai-provider.ts";
import type { GetAiProvider } from "../../app/ai-provider/get-ai-provider.ts";
import type { ListAiProviders } from "../../app/ai-provider/list-ai-providers.ts";
import type { SetDefaultAiProvider } from "../../app/ai-provider/set-default-ai-provider.ts";
import type { LogoutAiProvider } from "../../app/ai-provider/logout-ai-provider.ts";
import type { RemoveAiProvider } from "../../app/ai-provider/remove-ai-provider.ts";
import type { AssignAiProvider } from "../../app/ai-provider/assign-ai-provider.ts";
import type { UnassignAiProvider } from "../../app/ai-provider/unassign-ai-provider.ts";
import type { ResolveProjectChain } from "../../app/ai-provider/resolve-project-chain.ts";
import type { TestAiProvider } from "../../app/ai-provider/test-ai-provider.ts";
import type { ProbeAiProvider } from "../../app/project/probe-ai-provider.ts";
import type { CheckProject } from "../../app/project/check-project.ts";
import type { ObserveSetupFacts } from "../../app/project/observe-setup-facts.ts";
import type { SetupPrompt } from "./setup/prompt.ts";
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
  homeDir(repoId: string): string;
}

/**
 * Minimal structural surface of the repository-landing capability that the CLI
 * bundle exposes. Declared locally (rather than importing `RepositoryLanding`
 * from `landing/port.ts` via `app/errors.ts`) so this `apps/` module honors the
 * architecture boundary: `apps/` may depend on `app/` only, never a capability
 * port type. The concrete `GitRepositoryLanding` (an adapter) remains
 * structurally assignable to this shape, so `composition.ts` can return it as
 * part of `CliDeps`. Mirrors the `CliWorkspaceManager` pattern.
 *
 * Exposes the object-path methods (resolveTargetOID, preview, landPreviewed)
 * used by runRepoLand — no legacy land().
 */
export interface CliRepositoryLanding {
  resolveTargetOID(homeDir: string, branch: string): string | Promise<string>;
  preview(
    homeDir: string,
    candidate: unknown,
    targetOID: string,
  ): Promise<
    | { kind: "fast-forward"; candidateOID: string }
    | { kind: "mergeable"; treeOID: string }
    | {
        kind: "conflict";
        files: string[];
        perFile: { path: string; hunks: string }[];
      }
  >;
  landPreviewed(
    homeDir: string,
    candidate: unknown,
    previewOutcome: unknown,
    targetOID: string,
  ): Promise<{
    outcome:
      | { kind: "fast-forward" }
      | { kind: "merge"; mergeCommit: string }
      | { kind: "conflict"; files: string[] }
      | { kind: "already-landed"; canonicalSHA: string };
    canonicalSHA: string;
  }>;
}

/**
 * Minimal structural surface of the repository-probe capability that the CLI
 * bundle exposes. Declared locally (rather than importing `RepositoryProbe` from
 * `repository-probe/port.ts`) so this `apps/` module honors the architecture
 * boundary: `apps/` may depend on `app/` only, never a capability port type. The
 * concrete `GitRepositoryProbe` (an adapter) remains structurally assignable to
 * this shape, so `composition.ts` can return it as part of `CliDeps`. Mirrors the
 * `CliWorkspaceManager` pattern above. The `auth` union is inlined for the same
 * reason `resource.ts:14-17` inlines `ResourceType`: `RepositoryAuth` lives in
 * `domain/`. `REPOSITORY_PROBE_TIMEOUT_MS` stays owned by the port and is not
 * mirrored — nothing in `apps/` reads it.
 */
export interface CliRepositoryProbe {
  probe(input: {
    remoteUrl: string;
    branch: string;
    auth:
      | { kind: "ambient" }
      | { kind: "https-token"; credentialId: string }
      | { kind: "ssh-agent" };
  }): Promise<{ status: "ok" | "failed"; detail: string }>;
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
  listProjects: ListProjects;
  /** EPIC 016 Story 5 — `ack project --id <id> --cursor <ulid>`. The only writer of `project_acks`. */
  ackProject: AckProject;
  /** EPIC 016 Story 6 — `get overview --project <id>`. Read-only project summary. */
  getProjectOverview: GetProjectOverview;
  createInitiative: CreateInitiative;
  renameInitiative: RenameInitiative;
  findInitiative: FindInitiative;
  getInitiative: GetInitiative;
  getInitiativeGraph: GetInitiativeGraph;
  pauseInitiative: PauseInitiative;
  resumeInitiative: ResumeInitiative;
  createObjective: CreateObjective;
  renameObjective: RenameObjective;
  findObjective: FindObjective;
  getObjective: GetObjective;
  addResource: AddResource;
  findResource: FindResource;
  getResource: GetResource;
  listResources: ListResources;
  updateCredential: UpdateCredential;
  updateRepository: UpdateRepository;
  updateNotification: UpdateNotification;
  updateFilesystem: UpdateFilesystem;
  createTask: CreateTask;
  addDependency: AddDependency;
  removeDependency: RemoveDependency;
  addInitiativeDependency: AddInitiativeDependency;
  removeInitiativeDependency: RemoveInitiativeDependency;
  addObjectiveDependency: AddObjectiveDependency;
  removeObjectiveDependency: RemoveObjectiveDependency;
  listTasks: ListTasks;
  retryTask: RetryTask;
  getTask: GetTask;
  getConflict: GetConflict;
  getObjectiveConflict: GetObjectiveConflict;
  getDecisionQueue: GetDecisionQueue;
  approveTask: ApproveTask;
  approveObjective: ApproveObjective;
  retryObjective: RetryObjective;
  rejectObjective: RejectObjective;
  rejectTask: RejectTask;
  abandonTask: AbandonTask;
  buildDaemon: (
    failTaskIds: string[],
    failTransient?: Record<string, number>,
    logger?: Logger,
  ) => RunDaemon;
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
  publishRepository: PublishRepository;
  registerAiProvider: RegisterAiProvider;
  getAiProvider: GetAiProvider;
  listAiProviders: ListAiProviders;
  setDefaultAiProvider: SetDefaultAiProvider;
  logoutAiProvider: LogoutAiProvider;
  removeAiProvider: RemoveAiProvider;
  assignAiProvider: AssignAiProvider;
  unassignAiProvider: UnassignAiProvider;
  resolveProjectChain: ResolveProjectChain;
  testAiProvider: TestAiProvider;
  providerProbe: ProbeAiProvider;
  checkProject: CheckProject;
  /**
   * EPIC 015 Story 1 — fact collector for the guided setup wizard. Returns
   * the `ObservedFacts` value the pure `SetupPlan` decides against.
   * Consumed by the Step 4 executor (`run-setup.ts`); nothing in the CLI
   * reads it yet.
   */
  observeSetupFacts: ObserveSetupFacts;
  /**
   * EPIC 014 Story 6 — starts a daemon heartbeat (014 S3) so a live daemon
   * is visible to `check project`'s `daemon` check. The returned function
   * cancels the schedule; it is idempotent.
   */
  heartbeat: { start(): () => void };
  /**
   * EPIC 014 Story 4 — the read-only repository probe, exposed as a structural
   * mirror so `apps/` never imports `repository-probe/port.ts`. Consumed by
   * EPIC 015; nothing in the CLI reads it yet.
   */
  repositoryProbe: CliRepositoryProbe;
  resolveHomeDir: (repoId: string) => string;
  workspaces: CliWorkspaceManager;
  newId: () => string;
  /** S3 (007.6): reads back the note (and optional conflict context) persisted at retry time. */
  getPriorFeedback: (
    taskId: string,
  ) =>
    | { note?: string; conflictContext?: string; priorSummary?: string }
    | undefined;
  /**
   * EPIC 015 Story 5 — the interactive-prompt seam the guided setup
   * wizard injects. Wired in `composition.ts` over `node:readline` (the
   * same block `login` already uses).
   */
  setupPrompt: SetupPrompt;
  /**
   * EPIC 015 Story 5 — whether the process's stdin is a TTY. The
   * `kanthord setup project` leaf needs this to decide whether to
   * prompt (TTY) or to fail with a clear "use --answers" message
   * (no TTY). `process.stdin.isTTY === true` at the composition root.
   */
  stdinIsTty: boolean;
}

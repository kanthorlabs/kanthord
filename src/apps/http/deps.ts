import type { HttpLogger } from "./logger.ts";
import type { GetProject } from "../../app/project/get-project.ts";
import type { ListProjects } from "../../app/project/list-projects.ts";
import type { GetProjectOverview } from "../../app/project/get-project-overview.ts";
import type { ListInitiatives } from "../../app/initiative/list-initiatives.ts";
import type { GetInitiative } from "../../app/initiative/get-initiative.ts";
import type { GetInitiativeGraph } from "../../app/initiative/get-initiative-graph.ts";
import type { ListObjectives } from "../../app/objective/list-objectives.ts";
import type { GetObjective } from "../../app/objective/get-objective.ts";
import type { ListTasks } from "../../app/task/list-tasks.ts";
import type { GetTask } from "../../app/task/get-task.ts";
import type { ListResources } from "../../app/resource/list-resources.ts";
import type { GetResource } from "../../app/resource/get-resource.ts";
import type { ListAiProviders } from "../../app/ai-provider/list-ai-providers.ts";
import type { GetAiProvider } from "../../app/ai-provider/get-ai-provider.ts";
import type { ResolveProjectChain } from "../../app/ai-provider/resolve-project-chain.ts";
import type { ListModels } from "./views/model.ts";
import type { GetDecisionQueue } from "../../app/project/get-decision-queue.ts";
import type { GetConflict } from "../../app/task/get-conflict.ts";
import type { GetObjectiveConflict } from "../../app/objective/get-objective-conflict.ts";
import type { CreateProject } from "../../app/project/create-project.ts";
import type { RenameProject } from "../../app/project/rename-project.ts";
import type { CreateInitiative } from "../../app/initiative/create-initiative.ts";
import type { RenameInitiative } from "../../app/initiative/rename-initiative.ts";
import type { CreateObjective } from "../../app/objective/create-objective.ts";
import type { RenameObjective } from "../../app/objective/rename-objective.ts";
import type { CreateTask } from "../../app/task/create-task.ts";
import type { AddResource } from "../../app/resource/add-resource.ts";
import type { UpdateRepository } from "../../app/resource/update-repository.ts";
import type { UpdateCredential } from "../../app/resource/update-credential.ts";
import type { UpdateNotification } from "../../app/resource/update-notification.ts";
import type { UpdateFilesystem } from "../../app/resource/update-filesystem.ts";
import type { ImportResources } from "../../app/resource/import-resources.ts";
import type { AddDependency } from "../../app/task/add-dependency.ts";
import type { RemoveDependency } from "../../app/task/remove-dependency.ts";
import type { AddInitiativeDependency } from "../../app/initiative/add-initiative-dependency.ts";
import type { RemoveInitiativeDependency } from "../../app/initiative/remove-initiative-dependency.ts";
import type { AddObjectiveDependency } from "../../app/objective/add-objective-dependency.ts";
import type { RemoveObjectiveDependency } from "../../app/objective/remove-objective-dependency.ts";
import type { CreateGraph } from "../../app/graph/create-graph.ts";
import type { ApplyGraph } from "../../app/graph/apply-graph.ts";
import type { ExportInitiative } from "../../app/graph/export-initiative.ts";
import type { DiagnosticsExport } from "../../app/observability/diagnostics-export.ts";
import type { CheckGraph } from "../../app/graph/check-graph.ts";
import type { CheckProject } from "../../app/project/check-project.ts";

/**
 * What the HTTP routes need. One field per capability, added by the epic that
 * adds the route using it. Not CliDeps, not a god bag.
 */
export interface HttpDeps {
  readonly logger: HttpLogger;
  readonly getProject: GetProject;
  readonly listProjects: ListProjects;
  readonly getProjectOverview: GetProjectOverview;
  readonly listInitiatives: ListInitiatives;
  readonly getInitiative: GetInitiative;
  readonly getInitiativeGraph: GetInitiativeGraph;
  readonly listObjectives: ListObjectives;
  readonly getObjective: GetObjective;
  readonly listTasks: ListTasks;
  readonly getTask: GetTask;
  readonly listResources: ListResources;
  readonly getResource: GetResource;
  readonly listAiProviders: ListAiProviders;
  readonly getAiProvider: GetAiProvider;
  readonly resolveProjectChain: ResolveProjectChain;
  readonly listModels: ListModels;
  readonly getDecisionQueue: GetDecisionQueue;
  readonly getConflict: GetConflict;
  readonly getObjectiveConflict: GetObjectiveConflict;
  readonly createProject: CreateProject;
  readonly renameProject: RenameProject;
  readonly createInitiative: CreateInitiative;
  readonly renameInitiative: RenameInitiative;
  readonly createObjective: CreateObjective;
  readonly renameObjective: RenameObjective;
  readonly createTask: CreateTask;
  readonly addResource: AddResource;
  readonly updateRepository: UpdateRepository;
  readonly updateCredential: UpdateCredential;
  readonly updateNotification: UpdateNotification;
  readonly updateFilesystem: UpdateFilesystem;
  readonly importResources: ImportResources;
  readonly addDependency: AddDependency;
  readonly removeDependency: RemoveDependency;
  readonly addInitiativeDependency: AddInitiativeDependency;
  readonly removeInitiativeDependency: RemoveInitiativeDependency;
  readonly addObjectiveDependency: AddObjectiveDependency;
  readonly removeObjectiveDependency: RemoveObjectiveDependency;
  readonly createGraph: CreateGraph;
  readonly applyGraph: ApplyGraph;
  readonly exportInitiative: ExportInitiative;
  readonly diagnosticsExport: DiagnosticsExport;
  readonly checkGraph: CheckGraph;
  readonly checkProject: CheckProject;
  /**
   * `import graph --create` needs a caller-minted packageId
   * (`create-graph.ts:44`); the CLI passes `deps.newId`, so the row mints it.
   */
  readonly newId: () => string;
}

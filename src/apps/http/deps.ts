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
}

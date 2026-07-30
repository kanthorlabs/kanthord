import { packageVersion } from "../version.ts";
import type { HttpDeps } from "./deps.ts";
import { uiShell } from "./ui.ts";
import { healthView } from "./views/health.ts";
import { projectView, projectOverviewView } from "./views/project.ts";
import {
  initiativeView,
  initiativeDetailView,
  initiativeGraphView,
} from "./views/initiative.ts";
import { objectiveView, objectiveDetailView } from "./views/objective.ts";
import {
  taskRowView,
  taskDetailView,
  TASK_STATUS_VALUES,
} from "./views/task.ts";
import { resourceView, type HttpResourceType } from "./views/resource.ts";
import { aiProviderView } from "./views/ai-provider.ts";
import { modelView } from "./views/model.ts";
import { decisionQueueView } from "./views/queue.ts";
import { taskConflictView, objectiveConflictView } from "./views/conflict.ts";
import {
  optionalQueryString,
  optionalQueryInt,
  requirePathParam,
} from "./decode.ts";
import { InvalidInputError } from "./errors.ts";
import type { TaskStatus } from "../../app/errors.ts";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Raw request material handed to a row's `decode`. */
export interface RouteInput {
  readonly params: Readonly<Record<string, string>>;
  /** Koa's ctx.query shape: a value may be absent. */
  readonly query: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: unknown;
}

export interface RouteMeta {
  /** Stable key the UI codes against, e.g. "health.get". */
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly successStatus: 200 | 201 | 204;
  /** "json" → envelope; "html" → `present` returns the document body. */
  readonly kind: "json" | "html";
  /** CLI leaf paths this row covers, e.g. ["get project"]. May be empty. */
  readonly cliCommands: readonly string[];
}

/** The typed row an author writes. Input/Output are inferred, never annotated. */
export interface RouteDefinition<Input, Output> extends RouteMeta {
  /**
   * HTTP shape → use-case input. The only layer that touches HTTP-flavoured
   * data: params are strings, a query value may be absent or an array, the
   * body is whatever `@koa/bodyparser` parsed. Validate and coerce here —
   * `requirePathParam` rejects an id blank after `.trim()` with
   * `400 invalid_input`, so a single space never reaches a use case.
   * Never calls a use case; never touches the database.
   */
  readonly decode: (input: RouteInput) => Input;
  /**
   * Calls the use case and returns its result — usually one line, with no
   * logic of its own (no validation, no formatting). `deps` is a PARAMETER,
   * not a closure, so `ROUTES` stays a static const the policy tests can
   * iterate (decision 8).
   */
  readonly run: (deps: HttpDeps, input: NoInfer<Input>) => Promise<Output>;
  /**
   * Use-case result → wire DTO with a LITERAL field list, which
   * `dataEnvelope` then wraps as `{"data": …}`. Mandatory, not stylistic: a
   * use case returns a `domain/` entity and eslint `boundaries` forbids
   * `apps/` → `domain/`, so naming the fields here is the only legal answer
   * — and it stops an internal entity field leaking onto the wire.
   * Two exemptions: forbidden when `successStatus` is 204 (no body at all);
   * when `kind` is "html" it returns the document string and the envelope is
   * skipped — that is how `GET /` serves the UI shell.
   */
  readonly present?: (result: Output) => unknown;
}

/** The erased row the dispatcher and the policy tests iterate. */
export interface Route extends RouteMeta {
  readonly decode: (input: RouteInput) => unknown;
  readonly run: (deps: HttpDeps, input: unknown) => Promise<unknown>;
  readonly present?: (result: unknown) => unknown;
}

/**
 * The ONLY place a route row is cast. `run`'s Input is contravariant, so a
 * typed definition is not assignable to `Route` without this single erasure.
 */
export function defineRoute<Input, Output>(
  def: RouteDefinition<Input, Output>,
): Route {
  return def as unknown as Route;
}

/**
 * Builds one of the four typed project-scoped resource collections. Kept as
 * one helper directly above `ROUTES` so the four rows cannot drift apart
 * (decision 6).
 */
function resourceCollectionRoute(
  type: HttpResourceType,
  cliCommands: readonly string[],
): Route {
  return defineRoute({
    id: `project.${type}.list`,
    method: "GET",
    path: `/api/project/:id/${type}`,
    successStatus: 200,
    kind: "json",
    cliCommands,
    decode: ({ params, query }) => {
      const name = optionalQueryString(query, "name");
      return {
        projectId: requirePathParam(params, "id"),
        type,
        ...(name !== undefined ? { name } : {}),
      };
    },
    run: async (deps, input) => deps.listResources.execute(input),
    present: (result) => result.map(resourceView),
  });
}

export const ROUTES: readonly Route[] = [
  defineRoute({
    id: "health.get",
    method: "GET",
    path: "/healthz",
    successStatus: 200,
    kind: "json",
    cliCommands: [],
    decode: () => ({}),
    run: async () => ({ status: "ok" as const, version: packageVersion }),
    present: (result) => healthView(result),
  }),
  defineRoute({
    id: "ui.get",
    method: "GET",
    path: "/",
    successStatus: 200,
    kind: "html",
    cliCommands: [],
    decode: () => ({}),
    run: async () => uiShell(),
    present: (result) => result,
  }),
  defineRoute({
    id: "project.list",
    method: "GET",
    path: "/api/project",
    successStatus: 200,
    kind: "json",
    cliCommands: ["list project", "find project"],
    decode: ({ query }) => {
      const name = optionalQueryString(query, "name");
      return name === undefined ? {} : { name };
    },
    run: async (deps, input) => deps.listProjects.execute(input),
    present: (result) => result.map(projectView),
  }),
  defineRoute({
    id: "project.get",
    method: "GET",
    path: "/api/project/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["get project"],
    decode: ({ params }) => ({ id: requirePathParam(params, "id") }),
    run: async (deps, input) => deps.getProject.execute(input),
    present: (result) => projectView(result),
  }),
  defineRoute({
    id: "project.overview.get",
    method: "GET",
    path: "/api/project/:id/overview",
    successStatus: 200,
    kind: "json",
    cliCommands: ["get overview"],
    decode: ({ params }) => ({ projectId: requirePathParam(params, "id") }),
    run: async (deps, input) => deps.getProjectOverview.execute(input),
    present: (result) => projectOverviewView(result),
  }),
  defineRoute({
    id: "project.initiative.list",
    method: "GET",
    path: "/api/project/:id/initiative",
    successStatus: 200,
    kind: "json",
    cliCommands: ["list initiative", "find initiative"],
    decode: ({ params, query }) => {
      const projectId = requirePathParam(params, "id");
      const name = optionalQueryString(query, "name");
      return name === undefined ? { projectId } : { projectId, name };
    },
    run: async (deps, input) => deps.listInitiatives.execute(input),
    present: (result) => result.map(initiativeView),
  }),
  defineRoute({
    id: "initiative.get",
    method: "GET",
    path: "/api/initiative/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["get initiative"],
    decode: ({ params }) => ({ id: requirePathParam(params, "id") }),
    run: async (deps, input) => deps.getInitiative.execute(input),
    present: (result) => initiativeDetailView(result),
  }),
  defineRoute({
    id: "initiative.graph.get",
    method: "GET",
    path: "/api/initiative/:id/graph",
    successStatus: 200,
    kind: "json",
    cliCommands: ["get graph"],
    decode: ({ params }) => ({ id: requirePathParam(params, "id") }),
    run: async (deps, input) => deps.getInitiativeGraph.execute(input),
    present: (result) => initiativeGraphView(result),
  }),
  defineRoute({
    id: "initiative.objective.list",
    method: "GET",
    path: "/api/initiative/:id/objective",
    successStatus: 200,
    kind: "json",
    cliCommands: ["list objective", "find objective"],
    decode: ({ params, query }) => {
      const initiativeId = requirePathParam(params, "id");
      const name = optionalQueryString(query, "name");
      return name === undefined ? { initiativeId } : { initiativeId, name };
    },
    run: async (deps, input) => deps.listObjectives.execute(input),
    present: (result) => result.map(objectiveView),
  }),
  defineRoute({
    id: "objective.get",
    method: "GET",
    path: "/api/objective/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["get objective"],
    decode: ({ params }) => ({ id: requirePathParam(params, "id") }),
    run: async (deps, input) => deps.getObjective.execute(input),
    present: (result) => objectiveDetailView(result),
  }),
  defineRoute({
    id: "initiative.task.list",
    method: "GET",
    path: "/api/initiative/:id/task",
    successStatus: 200,
    kind: "json",
    cliCommands: ["list task"],
    decode: ({ params, query }) => {
      const status = optionalQueryString(query, "status");
      if (
        status !== undefined &&
        !TASK_STATUS_VALUES.includes(status as TaskStatus)
      ) {
        throw new InvalidInputError(
          "status",
          `must be one of ${TASK_STATUS_VALUES.join(", ")}`,
        );
      }
      const objectiveId = optionalQueryString(query, "objective");
      return {
        initiativeId: requirePathParam(params, "id"),
        ...(status !== undefined ? { status: status as TaskStatus } : {}),
        ...(objectiveId !== undefined ? { objectiveId } : {}),
      };
    },
    run: async (deps, input) => deps.listTasks.execute(input),
    present: (result) => result.map(taskRowView),
  }),
  defineRoute({
    id: "task.get",
    method: "GET",
    path: "/api/task/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["get task"],
    decode: ({ params }) => ({ id: requirePathParam(params, "id") }),
    run: async (deps, input) => deps.getTask.execute(input),
    present: (result) => taskDetailView(result),
  }),
  resourceCollectionRoute("repository", ["list repository", "find resource"]),
  resourceCollectionRoute("credential", ["list credential", "find resource"]),
  resourceCollectionRoute("notification", [
    "list notification",
    "find resource",
  ]),
  resourceCollectionRoute("filesystem", ["list filesystem", "find resource"]),
  defineRoute({
    id: "resource.get",
    method: "GET",
    path: "/api/resource/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["get resource", "get repository"],
    decode: ({ params }) => ({ id: requirePathParam(params, "id") }),
    run: async (deps, input) => deps.getResource.execute(input.id),
    present: (result) => resourceView(result),
  }),
  defineRoute({
    id: "ai-provider.list",
    method: "GET",
    path: "/api/ai-provider",
    successStatus: 200,
    kind: "json",
    cliCommands: ["list ai-provider"],
    decode: () => ({}),
    run: async (deps) => deps.listAiProviders.execute(),
    present: (result) => result.map(aiProviderView),
  }),
  defineRoute({
    id: "ai-provider.get",
    method: "GET",
    path: "/api/ai-provider/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["get ai-provider"],
    decode: ({ params }) => ({ id: requirePathParam(params, "id") }),
    run: async (deps, input) => deps.getAiProvider.execute(input.id),
    present: (result) => aiProviderView(result),
  }),
  defineRoute({
    id: "project.ai-provider.list",
    method: "GET",
    path: "/api/project/:id/ai-provider",
    successStatus: 200,
    kind: "json",
    cliCommands: ["list ai-provider"],
    decode: ({ params }) => ({
      projectId: requirePathParam(params, "id"),
    }),
    run: async (deps, input) =>
      deps.resolveProjectChain.execute(input.projectId),
    present: (result) => result.map(aiProviderView),
  }),
  defineRoute({
    id: "model.list",
    method: "GET",
    path: "/api/model",
    successStatus: 200,
    kind: "json",
    cliCommands: ["list model"],
    decode: ({ query }) => {
      const provider = optionalQueryString(query, "provider");
      return { ...(provider !== undefined ? { provider } : {}) };
    },
    run: async (deps, input) => deps.listModels(input.provider),
    present: (result) => result.map(modelView),
  }),
  defineRoute({
    id: "queue.get",
    method: "GET",
    path: "/api/queue",
    successStatus: 200,
    kind: "json",
    cliCommands: ["queue"],
    decode: ({ query }) => {
      const limit = optionalQueryInt(query, "limit", { min: 1, max: 500 });
      return { ...(limit !== undefined ? { limit } : {}) };
    },
    run: async (deps, input) => deps.getDecisionQueue.execute(input),
    present: (result) => decisionQueueView(result),
  }),
  defineRoute({
    id: "task.conflict.get",
    method: "GET",
    path: "/api/task/:id/conflict",
    successStatus: 200,
    kind: "json",
    cliCommands: ["get conflict"],
    decode: ({ params }) => ({ taskId: requirePathParam(params, "id") }),
    run: async (deps, input) => deps.getConflict.execute(input),
    present: (result) => taskConflictView(result),
  }),
  defineRoute({
    id: "objective.conflict.get",
    method: "GET",
    path: "/api/objective/:id/conflict",
    successStatus: 200,
    kind: "json",
    cliCommands: ["get conflict"],
    decode: ({ params }) => ({
      objectiveId: requirePathParam(params, "id"),
    }),
    run: async (deps, input) => deps.getObjectiveConflict.execute(input),
    present: (result) => objectiveConflictView(result),
  }),
];

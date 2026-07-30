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
import { idView, idsView } from "./views/shared.ts";
import { graphPackageView } from "./views/graph-package.ts";
import { graphCreateView, graphApplyView } from "./views/graph-apply.ts";
import { readinessEntryView, projectReadinessView } from "./views/readiness.ts";
import { diagnosticView } from "./views/diagnostic.ts";
import {
  optionalQueryString,
  optionalQueryInt,
  requirePathParam,
} from "./decode.ts";
import {
  requireBodyString,
  optionalBodyString,
  optionalBodyStringArray,
  optionalBodyBool,
  optionalBodyRecord,
  requireBodyObjectArray,
  requireBodyRepositoryAuth,
  optionalBodyRepositoryAuth,
  requireBodyObject,
} from "./body.ts";
import { parseGraphPackageDocument } from "../../app/graph/decode-graph-package.ts";
import { InvalidInputError } from "./errors.ts";
import type { TaskStatus } from "../../app/errors.ts";
import type { AddResourceInput } from "../../app/resource/add-resource.ts";

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
  /**
   * Builds the `Location` header value for a create. Required iff
   * `successStatus === 201`, forbidden otherwise, and enforced by the
   * route-policy test exactly as `present` is. Never derived from `path`: two
   * rows point at a DIFFERENT resource than the one they posted to
   * (`project.credential.create` → `/api/resource/<id>`, `project.graph.create`
   * → `/api/initiative/<id>`), so string surgery on `path` would be wrong.
   */
  readonly location?: (result: Output) => string;
  /**
   * The `id` of the GET row that IS this item's representation. Required iff
   * `method === "PATCH"`, forbidden otherwise. The dispatcher runs that row's
   * `decode`/`run`/`present` over the SAME params to compute the `If-Match`
   * validator, then again after the write to answer `200` with the fresh DTO —
   * so a PATCH row declares no `present` of its own.
   */
  readonly readRow?: string;
}

/** The erased row the dispatcher and the policy tests iterate. */
export interface Route extends RouteMeta {
  readonly decode: (input: RouteInput) => unknown;
  readonly run: (deps: HttpDeps, input: unknown) => Promise<unknown>;
  readonly present?: (result: unknown) => unknown;
  readonly location?: (result: unknown) => string;
  readonly readRow?: string;
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

/**
 * The four typed resource creates (decision 5). Each decoder's return type is
 * ANNOTATED so `type` and `provider` keep their literal types without a cast,
 * and each `type` is bound literally here — never read from the body.
 */
function decodeRepositoryCreate({
  params,
  body,
}: RouteInput): AddResourceInput {
  return {
    type: "repository",
    projectId: requirePathParam(params, "id"),
    name: requireBodyString(body, "name"),
    remoteUrl: requireBodyString(body, "remoteUrl"),
    branch: requireBodyString(body, "branch"),
    // AddResource derives the home path from remoteUrl when path is ""
    // (add-resource.ts:102-109).
    path: optionalBodyString(body, "path") ?? "",
    auth: requireBodyRepositoryAuth(body, "auth"),
  };
}

function decodeCredentialCreate({
  params,
  body,
}: RouteInput): AddResourceInput {
  return {
    type: "credential",
    projectId: requirePathParam(params, "id"),
    name: requireBodyString(body, "name"),
    provider: requireBodyString(body, "provider"),
    // The only secret 021 carries. It travels in the body because the CLI's
    // --value-file has no HTTP twin, and it is never presented back.
    value: requireBodyString(body, "value"),
  };
}

function decodeNotificationCreate({
  params,
  body,
}: RouteInput): AddResourceInput {
  const provider = requireBodyString(body, "provider");
  if (provider !== "slack" && provider !== "telegram") {
    throw new InvalidInputError("provider", 'must be "slack" or "telegram"');
  }
  return {
    type: "notification",
    projectId: requirePathParam(params, "id"),
    name: requireBodyString(body, "name"),
    provider,
    destination: requireBodyString(body, "destination"),
  };
}

function decodeFilesystemCreate({
  params,
  body,
}: RouteInput): AddResourceInput {
  return {
    type: "filesystem",
    projectId: requirePathParam(params, "id"),
    name: requireBodyString(body, "name"),
    path: requireBodyString(body, "path"),
  };
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
  defineRoute({
    id: "project.create",
    method: "POST",
    path: "/api/project",
    successStatus: 201,
    kind: "json",
    cliCommands: ["create project"],
    decode: ({ body }) => ({ name: requireBodyString(body, "name") }),
    run: async (deps, input) => deps.createProject.execute(input),
    present: (result) => idView(result),
    location: (result) => `/api/project/${result}`,
  }),
  defineRoute({
    id: "project.patch",
    method: "PATCH",
    path: "/api/project/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["rename project"],
    readRow: "project.get",
    decode: ({ params, body }) => ({
      id: requirePathParam(params, "id"),
      name: requireBodyString(body, "name"),
    }),
    run: async (deps, input) => deps.renameProject.execute(input),
  }),
  defineRoute({
    id: "project.initiative.create",
    method: "POST",
    path: "/api/project/:id/initiative",
    successStatus: 201,
    kind: "json",
    cliCommands: ["create initiative"],
    decode: ({ params, body }) => {
      const after = optionalBodyStringArray(body, "after");
      return {
        projectId: requirePathParam(params, "id"),
        name: requireBodyString(body, "name"),
        paused: optionalBodyBool(body, "paused") ?? false,
        ...(after !== undefined ? { after } : {}),
      };
    },
    run: async (deps, input) => deps.createInitiative.execute(input),
    present: (result) => idView(result),
    location: (result) => `/api/initiative/${result}`,
  }),
  defineRoute({
    id: "initiative.patch",
    method: "PATCH",
    path: "/api/initiative/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["rename initiative"],
    readRow: "initiative.get",
    decode: ({ params, body }) => ({
      id: requirePathParam(params, "id"),
      name: requireBodyString(body, "name"),
    }),
    run: async (deps, input) => deps.renameInitiative.execute(input),
  }),
  defineRoute({
    id: "initiative.objective.create",
    method: "POST",
    path: "/api/initiative/:id/objective",
    successStatus: 201,
    kind: "json",
    cliCommands: ["create objective"],
    decode: ({ params, body }) => {
      const after = optionalBodyStringArray(body, "after");
      return {
        initiativeId: requirePathParam(params, "id"),
        name: requireBodyString(body, "name"),
        ...(after !== undefined ? { after } : {}),
      };
    },
    run: async (deps, input) => deps.createObjective.execute(input),
    present: (result) => idView(result),
    location: (result) => `/api/objective/${result}`,
  }),
  defineRoute({
    id: "objective.patch",
    method: "PATCH",
    path: "/api/objective/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["rename objective"],
    readRow: "objective.get",
    decode: ({ params, body }) => ({
      id: requirePathParam(params, "id"),
      name: requireBodyString(body, "name"),
    }),
    run: async (deps, input) => deps.renameObjective.execute(input),
  }),
  defineRoute({
    id: "objective.task.create",
    method: "POST",
    path: "/api/objective/:id/task",
    successStatus: 201,
    kind: "json",
    cliCommands: ["create task"],
    decode: ({ params, body }) => {
      const instructions = optionalBodyString(body, "instructions");
      const ac = optionalBodyStringArray(body, "ac");
      const verification = optionalBodyStringArray(body, "verification");
      const agent = optionalBodyString(body, "agent");
      const dependencies = optionalBodyStringArray(body, "dependencies");
      const context = optionalBodyRecord(body, "context");
      return {
        objectiveId: requirePathParam(params, "id"),
        title: requireBodyString(body, "title"),
        ...(instructions !== undefined ? { instructions } : {}),
        ...(ac !== undefined ? { ac } : {}),
        ...(verification !== undefined ? { verification } : {}),
        ...(agent !== undefined ? { agent } : {}),
        ...(dependencies !== undefined ? { dependencies } : {}),
        ...(context !== undefined ? { context } : {}),
      };
    },
    run: async (deps, input) => deps.createTask.execute(input),
    present: (result) => idView(result),
    location: (result) => `/api/task/${result}`,
  }),
  defineRoute({
    id: "project.repository.create",
    method: "POST",
    path: "/api/project/:id/repository",
    successStatus: 201,
    kind: "json",
    cliCommands: ["create repository"],
    decode: decodeRepositoryCreate,
    run: async (deps, input) => deps.addResource.execute(input),
    present: (result) => idView(result),
    location: (result) => `/api/resource/${result}`,
  }),
  defineRoute({
    id: "project.credential.create",
    method: "POST",
    path: "/api/project/:id/credential",
    successStatus: 201,
    kind: "json",
    cliCommands: ["create credential"],
    decode: decodeCredentialCreate,
    run: async (deps, input) => deps.addResource.execute(input),
    present: (result) => idView(result),
    location: (result) => `/api/resource/${result}`,
  }),
  defineRoute({
    id: "project.notification.create",
    method: "POST",
    path: "/api/project/:id/notification",
    successStatus: 201,
    kind: "json",
    cliCommands: ["create notification"],
    decode: decodeNotificationCreate,
    run: async (deps, input) => deps.addResource.execute(input),
    present: (result) => idView(result),
    location: (result) => `/api/resource/${result}`,
  }),
  defineRoute({
    id: "project.filesystem.create",
    method: "POST",
    path: "/api/project/:id/filesystem",
    successStatus: 201,
    kind: "json",
    cliCommands: ["create filesystem"],
    decode: decodeFilesystemCreate,
    run: async (deps, input) => deps.addResource.execute(input),
    present: (result) => idView(result),
    location: (result) => `/api/resource/${result}`,
  }),
  defineRoute({
    id: "repository.patch",
    method: "PATCH",
    path: "/api/repository/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["update repository"],
    readRow: "resource.get",
    decode: ({ params, body }) => {
      const name = optionalBodyString(body, "name");
      const branch = optionalBodyString(body, "branch");
      const path = optionalBodyString(body, "path");
      const remoteUrl = optionalBodyString(body, "remoteUrl");
      const auth = optionalBodyRepositoryAuth(body, "auth");
      const reclone = optionalBodyBool(body, "reclone");
      // `type` is the ONE immutable probe forwarded — see Constraints.
      const type = optionalBodyString(body, "type");
      return {
        id: requirePathParam(params, "id"),
        ...(name !== undefined ? { name } : {}),
        ...(branch !== undefined ? { branch } : {}),
        ...(path !== undefined ? { path } : {}),
        ...(remoteUrl !== undefined ? { remoteUrl } : {}),
        ...(auth !== undefined ? { auth } : {}),
        ...(reclone !== undefined ? { reclone } : {}),
        ...(type !== undefined ? { type } : {}),
      };
    },
    run: async (deps, input) => deps.updateRepository.execute(input),
  }),
  defineRoute({
    id: "credential.patch",
    method: "PATCH",
    path: "/api/credential/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["update credential"],
    readRow: "resource.get",
    decode: ({ params, body }) => {
      const name = optionalBodyString(body, "name");
      const value = optionalBodyString(body, "value");
      const type = optionalBodyString(body, "type");
      return {
        id: requirePathParam(params, "id"),
        ...(name !== undefined ? { name } : {}),
        ...(value !== undefined ? { value } : {}),
        ...(type !== undefined ? { type } : {}),
      };
    },
    run: async (deps, input) => deps.updateCredential.execute(input),
  }),
  defineRoute({
    id: "notification.patch",
    method: "PATCH",
    path: "/api/notification/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["update notification"],
    readRow: "resource.get",
    decode: ({ params, body }) => {
      const name = optionalBodyString(body, "name");
      const destination = optionalBodyString(body, "destination");
      const type = optionalBodyString(body, "type");
      return {
        id: requirePathParam(params, "id"),
        ...(name !== undefined ? { name } : {}),
        ...(destination !== undefined ? { destination } : {}),
        ...(type !== undefined ? { type } : {}),
      };
    },
    run: async (deps, input) => deps.updateNotification.execute(input),
  }),
  defineRoute({
    id: "filesystem.patch",
    method: "PATCH",
    path: "/api/filesystem/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["update filesystem"],
    readRow: "resource.get",
    decode: ({ params, body }) => {
      const name = optionalBodyString(body, "name");
      const path = optionalBodyString(body, "path");
      const type = optionalBodyString(body, "type");
      return {
        id: requirePathParam(params, "id"),
        ...(name !== undefined ? { name } : {}),
        ...(path !== undefined ? { path } : {}),
        ...(type !== undefined ? { type } : {}),
      };
    },
    run: async (deps, input) => deps.updateFilesystem.execute(input),
  }),
  defineRoute({
    id: "project.resource.create",
    method: "POST",
    path: "/api/project/:id/resource",
    successStatus: 200,
    kind: "json",
    cliCommands: ["import resource"],
    decode: ({ params, body }) => ({
      projectId: requirePathParam(params, "id"),
      entries: requireBodyObjectArray(body, "entries"),
    }),
    run: async (deps, input) => deps.importResources.execute(input),
    present: (result) => idsView(result),
  }),
  defineRoute({
    id: "task.dependency.create",
    method: "POST",
    path: "/api/task/:id/dependency",
    successStatus: 204,
    kind: "json",
    cliCommands: ["add dependency"],
    decode: ({ params, body }) => ({
      taskId: requirePathParam(params, "id"),
      dependencyId: requireBodyString(body, "dependencyId"),
    }),
    run: async (deps, input) => deps.addDependency.execute(input),
  }),
  defineRoute({
    id: "task.dependency.delete",
    method: "DELETE",
    path: "/api/task/:id/dependency/:dependencyId",
    successStatus: 204,
    kind: "json",
    cliCommands: ["remove dependency"],
    decode: ({ params }) => ({
      taskId: requirePathParam(params, "id"),
      dependencyId: requirePathParam(params, "dependencyId"),
    }),
    run: async (deps, input) => deps.removeDependency.execute(input),
  }),
  defineRoute({
    id: "initiative.dependency.create",
    method: "POST",
    path: "/api/initiative/:id/dependency",
    successStatus: 204,
    kind: "json",
    cliCommands: ["add initiative-dependency"],
    decode: ({ params, body }) => ({
      initiativeId: requirePathParam(params, "id"),
      dependencyId: requireBodyString(body, "dependencyId"),
    }),
    run: async (deps, input) => deps.addInitiativeDependency.execute(input),
  }),
  defineRoute({
    id: "initiative.dependency.delete",
    method: "DELETE",
    path: "/api/initiative/:id/dependency/:dependencyId",
    successStatus: 204,
    kind: "json",
    cliCommands: ["remove initiative-dependency"],
    decode: ({ params }) => ({
      initiativeId: requirePathParam(params, "id"),
      dependencyId: requirePathParam(params, "dependencyId"),
    }),
    run: async (deps, input) => deps.removeInitiativeDependency.execute(input),
  }),
  defineRoute({
    id: "objective.dependency.create",
    method: "POST",
    path: "/api/objective/:id/dependency",
    successStatus: 204,
    kind: "json",
    cliCommands: ["add objective-dependency"],
    decode: ({ params, body }) => ({
      objectiveId: requirePathParam(params, "id"),
      dependencyId: requireBodyString(body, "dependencyId"),
    }),
    run: async (deps, input) => deps.addObjectiveDependency.execute(input),
  }),
  defineRoute({
    id: "objective.dependency.delete",
    method: "DELETE",
    path: "/api/objective/:id/dependency/:dependencyId",
    successStatus: 204,
    kind: "json",
    cliCommands: ["remove objective-dependency"],
    decode: ({ params }) => ({
      objectiveId: requirePathParam(params, "id"),
      dependencyId: requirePathParam(params, "dependencyId"),
    }),
    run: async (deps, input) => deps.removeObjectiveDependency.execute(input),
  }),
  defineRoute({
    id: "project.graph.create",
    method: "POST",
    path: "/api/project/:id/graph",
    successStatus: 201,
    kind: "json",
    cliCommands: ["import graph"],
    decode: ({ params, body }) => {
      const bindings = optionalBodyRecord(body, "bindings");
      return {
        pkg: parseGraphPackageDocument(requireBodyObject(body, "pkg")),
        projectId: requirePathParam(params, "id"),
        paused: optionalBodyBool(body, "paused") ?? false,
        ...(bindings !== undefined ? { bindings } : {}),
      };
    },
    // packageId is minted here because only `run` sees deps (decision 6).
    run: async (deps, input) =>
      deps.createGraph.execute({
        pkg: input.pkg,
        projectId: input.projectId,
        packageId: deps.newId(),
        paused: input.paused,
        ...(input.bindings !== undefined ? { bindings: input.bindings } : {}),
      }),
    present: (result) => graphCreateView(result),
    location: (result) => `/api/initiative/${result.initiativeId}`,
  }),
  defineRoute({
    id: "initiative.graph.apply",
    method: "POST",
    path: "/api/initiative/:id/graph",
    successStatus: 200,
    kind: "json",
    cliCommands: ["import graph"],
    decode: ({ params, body }) => {
      const dryRun = optionalBodyBool(body, "dryRun");
      const deleteMissing = optionalBodyBool(body, "deleteMissing");
      const confirmDelete = optionalBodyBool(body, "confirmDelete");
      return {
        pkg: parseGraphPackageDocument(requireBodyObject(body, "pkg")),
        initiativeId: requirePathParam(params, "id"),
        ...(dryRun !== undefined ? { dryRun } : {}),
        ...(deleteMissing !== undefined ? { deleteMissing } : {}),
        ...(confirmDelete !== undefined ? { confirmDelete } : {}),
      };
    },
    run: async (deps, input) => deps.applyGraph.execute(input),
    present: (result) => graphApplyView(result),
  }),
  defineRoute({
    id: "initiative.package.get",
    method: "GET",
    path: "/api/initiative/:id/package",
    successStatus: 200,
    kind: "json",
    cliCommands: ["export initiative"],
    decode: ({ params }) => ({ id: requirePathParam(params, "id") }),
    // ExportInitiative takes a POSITIONAL string, not an input object.
    run: async (deps, input) => deps.exportInitiative.execute(input.id),
    present: (result) => graphPackageView(result),
  }),
  defineRoute({
    id: "initiative.diagnostic.export",
    method: "POST",
    path: "/api/initiative/:id/diagnostic",
    successStatus: 200,
    kind: "json",
    cliCommands: ["export diagnostic"],
    decode: ({ params, body }) => {
      // The CLI's `--out` is deliberately NOT accepted: a client-supplied server
      // filesystem path is an arbitrary-file-write primitive. The document is
      // returned, never written.
      const taskId = optionalBodyString(body, "task");
      const debug = optionalBodyBool(body, "debug");
      return {
        initiativeId: requirePathParam(params, "id"),
        ...(taskId !== undefined ? { taskId } : {}),
        ...(debug !== undefined ? { debug } : {}),
      };
    },
    run: async (deps, input) => deps.diagnosticsExport.build(input),
    present: (result) => diagnosticView(result),
  }),
  defineRoute({
    id: "graph.readiness.check",
    method: "POST",
    path: "/api/graph/readiness",
    successStatus: 200,
    kind: "json",
    cliCommands: ["check graph"],
    decode: ({ body }) => ({
      tasks: requireBodyObjectArray(body, "tasks").map((entry) => {
        const dependencies = optionalBodyStringArray(entry, "dependencies");
        return {
          id: requireBodyString(entry, "id"),
          ...(dependencies !== undefined ? { dependencies } : {}),
        };
      }),
    }),
    // CheckGraph.execute is synchronous; `run` is async, which is legal as is.
    run: async (deps, input) => deps.checkGraph.execute(input),
    present: (result) => result.map(readinessEntryView),
  }),
  defineRoute({
    id: "project.readiness.get",
    method: "GET",
    path: "/api/project/:id/readiness",
    successStatus: 200,
    kind: "json",
    cliCommands: ["check project"],
    decode: ({ params }) => ({
      id: requirePathParam(params, "id"),
      // The two probe flags are deliberately NOT exposed: --probe-provider makes
      // a real billable model call and --probe-repositories runs git ls-remote.
      // Probing belongs with EPIC 024's POST /api/ai-provider/:id/probe.
      probeRepositories: false,
      probeProvider: false,
    }),
    run: async (deps, input) => deps.checkProject.execute(input),
    present: (result) => projectReadinessView(result),
  }),
];

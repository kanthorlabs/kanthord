// ui/src/lib/api-client.ts — EPIC 026 rule R3: the ONLY module that calls fetch.
//
// It never sets an `Authorization` header, in any mode. Web mode gets the header
// from the browser's own Basic-auth cache; the dev loop gets it injected by the
// Vite proxy (`ui/vite.config.ts`); Electron gets it from the main process via
// `webRequest.onBeforeSendHeaders`. The API key therefore appears in no module
// that ships to the browser.
import type {
  ProjectDto,
  ProjectOverviewDto,
  ResourceDto,
  ResourceTypeKey,
  ResourceOfType,
  InitiativeRowDto,
  InitiativeDetailDto,
  ObjectiveRowDto,
  ObjectiveDetailDto,
  TaskRowDto,
  TaskDetailDto,
} from "./dto";
import { apiBaseUrl } from "./runtime";

/** The daemon wraps every success in `{"data": …}` (src/apps/http/envelope.ts). */
interface DataEnvelope<T> {
  readonly data: T;
}

/** And every failure in `{"error": {code, message, requestId}}`. */
interface ErrorEnvelope {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly requestId?: string;
  };
}

/** A non-2xx answer from the daemon, carrying its envelope code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

/**
 * Absolute-path route → the URL to fetch. The base comes from `runtime`, so
 * every mode uses one seam. `path` always starts with `/`.
 */
export function apiUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`api path must start with "/": ${path}`);
  }
  return `${apiBaseUrl()}${path}`;
}

/** GET a JSON route and unwrap its `data`. Throws ApiError on a non-2xx answer. */
export async function apiGet<T>(
  path: string,
  init?: { readonly signal?: AbortSignal },
): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: "GET",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...(init?.signal ? { signal: init.signal } : {}),
  });

  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const err = (body as ErrorEnvelope | undefined)?.error;
    throw new ApiError(
      response.status,
      err?.code ?? "transport_error",
      err?.message ?? `${response.status} for ${path}`,
      err?.requestId,
    );
  }

  return (body as DataEnvelope<T>).data;
}

// --- Story 02: api-path builder and fetch helpers ---

export interface RequestInitLike {
  readonly signal?: AbortSignal;
}

/** `path` + a query string built from the defined, non-empty params. */
export function apiPath(
  path: string,
  params?: Readonly<Record<string, string | undefined>>,
): string {
  if (!params) return path;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") {
      search.set(k, v);
    }
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

export function fetchProjects(
  name?: string,
  init?: RequestInitLike,
): Promise<ProjectDto[]> {
  return apiGet<ProjectDto[]>(apiPath("/api/project", { name }), init);
}

export function fetchProject(
  id: string,
  init?: RequestInitLike,
): Promise<ProjectDto> {
  return apiGet<ProjectDto>(`/api/project/${encodeURIComponent(id)}`, init);
}

export function fetchProjectOverview(
  id: string,
  init?: RequestInitLike,
): Promise<ProjectOverviewDto> {
  return apiGet<ProjectOverviewDto>(
    `/api/project/${encodeURIComponent(id)}/overview`,
    init,
  );
}

export function fetchResources<T extends ResourceTypeKey>(
  projectId: string,
  type: T,
  name?: string,
  init?: RequestInitLike,
): Promise<ResourceOfType<T>[]> {
  return apiGet<ResourceOfType<T>[]>(
    apiPath(`/api/project/${encodeURIComponent(projectId)}/${type}`, { name }),
    init,
  );
}

export function fetchResource(
  id: string,
  init?: RequestInitLike,
): Promise<ResourceDto> {
  return apiGet<ResourceDto>(`/api/resource/${encodeURIComponent(id)}`, init);
}

// --- Story 01: entity workspace fetch helpers ---

export function fetchInitiatives(
  projectId: string,
  init?: RequestInitLike,
): Promise<InitiativeRowDto[]> {
  return apiGet<InitiativeRowDto[]>(
    `/api/project/${encodeURIComponent(projectId)}/initiative`,
    init,
  );
}

export function fetchInitiative(
  id: string,
  init?: RequestInitLike,
): Promise<InitiativeDetailDto> {
  return apiGet<InitiativeDetailDto>(
    `/api/initiative/${encodeURIComponent(id)}`,
    init,
  );
}

export function fetchObjectives(
  initiativeId: string,
  init?: RequestInitLike,
): Promise<ObjectiveRowDto[]> {
  return apiGet<ObjectiveRowDto[]>(
    `/api/initiative/${encodeURIComponent(initiativeId)}/objective`,
    init,
  );
}

export function fetchObjective(
  id: string,
  init?: RequestInitLike,
): Promise<ObjectiveDetailDto> {
  return apiGet<ObjectiveDetailDto>(
    `/api/objective/${encodeURIComponent(id)}`,
    init,
  );
}

export function fetchTasks(
  initiativeId: string,
  objectiveId?: string,
  init?: RequestInitLike,
): Promise<TaskRowDto[]> {
  return apiGet<TaskRowDto[]>(
    apiPath(`/api/initiative/${encodeURIComponent(initiativeId)}/task`, {
      objective: objectiveId,
    }),
    init,
  );
}

export function fetchTask(
  id: string,
  init?: RequestInitLike,
): Promise<TaskDetailDto> {
  return apiGet<TaskDetailDto>(`/api/task/${encodeURIComponent(id)}`, init);
}

// --- Story 01: write transport ---

export interface Etagged<T> {
  readonly data: T;
  readonly etag: string;
}

export interface Created<T> {
  readonly data: T;
  readonly location: string;
}

/** GET a JSON route and unwrap its `data` + `etag`. Throws ApiError on non-2xx. */
export async function apiGetWithEtag<T>(
  path: string,
  init?: RequestInitLike,
): Promise<Etagged<T>> {
  const response = await fetch(apiUrl(path), {
    method: "GET",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...(init?.signal ? { signal: init.signal } : {}),
  });

  const body: unknown = await response.json().catch(() => undefined);

  if (response.status !== 200) {
    const err = (body as ErrorEnvelope | undefined)?.error;
    throw new ApiError(
      response.status,
      err?.code ?? "transport_error",
      err?.message ?? `${response.status} for ${path}`,
      err?.requestId,
    );
  }

  const etag = response.headers.get("etag");
  if (!etag) {
    throw new ApiError(500, "missing_etag", `no ETag on ${path}`);
  }

  return { data: (body as DataEnvelope<T>).data, etag };
}

/** PATCH with If-Match, returns `data` + `etag`. Throws ApiError on non-2xx. */
export async function apiPatch<T>(
  path: string,
  body: unknown,
  ifMatch: string,
  init?: RequestInitLike,
): Promise<Etagged<T>> {
  const response = await fetch(apiUrl(path), {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "if-match": ifMatch,
    },
    body: JSON.stringify(body),
    ...(init?.signal ? { signal: init.signal } : {}),
  });

  const respBody: unknown = await response.json().catch(() => undefined);

  if (response.status !== 200) {
    const err = (respBody as ErrorEnvelope | undefined)?.error;
    throw new ApiError(
      response.status,
      err?.code ?? "transport_error",
      err?.message ?? `${response.status} for ${path}`,
      err?.requestId,
    );
  }

  const etag = response.headers.get("etag");
  if (!etag) {
    throw new ApiError(500, "missing_etag", `no ETag on ${path}`);
  }

  return { data: (respBody as DataEnvelope<T>).data, etag };
}

/** POST that returns 201 + Location. Throws ApiError on non-201. */
export async function apiPostCreated<T>(
  path: string,
  body: unknown,
  init?: RequestInitLike,
): Promise<Created<T>> {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    ...(init?.signal ? { signal: init.signal } : {}),
  });

  const respBody: unknown = await response.json().catch(() => undefined);

  if (response.status !== 201) {
    const err = (respBody as ErrorEnvelope | undefined)?.error;
    throw new ApiError(
      response.status,
      err?.code ?? "transport_error",
      err?.message ?? `${response.status} for ${path}`,
      err?.requestId,
    );
  }

  const location = response.headers.get("location");
  if (!location) {
    throw new ApiError(500, "missing_location", `no Location on ${path}`);
  }

  return { data: (respBody as DataEnvelope<T>).data, location };
}

/** POST that returns 204 with no body. Throws ApiError on non-204. */
export async function apiPostNoContent(
  path: string,
  body: unknown,
  init?: RequestInitLike,
): Promise<void> {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    ...(init?.signal ? { signal: init.signal } : {}),
  });

  if (response.status !== 204) {
    const respBody: unknown = await response.json().catch(() => undefined);
    const err = (respBody as ErrorEnvelope | undefined)?.error;
    throw new ApiError(
      response.status,
      err?.code ?? "transport_error",
      err?.message ?? `${response.status} for ${path}`,
      err?.requestId,
    );
  }
}

/** DELETE that returns 204 with no body. Throws ApiError on non-204. */
export async function apiDeleteNoContent(
  path: string,
  init?: RequestInitLike,
): Promise<void> {
  const response = await fetch(apiUrl(path), {
    method: "DELETE",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...(init?.signal ? { signal: init.signal } : {}),
  });

  if (response.status !== 204) {
    const respBody: unknown = await response.json().catch(() => undefined);
    const err = (respBody as ErrorEnvelope | undefined)?.error;
    throw new ApiError(
      response.status,
      err?.code ?? "transport_error",
      err?.message ?? `${response.status} for ${path}`,
      err?.requestId,
    );
  }
}

// --- Story 04: project create/rename helpers ---

export async function createProject(
  name: string,
): Promise<Created<{ id: string }>> {
  return apiPostCreated("/api/project", { name });
}

export async function renameProject(
  id: string,
  name: string,
  ifMatch: string,
): Promise<Etagged<ProjectDto>> {
  return apiPatch<ProjectDto>(
    `/api/project/${encodeURIComponent(id)}`,
    { name },
    ifMatch,
  );
}

export async function fetchProjectWithEtag(
  id: string,
): Promise<Etagged<ProjectDto>> {
  return apiGetWithEtag<ProjectDto>(`/api/project/${encodeURIComponent(id)}`);
}

// --- Story 05: initiative/objective create/rename helpers ---

export async function createInitiative(
  projectId: string,
  name: string,
): Promise<Created<{ id: string }>> {
  return apiPostCreated(
    `/api/project/${encodeURIComponent(projectId)}/initiative`,
    { name },
  );
}

export async function renameInitiative(
  id: string,
  name: string,
  ifMatch: string,
): Promise<Etagged<InitiativeDetailDto>> {
  return apiPatch<InitiativeDetailDto>(
    `/api/initiative/${encodeURIComponent(id)}`,
    { name },
    ifMatch,
  );
}

export async function fetchInitiativeWithEtag(
  id: string,
): Promise<Etagged<InitiativeDetailDto>> {
  return apiGetWithEtag<InitiativeDetailDto>(
    `/api/initiative/${encodeURIComponent(id)}`,
  );
}

export async function createObjective(
  initiativeId: string,
  name: string,
): Promise<Created<{ id: string }>> {
  return apiPostCreated(
    `/api/initiative/${encodeURIComponent(initiativeId)}/objective`,
    { name },
  );
}

export async function renameObjective(
  id: string,
  name: string,
  ifMatch: string,
): Promise<Etagged<ObjectiveDetailDto>> {
  return apiPatch<ObjectiveDetailDto>(
    `/api/objective/${encodeURIComponent(id)}`,
    { name },
    ifMatch,
  );
}

export async function fetchObjectiveWithEtag(
  id: string,
): Promise<Etagged<ObjectiveDetailDto>> {
  return apiGetWithEtag<ObjectiveDetailDto>(
    `/api/objective/${encodeURIComponent(id)}`,
  );
}

// --- Story 06: task create helper ---

export interface TaskCreateBody {
  readonly title: string;
  readonly instructions?: string;
  readonly ac?: readonly string[];
  readonly verification?: readonly string[];
  readonly agent?: string;
  readonly dependencies?: readonly string[];
  readonly context?: Readonly<Record<string, string>>;
}

export async function createTask(
  objectiveId: string,
  body: TaskCreateBody,
): Promise<Created<{ id: string }>> {
  return apiPostCreated(
    `/api/objective/${encodeURIComponent(objectiveId)}/task`,
    body,
  );
}

// --- Story 07: dependency edge helpers ---

export type DependencyKind = "task" | "initiative" | "objective";

/** POST a dependency edge. 204 with no body; no If-Match, no ETag. */
export async function addDependency(
  kind: DependencyKind,
  id: string,
  dependencyId: string,
): Promise<void> {
  return apiPostNoContent(`/api/${kind}/${encodeURIComponent(id)}/dependency`, {
    dependencyId,
  });
}

/** DELETE a dependency edge. 204 with no body; no If-Match, no ETag. */
export async function removeDependency(
  kind: DependencyKind,
  id: string,
  dependencyId: string,
): Promise<void> {
  return apiDeleteNoContent(
    `/api/${kind}/${encodeURIComponent(id)}/dependency/${encodeURIComponent(dependencyId)}`,
  );
}

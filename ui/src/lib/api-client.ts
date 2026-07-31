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

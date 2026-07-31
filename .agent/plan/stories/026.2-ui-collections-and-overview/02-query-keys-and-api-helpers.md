# Story 02 — query keys, DTO types, `api-client` list helpers

Epic: `.agent/plan/epics/026.2-ui-collections-and-overview.md` (decision 11)
Depends on: EPIC 026.1.

## Change

### New file `ui/src/lib/dto.ts`

Type-only mirror of the wire shapes in index.md F3–F5. Declare exactly:

```ts
export interface ProjectDto {
  readonly id: string;
  readonly name: string;
}

export const TASK_STATUS_KEYS = [
  "pending",
  "running",
  "completed",
  "failed",
  "awaiting_confirmation",
  "discarded",
] as const;
export type TaskStatusKey = (typeof TASK_STATUS_KEYS)[number];
export type TaskCounts = Readonly<Record<TaskStatusKey, number>>;

export interface ActionDto {
  readonly kind: string;
  readonly target: { readonly type: string; readonly id: string };
  readonly targetDependencyId?: string;
  readonly requiresInput: readonly string[];
  readonly command?: string;
}

export interface OverviewInitiativeDto {
  readonly id: string;
  readonly name: string;
  readonly status: "building" | "landed" | "discarded";
  readonly paused: boolean;
  readonly taskCounts: TaskCounts;
  readonly needsHuman: boolean;
  readonly action: ActionDto | null;
}

export interface LaneDto {
  readonly repositoryId: string | null;
  readonly objectiveIds: readonly string[];
  readonly initiativeIds: readonly string[];
}

export interface DecisionDto {
  readonly action: ActionDto;
  readonly initiativeId: string;
  readonly objectiveId: string | null;
  readonly taskId: string | null;
  readonly downstream: number;
  readonly actionableSince: number | null;
}

export interface EventDto {
  readonly id: string;
  readonly type: string;
  readonly taskId?: string;
  readonly objectiveId?: string;
  readonly initiativeId?: string;
  readonly repositoryId?: string;
  readonly payload?: Readonly<Record<string, string>>;
}

export interface DigestDto {
  readonly since: string | null;
  readonly latest: string | null;
  readonly totalCount: number;
  readonly byType: Readonly<Record<string, number>>;
  readonly events: readonly EventDto[];
  readonly hasMore: boolean;
  readonly pageCursor: string | null;
}

export interface ProjectOverviewDto {
  readonly projectId: string;
  readonly initiatives: readonly OverviewInitiativeDto[];
  readonly lanes: readonly LaneDto[];
  readonly decisions: readonly DecisionDto[];
  readonly digest: DigestDto;
}

export const RESOURCE_TYPES = [
  "repository",
  "credential",
  "notification",
  "filesystem",
] as const;
export type ResourceTypeKey = (typeof RESOURCE_TYPES)[number];
export function isResourceType(value: string): value is ResourceTypeKey;

export type RepositoryAuthDto =
  | { readonly kind: "ambient" }
  | { readonly kind: "https-token"; readonly credentialId: string }
  | { readonly kind: "ssh-agent" };
export interface PublicationDto {
  readonly state: "unpublished" | "published" | "diverged";
  readonly remoteOID: string | null;
}
export interface RepositoryResourceDto {
  readonly type: "repository";
  readonly id: string;
  readonly projectId?: string;
  readonly name: string;
  readonly remoteUrl: string;
  readonly branch: string;
  readonly path: string;
  readonly auth: RepositoryAuthDto;
  readonly publication: PublicationDto | null;
}
export interface CredentialResourceDto {
  readonly type: "credential";
  readonly id: string;
  readonly projectId?: string;
  readonly name: string;
  readonly provider: string;
}
export interface NotificationResourceDto {
  readonly type: "notification";
  readonly id: string;
  readonly projectId?: string;
  readonly name: string;
  readonly provider: string;
  readonly destination: string;
}
export interface FilesystemResourceDto {
  readonly type: "filesystem";
  readonly id: string;
  readonly projectId?: string;
  readonly name: string;
  readonly path: string;
}
export type ResourceDto =
  | RepositoryResourceDto
  | CredentialResourceDto
  | NotificationResourceDto
  | FilesystemResourceDto;
export type ResourceOfType<T extends ResourceTypeKey> = Extract<
  ResourceDto,
  { type: T }
>;
```

`isResourceType` is `(RESOURCE_TYPES as readonly string[]).includes(value)`.
If EPIC 026.1's `ui/src/lib/status-role.ts` already exports a task-status or
initiative-status union (resolve with index.md F6), import and re-use it here
instead of redeclaring — do not ship two copies of one union.

### New file `ui/src/lib/query-keys.ts`

```ts
import type { QueryClient } from "@tanstack/react-query";
import type { ResourceTypeKey } from "./dto";

export const projectKeys = {
  all: () => ["project"] as const,
  list: (name?: string) =>
    name === undefined || name === ""
      ? (["project"] as const)
      : (["project", { name }] as const),
  detail: (id: string) => ["project", id] as const,
  overview: (id: string) => ["project", id, "overview"] as const,
  resources: (id: string, type: ResourceTypeKey, name?: string) =>
    name === undefined || name === ""
      ? (["project", id, "resource", type] as const)
      : (["project", id, "resource", type, { name }] as const),
};

export const resourceKeys = {
  detail: (id: string) => ["resource", id] as const,
};

/** Decision 11: a `digest.latest` change invalidates the overview key ONLY. */
export function invalidateOverview(
  client: QueryClient,
  projectId: string,
): Promise<void> {
  return client.invalidateQueries({
    queryKey: projectKeys.overview(projectId),
    exact: true,
  });
}
```

No other invalidation helper exists in this epic. No caller may invalidate
`["project"]` or any resource key.

### Append to `ui/src/lib/api-client.ts`

Keep the existing `ApiError`, `apiUrl`, `apiGet` untouched — `apiGet` stays the
only `fetch` caller (R3). Add:

```ts
export interface RequestInitLike {
  readonly signal?: AbortSignal;
}

/** `path` + a query string built from the defined, non-empty params. */
export function apiPath(
  path: string,
  params?: Readonly<Record<string, string | undefined>>,
): string;

export function fetchProjects(
  name?: string,
  init?: RequestInitLike,
): Promise<ProjectDto[]>;
export function fetchProject(
  id: string,
  init?: RequestInitLike,
): Promise<ProjectDto>;
export function fetchProjectOverview(
  id: string,
  init?: RequestInitLike,
): Promise<ProjectOverviewDto>;
export function fetchResources<T extends ResourceTypeKey>(
  projectId: string,
  type: T,
  name?: string,
  init?: RequestInitLike,
): Promise<ResourceOfType<T>[]>;
export function fetchResource(
  id: string,
  init?: RequestInitLike,
): Promise<ResourceDto>;
```

Pinned paths, each id passed through `encodeURIComponent`:

| helper                                   | path                                 |
| ---------------------------------------- | ------------------------------------ |
| `fetchProjects()`                        | `/api/project`                       |
| `fetchProjects("alpha")`                 | `/api/project?name=alpha`            |
| `fetchProject("p1")`                     | `/api/project/p1`                    |
| `fetchProjectOverview("p1")`             | `/api/project/p1/overview`           |
| `fetchResources("p1","credential")`      | `/api/project/p1/credential`         |
| `fetchResources("p1","credential","k1")` | `/api/project/p1/credential?name=k1` |
| `fetchResource("r1")`                    | `/api/resource/r1`                   |

`apiPath` builds the query with `URLSearchParams`, skipping any param that is
`undefined` or `""` — so a blank search never sends `name=` (the daemon answers
`400 invalid_input` for a blank value, index.md F3).

## Constraints

- Types only in `dto.ts`; no runtime validation, no zod, no schema generation.
- No new dependency (index.md F9).
- Helpers call `apiGet` and nothing else. They do not catch `ApiError`.

## Verify

- `npm run test --workspace ui -- src/lib/query-keys.test.ts` — new file
  `ui/src/lib/query-keys.test.ts` asserting:
  - `projectKeys.all()` is `["project"]`; `list()` and `list("")` are
    `["project"]`; `list("a")` is `["project", { name: "a" }]`;
    `detail("p1")` is `["project","p1"]`; `overview("p1")` is
    `["project","p1","overview"]`; `resources("p1","repository")` is
    `["project","p1","resource","repository"]`;
    `resources("p1","repository","x")` appends `{ name: "x" }`;
    `resourceKeys.detail("r1")` is `["resource","r1"]`.
  - `invalidateOverview` on a real `QueryClient`: seed cache data at
    `projectKeys.overview("p1")`, `projectKeys.list()`,
    `projectKeys.resources("p1","repository")` and
    `resourceKeys.detail("r1")` via `client.setQueryData`; after the call,
    `client.getQueryState(projectKeys.overview("p1"))?.isInvalidated === true`
    and the other three states have `isInvalidated === false`. Assert on the
    cache, never by reading source.
- `npm run test --workspace ui -- src/lib/api-client.test.ts` — add to the
  existing file, keeping its tests green:
  - each helper in the table above calls the stubbed `fetch` with exactly the
    listed URL (same-origin mode, so the URL is the bare path).
  - `fetchProjects("")` requests `/api/project` — no `name=`.
  - an id needing escaping (`fetchResource("a/b")`) requests
    `/api/resource/a%2Fb`.
  - every recorded request header set is exactly `["accept"]` — no
    `Authorization` (R3), the same assertion style as
    `api-client.test.ts:118-125`.
  - a 404 envelope still surfaces as `ApiError` from a helper.
- `npm run verify` exits 0.
- Proof: none directly — Stories 03–06 depend on this module.

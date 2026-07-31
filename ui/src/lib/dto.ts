// ui/src/lib/dto.ts — Type-only mirror of wire shapes (F3–F5).
// No runtime validation, no zod, no schema generation.

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
export function isResourceType(value: string): value is ResourceTypeKey {
  return (RESOURCE_TYPES as readonly string[]).includes(value);
}

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

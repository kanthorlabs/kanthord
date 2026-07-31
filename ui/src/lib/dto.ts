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

export const RESOURCE_TYPE_LABEL: Readonly<Record<ResourceTypeKey, string>> = {
  repository: "Repositories",
  credential: "Credentials",
  notification: "Notifications",
  filesystem: "Filesystems",
};

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

// --- Story 01: entity workspace DTOs ---

export interface UnsatisfiedEdgeDto {
  readonly id: string;
  readonly neverSatisfies: boolean;
}

export interface InitiativeRowDto {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly paused: boolean;
  readonly status?: string;
  readonly workspace?: string;
}

export interface InitiativeDetailDto {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly status: string;
  readonly paused: boolean;
  readonly branch: string;
  readonly workspace?: string;
  readonly after: readonly string[];
  readonly waiting: readonly UnsatisfiedEdgeDto[];
}

export interface ObjectiveRowDto {
  readonly id: string;
  readonly initiativeId: string;
  readonly name: string;
  readonly status?: string;
  readonly commitOid?: string;
  readonly parentOid?: string;
  readonly note?: string;
  readonly conflictReason?: string;
}

export interface IntegrationDto {
  readonly repository: string;
  readonly state: string;
}

export interface ObjectiveDetailDto {
  readonly id: string;
  readonly initiativeId: string;
  readonly name: string;
  readonly status: string;
  readonly commitOid?: string;
  readonly parentOid?: string;
  readonly integrations: readonly IntegrationDto[];
  readonly after: readonly string[];
  readonly waiting: readonly UnsatisfiedEdgeDto[];
  readonly conflictCause: string | null;
  readonly conflictReason: string | null;
  readonly note: string | null;
}

export interface TaskRowDto {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly state: string;
  readonly dependencies: readonly string[];
  readonly waiting: readonly string[];
}

export interface EvidenceDto {
  readonly command: string;
  readonly exitCode: number;
  readonly output: string;
}

export interface TaskResultDto {
  readonly workspace: string | null;
  readonly branch: string | null;
  readonly baseCommit: string | null;
  readonly proposalCommit: string | null;
  readonly commitSha: string | null;
  readonly summary: string | null;
  readonly reason: string | null;
  readonly rejectionResolution: string | null;
  readonly rejectionReason: string | null;
  readonly evidence: readonly EvidenceDto[] | null;
}

export interface LandingCandidateDto {
  readonly state: "pending" | "landed" | "conflict";
  readonly baseSHA: string;
  readonly candidateSHA: string;
  readonly target: string;
}

export interface TaskDetailDto {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly agent?: string;
  readonly objectiveId: string;
  /** On the wire from Story 00 onward; `null` is the degraded shape. */
  readonly initiativeId: string | null;
  readonly dependencies: readonly string[];
  readonly note?: string;
  readonly instructions?: string;
  readonly ac?: readonly string[];
  readonly verification?: readonly string[];
  readonly result: TaskResultDto | null;
  readonly dependencyStatus?: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
  }>;
  readonly context?: Readonly<Record<string, string>>;
  readonly landingCandidate: LandingCandidateDto | null;
  readonly abandoning: boolean;
  readonly waiting: readonly UnsatisfiedEdgeDto[];
  readonly blockedForever: boolean;
  readonly downstream: number;
  readonly action: ActionDto | null;
}

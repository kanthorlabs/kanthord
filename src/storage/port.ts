import type { Project } from "../domain/project.ts";
import type { Resource, ResourceType } from "../domain/resource.ts";
import type { Initiative, Objective } from "../domain/initiative.ts";
import type { Task, TaskStatus } from "../domain/task.ts";
import type {
  ChangeCandidate,
  CandidateState,
  Integration,
} from "../domain/landing.ts";

/** Result returned by a migrator run. */
export interface MigrationReport {
  version: number;
  applied: Array<{ version: number; name: string }>;
}

/** Applies pending schema migrations against the open database. */
export interface Migrator {
  migrate(): MigrationReport;
}

/**
 * Runs a unit of work atomically. The adapter wraps `work` in a real
 * transaction so a use case that performs several writes (e.g. an edge plus its
 * event) either commits all of them or none. `work` is synchronous because the
 * only backing store, `node:sqlite`, is synchronous.
 */
export interface Transactor {
  run<T>(work: () => T): T;
}

/**
 * Wraps a synchronous function in a database transaction. On success the
 * transaction is committed; on error it is rolled back and the error
 * re-thrown. Nested calls are rejected with an error matching `/nested/i`.
 */
export interface UnitOfWork {
  transaction<T>(fn: () => T): T;
}

/** Read-only view of the store's health, owned by the core (no vendor name). */
export interface StatusStore {
  /** Filesystem path of the backing database. */
  readonly path: string;
  /** Current schema version (the migration runner's `user_version`). */
  schemaVersion(): number;
  /** Journal mode the database is running in, e.g. `"wal"`. */
  journalMode(): string;
  /** User tables with their row counts, alphabetical by name. */
  tables(): Array<{ name: string; rows: number }>;
  /** Release the underlying handle. */
  close(): void;
}

/** Repository for the Project aggregate (projects + their resources). */
export interface ProjectRepository {
  save(project: Project): void;
  get(id: string): Project | undefined;
  addResource(projectId: string, resource: Resource): void;
  getResource(id: string): Resource | undefined;
  listResources(projectId: string): Resource[];
  /** Returns resources of `type` in `projectId`. Optional so existing fakes need not implement it. */
  listResourcesByProject?(projectId: string, type: ResourceType): Resource[];
  listProjects(): Project[];
  resolveProjectByName(name: string): string[];
  resolveResourceByName(projectId: string, name: string): string[];
}

/** Repository for the Initiative aggregate (initiatives + their objectives). */
export interface InitiativeRepository {
  save(initiative: Initiative): void;
  get(id: string): Initiative | undefined;
  saveObjective(objective: Objective): void;
  getObjective(id: string): Objective | undefined;
  listObjectives(initiativeId: string): Objective[];
  listInitiatives(projectId: string): Initiative[];
  resolveInitiativeByName(projectId: string, name: string): string[];
  resolveObjectiveByName(initiativeId: string, name: string): string[];
  setPaused(id: string, paused: boolean): void;
  /**
   * Persist the daemon-provisioned isolated clone directory for the
   * initiative's branch. Optional (mirroring `homeDir?` on `WorkspaceManager`)
   * so pre-existing fake `InitiativeRepository` test implementations, which
   * predate this Story A task, still structurally conform without a new
   * method.
   */
  setWorkspace?(id: string, dir: string): void;
  listAllInitiatives(): Array<{ id: string; paused: boolean }>;
  /** Returns the stored sha256 token for an initiative or objective row, or undefined if not found. */
  getSha256(id: string): string | undefined;
  /** Conditionally rename an initiative when its sha matches the expected value. */
  conditionalRenameInitiative(
    id: string,
    expectedSha: string,
    name: string,
  ): CasResult;
  /** Conditionally rename an objective when its sha matches the expected value. */
  conditionalRenameObjective(
    id: string,
    expectedSha: string,
    name: string,
  ): CasResult;
  /** Conditionally delete an objective when its sha matches the expected value. */
  conditionalDeleteObjective(id: string, expectedSha: string): CasResult;
}

/** Repository for the Task aggregate (tasks + their dependency edges). */
export interface TaskRepository {
  save(task: Task): void;
  saveAll(tasks: Task[]): void;
  get(id: string): Task | undefined;
  listByInitiative(initiativeId: string): Task[];
  listTasksByObjective(objectiveId: string): Task[];
  saveTaskContext(taskId: string, context: Record<string, string>): void;
  getTaskContext(taskId: string): Record<string, string>;
  addDependency(taskId: string, dependencyId: string): void;
  removeDependency(taskId: string, dependencyId: string): void;
  getInitiativeId(taskId: string): string | undefined;
  /** Returns the stored sha256 token for a task row, or undefined if not found. */
  getSha256(id: string): string | undefined;
  /**
   * Conditionally update a task's spec fields when its sha AND status both
   * match. `expectedStatus` is the status observed at preflight — a lifecycle
   * change between preflight and write is a conflict, not a silent overwrite.
   */
  compareAndApply(
    id: string,
    expectedSha: string,
    expectedStatus: TaskStatus,
    spec: {
      title: string;
      instructions: string;
      ac: string[];
      agent: string;
      verification: string[] | null;
      dependencies: string[];
    },
  ): TaskCasResult;
  /**
   * Conditionally move a task to a different objective when its sha matches.
   * No status predicate: EPIC 007.18 scoped the explicit guard to the two paths
   * that rewrite a task's instructions or remove the row. A reparent of a
   * running task changes only its parent reference and cannot corrupt an
   * in-flight run.
   */
  conditionalReparent(
    id: string,
    expectedSha: string,
    objectiveId: string,
  ): CasResult;
  /** Conditionally delete a task when its sha AND status both match. */
  conditionalDeleteTask(
    id: string,
    expectedSha: string,
    expectedStatus: TaskStatus,
  ): TaskCasResult;
}

/**
 * One row in the `task_results` table. All columns except the keying `taskId`
 * (passed as a parameter to `saveTaskResult` / `getTaskResult`) are nullable.
 * `evidence` is a JSON array of verification-command results when present.
 */
export interface TaskResultRow {
  workspace: string | null;
  branch: string | null;
  baseCommit: string | null;
  proposalCommit: string | null;
  commitSha: string | null;
  summary: string | null;
  reason: string | null;
  rejectionResolution: string | null;
  rejectionReason: string | null;
  evidence: Array<{ command: string; exitCode: number; output: string }> | null;
}

/** Resolves a raw id to the aggregate kind it belongs to. */
export interface ReferenceResolver {
  resolveKind(
    id: string,
  ): "project" | "resource" | "initiative" | "objective" | "task" | undefined;
}

/** Which predicate of a task CAS failed. */
export type TaskCasConflictReason = "sha" | "status";

/**
 * Result of a task conditional-write guarded by BOTH sha and status.
 * `conflict` carries the row's actual sha + status and says which predicate
 * failed, so the caller can report "content changed" vs "no longer pending".
 */
export type TaskCasResult =
  | { status: "applied"; freshSha: string }
  | {
      status: "conflict";
      currentSha: string;
      currentStatus: string;
      reason: TaskCasConflictReason;
    };

/**
 * Result of a conditional-write (CAS) operation on a repository row.
 * `applied` carries the freshly-computed sha256 after the write;
 * `conflict` carries the sha256 that was actually in the row.
 */
export type CasResult =
  | { status: "applied"; freshSha: string }
  | { status: "conflict"; currentSha: string };

/** Repository for durable landing candidate metadata and integration records. */
export interface LandingRepository {
  saveCandidate(candidate: ChangeCandidate): void;
  getCandidate(id: string): ChangeCandidate | undefined;
  /** Returns the latest candidate saved for a task, or undefined. Optional so existing fakes need not implement it. */
  getCandidateByTask?(taskId: string): ChangeCandidate | undefined;
  updateCandidateState(id: string, state: CandidateState): void;
  saveIntegration(integration: Integration): void;
  getIntegration(candidateId: string): Integration | undefined;
}

/** The publication lifecycle state of a repository target (repoId, branch). */
export type PublicationStateName = "unpublished" | "published" | "diverged";

/** A stored publication record: its state and the remote OID it observed. */
export interface PublicationRecord {
  state: PublicationStateName;
  remoteOID: string | null;
}

/** Repository for per-(repoId, branch) publication state (007.13 Story C). */
export interface PublicationRepository {
  getPublication(repoId: string, branch: string): PublicationRecord | undefined;
  /** Returns the record for the repo's most-recently-published branch, or undefined if none. */
  getLatestPublication(repoId: string): PublicationRecord | undefined;
  setPublication(
    repoId: string,
    branch: string,
    record: PublicationRecord,
  ): void;
}

/**
 * Durable ref→id idempotency store backed by the `graph_import_map` table
 * (migration 6). Used by `import graph --create` (reserve) and
 * `import graph --apply` (lookup) to guarantee a re-applied package never
 * duplicates a node that was already created in a previous run.
 */
export interface GraphImportMap {
  /**
   * Record that `ref` under `(packageId, kind)` resolves to `nodeId` and was
   * created with `creationSha`. Throws on a duplicate `(packageId, kind, ref)`.
   */
  reserve(
    packageId: string,
    kind: string,
    ref: string,
    nodeId: string,
    creationSha: string,
  ): void;

  /**
   * Return the `{nodeId, creationSha}` recorded for `(packageId, kind, ref)`,
   * or `undefined` if no such row exists.
   */
  lookup(
    packageId: string,
    kind: string,
    ref: string,
  ): { nodeId: string; creationSha: string } | undefined;
}

/**
 * A record in the global ai_providers table.
 * The `id` is the stable account identity; `value` holds the folded secret,
 * excluded from every read-path output by use-case redaction.
 */
export interface GlobalAiProvider {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  effort: string | null;
  value: string | null;
  state: "active" | "logged_out";
  credentialVersion: number;
}

/**
 * Registry for the global ai_providers store + default pointer (008.1).
 * Every method is synchronous (backed by `node:sqlite`).
 */
export interface AiProviderRegistry {
  register(input: {
    name: string;
    provider: string;
    model: string;
    baseUrl?: string;
    effort?: string;
    value: string;
  }): GlobalAiProvider;
  list(): GlobalAiProvider[];
  get(id: string): GlobalAiProvider | undefined;
  getDefault(): GlobalAiProvider | undefined;
  setDefault(id: string): void;
  /** Clears the default pointer. Legal to call when no default is set. */
  clearDefault(): void;
  logout(id: string): void;
  remove(id: string): void;
}

/**
 * Repository for reading and writing initiative-level and objective-level
 * sequencing edges. The six methods beyond the read-only query interface
 * support the Story 4 use cases (add/remove edge, DAG queries).
 */
export interface SequencingRepository {
  listInitiativeAfter(initiativeId: string): string[];
  listObjectiveAfter(objectiveId: string): string[];
  addInitiativeAfter(initiativeId: string, dependencyId: string): void;
  removeInitiativeAfter(initiativeId: string, dependencyId: string): void;
  listInitiativeDag(
    projectId: string,
  ): Array<{ id: string; dependencies: string[] }>;
  listObjectiveDag(
    initiativeId: string,
  ): Array<{ id: string; dependencies: string[] }>;
  addObjectiveAfter(objectiveId: string, dependencyId: string): void;
  removeObjectiveAfter(objectiveId: string, dependencyId: string): void;
}

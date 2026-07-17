import type { Project } from "../domain/project.ts";
import type { Resource } from "../domain/resource.ts";
import type { Initiative, Objective } from "../domain/initiative.ts";
import type { Task } from "../domain/task.ts";

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
  listAllInitiatives(): Array<{ id: string; paused: boolean }>;
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
  addDependency(taskId: string, dependsOn: string): void;
  removeDependency(taskId: string, dependsOn: string): void;
  getInitiativeId(taskId: string): string | undefined;
}

/** Resolves a raw id to the aggregate kind it belongs to. */
export interface ReferenceResolver {
  resolveKind(
    id: string,
  ): "project" | "resource" | "initiative" | "objective" | "task" | undefined;
}

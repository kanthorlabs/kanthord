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
  listResources(projectId: string): Resource[];
}

/** Repository for the Initiative aggregate (initiatives + their objectives). */
export interface InitiativeRepository {
  save(initiative: Initiative): void;
  get(id: string): Initiative | undefined;
  saveObjective(objective: Objective): void;
  listObjectives(initiativeId: string): Objective[];
}

/** Repository for the Task aggregate (tasks + their dependency edges). */
export interface TaskRepository {
  save(task: Task): void;
  saveAll(tasks: Task[]): void;
  get(id: string): Task | undefined;
  listByInitiative(initiativeId: string): Task[];
}

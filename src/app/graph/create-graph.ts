/**
 * Story 05 — `import graph --create`: build a new Initiative→Objective→Task
 * graph in one UnitOfWork, assign ULIDs, reserve idempotency rows.
 */
import type { Initiative, Objective } from "../../domain/initiative.ts";
import { validateGraph, validateDag } from "../../domain/graph.ts";
import { newTask } from "../../domain/task.ts";
import type { GraphNode } from "../../domain/graph.ts";
import type { Task } from "../../domain/task.ts";
import type {
  InitiativeRepository,
  TaskRepository,
  ProjectRepository,
  UnitOfWork,
  GraphImportMap,
} from "../../storage/port.ts";
import type { GraphPackage } from "./graph-package.ts";
import type { StoreGraph } from "./store-graph.ts";
import {
  sha256Hex,
  canonicalTask,
  canonicalObjective,
  canonicalInitiative,
} from "../../domain/sha.ts";

// Import + re-export CreateModeIdError from the canonical import-errors module
// so existing callers (create-graph.test.ts) continue to import from here.
import {
  CreateModeIdError,
  CrossInitiativeError,
  UnknownNodeError,
} from "./import-errors.ts";
export { CreateModeIdError };

import { resolveTaskContext } from "./binding-resolver.ts";

// ---------------------------------------------------------------------------
// DTOs (locked contracts)
// ---------------------------------------------------------------------------

export interface CreateGraphInput {
  pkg: GraphPackage; // must have NO persisted ids anywhere
  projectId: string; // must exist; import never creates it
  packageId: string; // ULID minted by the CLI at --create
  paused: boolean; // explicit-activation gate; rides in the creation INSERT
  bindings?: Record<string, string>; // C1: CLI --bind alias→id map (alias → concrete resource id)
}

export interface CreateGraphResult {
  initiativeId: string;
  refToId: {
    objectives: Record<string, string>;
    tasks: Record<string, string>;
  };
  nodes: Record<string, string>; // id → creationSha (for the fresh manifest)
}

// ---------------------------------------------------------------------------
// Use case
// ---------------------------------------------------------------------------

/** Sequencing interface for CreateGraph — writes the entire after set in one call. */
export interface CreateGraphSequencing {
  setInitiativeAfter(initiativeId: string, after: string[]): void;
  setObjectiveAfter(objectiveId: string, after: string[]): void;
}

export class CreateGraph {
  readonly #deps: {
    initiatives: InitiativeRepository;
    tasks: TaskRepository;
    storeGraph: StoreGraph; // accepted for constructor compatibility; dep-remapping done inline (sync/async mismatch with UoW)
    projects: ProjectRepository;
    importMap: GraphImportMap;
    uow: UnitOfWork;
    newId: () => string;
    sequencing: CreateGraphSequencing | undefined;
  };

  constructor(deps: {
    initiatives: InitiativeRepository;
    tasks: TaskRepository;
    storeGraph: StoreGraph;
    projects: ProjectRepository;
    importMap: GraphImportMap;
    uow: UnitOfWork;
    newId: () => string;
    sequencing?: unknown;
  }) {
    this.#deps = {
      ...deps,
      sequencing: deps.sequencing as CreateGraphSequencing | undefined,
    };
  }

  async execute(input: CreateGraphInput): Promise<CreateGraphResult> {
    // 1. Reject any persisted id — create mode is for fresh graphs only (B5)
    if (input.pkg.initiative.id !== undefined) {
      throw new CreateModeIdError(
        input.pkg.initiative.sourcePath,
        input.pkg.initiative.id,
      );
    }
    for (const obj of input.pkg.objectives) {
      if (obj.id !== undefined)
        throw new CreateModeIdError(obj.sourcePath, obj.id);
    }
    for (const task of input.pkg.tasks) {
      if (task.id !== undefined)
        throw new CreateModeIdError(task.sourcePath, task.id);
    }

    // 2. Import never creates a project — require it to exist
    if (this.#deps.projects.get(input.projectId) === undefined) {
      throw new Error(`Project not found: ${input.projectId}`);
    }

    // 3. Validate task DAG BEFORE any transaction so a CycleError prevents
    //    saveAll from ever being called (hermetic guarantee).
    const graphNodes: GraphNode[] = input.pkg.tasks.map((t) => ({
      id: t.ref,
      status: "pending" as const,
      dependencies: t.dependencies,
    }));
    validateGraph(graphNodes);

    // 3b. Validate initiative after refs (ULIDs referencing existing initiatives)
    //     BEFORE the transaction so CrossInitiativeError/UnknownNodeError
    //     prevent any write.
    const initiativeAfter = input.pkg.initiative.after ?? [];
    for (const ref of initiativeAfter) {
      const existing = this.#deps.initiatives.get(ref);
      if (existing === undefined) {
        throw new UnknownNodeError(input.pkg.initiative.sourcePath, ref);
      }
      if (existing.projectId !== input.projectId) {
        throw new CrossInitiativeError(
          input.pkg.initiative.sourcePath,
          ref,
          input.projectId,
          existing.projectId,
        );
      }
    }

    // 4. One atomic UnitOfWork for all DB writes
    return this.#deps.uow.transaction(() => {
      // --- Initiative ---
      const initiativeId = this.#deps.newId();
      const initiative: Initiative = {
        id: initiativeId,
        projectId: input.projectId,
        name: input.pkg.initiative.name,
        paused: input.paused,
      };
      this.#deps.initiatives.save(initiative);

      // --- Objectives ---
      const objRefToId = new Map<string, string>();
      for (const obj of input.pkg.objectives) {
        const objId = this.#deps.newId();
        objRefToId.set(obj.ref, objId);
        const objective: Objective = {
          id: objId,
          initiativeId,
          name: obj.name,
        };
        this.#deps.initiatives.saveObjective(objective);
      }

      // --- Resolve objective after refs (package-local slugs → minted ULIDs) ---
      // Each objective's after refs must resolve to an objective in the same package.
      const objectiveAfterMap = new Map<string, string[]>();
      for (const obj of input.pkg.objectives) {
        const afterRefs = obj.after ?? [];
        const resolvedAfter: string[] = [];
        for (const ref of afterRefs) {
          const mintedId = objRefToId.get(ref);
          if (mintedId === undefined) {
            throw new UnknownNodeError(obj.sourcePath, ref);
          }
          resolvedAfter.push(mintedId);
        }
        resolvedAfter.sort();
        objectiveAfterMap.set(obj.ref, resolvedAfter);
      }

      // --- Validate objective DAG BEFORE any task writes ---
      if (this.#deps.sequencing !== undefined) {
        const dagNodes = input.pkg.objectives.map((obj) => ({
          id: objRefToId.get(obj.ref)!,
          dependencies: objectiveAfterMap.get(obj.ref) ?? [],
        }));
        validateDag(dagNodes);
      }

      // --- Tasks: pre-mint IDs so cross-task dep resolution is possible ---
      const taskRefToId = new Map<string, string>();
      for (const t of input.pkg.tasks) {
        taskRefToId.set(t.ref, this.#deps.newId());
      }

      const createdTasks: Task[] = input.pkg.tasks.map((t) => {
        const objectiveId = objRefToId.get(t.objectiveRef);
        if (objectiveId === undefined) {
          throw new Error(`Unknown objectiveRef: ${t.objectiveRef}`);
        }
        const resolvedDeps = t.dependencies.map((ref) => {
          const depId = taskRefToId.get(ref);
          if (depId === undefined) throw new Error(`Unknown dep ref: ${ref}`);
          return depId;
        });
        // Call newTask for domain validation, then override the auto-generated id
        const validated = newTask({
          objectiveId,
          title: t.title,
          instructions: t.instructions,
          ac: t.ac,
          agent: t.agent,
          verification: t.verification == null ? undefined : t.verification,
          dependencies: resolvedDeps,
        });
        return { ...validated, id: taskRefToId.get(t.ref)! };
      });
      this.#deps.tasks.saveAll(createdTasks);

      // --- C1: saveTaskContext for each task when bindings are provided ---
      if (
        input.bindings !== undefined &&
        input.pkg.initiative.bindings !== undefined
      ) {
        const initiativeBindings = input.pkg.initiative.bindings;
        const bindMap = input.bindings;
        const objByRef = new Map(input.pkg.objectives.map((o) => [o.ref, o]));
        for (let i = 0; i < input.pkg.tasks.length; i++) {
          const pkgTask = input.pkg.tasks[i]!;
          const task = createdTasks[i]!;
          const pkgObj = objByRef.get(pkgTask.objectiveRef);
          const resolvedContext = resolveTaskContext(
            initiativeBindings,
            pkgObj?.context,
            pkgTask.context,
            bindMap,
          );
          this.#deps.tasks.saveTaskContext(task.id, resolvedContext);
        }
      }

      // --- Write sequencing edges ---
      if (this.#deps.sequencing !== undefined) {
        // Write initiative after edges
        const resolvedInitiativeAfter = initiativeAfter; // already validated above
        this.#deps.sequencing.setInitiativeAfter(
          initiativeId,
          resolvedInitiativeAfter,
        );
        // Write objective after edges
        for (const obj of input.pkg.objectives) {
          const objId = objRefToId.get(obj.ref)!;
          this.#deps.sequencing.setObjectiveAfter(
            objId,
            objectiveAfterMap.get(obj.ref) ?? [],
          );
        }
      }

      // --- Build result maps + reserve idempotency rows ---
      const nodes: Record<string, string> = {};
      const refToId = {
        objectives: {} as Record<string, string>,
        tasks: {} as Record<string, string>,
      };

      nodes[initiativeId] = sha256Hex(
        canonicalInitiative({
          name: input.pkg.initiative.name,
          projectId: input.projectId,
          after: initiativeAfter,
        }),
      );

      for (const obj of input.pkg.objectives) {
        const objId = objRefToId.get(obj.ref)!;
        refToId.objectives[obj.ref] = objId;
        const sha = sha256Hex(
          canonicalObjective({
            name: obj.name,
            initiativeId,
            after: objectiveAfterMap.get(obj.ref) ?? [],
          }),
        );
        nodes[objId] = sha;
        this.#deps.importMap.reserve(
          input.packageId,
          "objective",
          obj.ref,
          objId,
          sha,
        );
      }

      for (let i = 0; i < input.pkg.tasks.length; i++) {
        const pkgTask = input.pkg.tasks[i]!;
        const task = createdTasks[i]!;
        refToId.tasks[pkgTask.ref] = task.id;
        const sha = sha256Hex(
          canonicalTask({
            title: task.title,
            instructions: task.instructions ?? "",
            ac: task.ac ?? [],
            agent: task.agent ?? "generic@1",
            verification: task.verification,
            dependencies: task.dependencies,
            objectiveId: task.objectiveId,
          }),
        );
        nodes[task.id] = sha;
        this.#deps.importMap.reserve(
          input.packageId,
          "task",
          pkgTask.ref,
          task.id,
          sha,
        );
      }

      return { initiativeId, refToId, nodes };
    });
  }
}

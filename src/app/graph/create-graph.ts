/**
 * Story 05 — `import graph --create`: build a new Initiative→Objective→Task
 * graph in one UnitOfWork, assign ULIDs, reserve idempotency rows.
 */
import type { Initiative, Objective } from "../../domain/initiative.ts";
import { validateGraph } from "../../domain/graph.ts";
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
import { CreateModeIdError } from "./import-errors.ts";
export { CreateModeIdError };

import { resolveTaskContext } from "./binding-resolver.ts";

// ---------------------------------------------------------------------------
// DTOs (locked contracts)
// ---------------------------------------------------------------------------

export interface CreateGraphInput {
  pkg: GraphPackage; // must have NO persisted ids anywhere
  projectId: string; // must exist; import never creates it
  packageId: string; // ULID minted by the CLI at --create
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

export class CreateGraph {
  readonly #deps: {
    initiatives: InitiativeRepository;
    tasks: TaskRepository;
    storeGraph: StoreGraph; // accepted for constructor compatibility; dep-remapping done inline (sync/async mismatch with UoW)
    projects: ProjectRepository;
    importMap: GraphImportMap;
    uow: UnitOfWork;
    newId: () => string;
  };

  constructor(deps: {
    initiatives: InitiativeRepository;
    tasks: TaskRepository;
    storeGraph: StoreGraph;
    projects: ProjectRepository;
    importMap: GraphImportMap;
    uow: UnitOfWork;
    newId: () => string;
  }) {
    this.#deps = deps;
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

    // 4. One atomic UnitOfWork for all DB writes
    return this.#deps.uow.transaction(() => {
      // --- Initiative ---
      const initiativeId = this.#deps.newId();
      const initiative: Initiative = {
        id: initiativeId,
        projectId: input.projectId,
        name: input.pkg.initiative.name,
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
        }),
      );

      for (const obj of input.pkg.objectives) {
        const objId = objRefToId.get(obj.ref)!;
        refToId.objectives[obj.ref] = objId;
        const sha = sha256Hex(
          canonicalObjective({ name: obj.name, initiativeId }),
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
            status: task.status,
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

import type {
  TaskRepository,
  InitiativeRepository,
  ProjectRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import { newTask } from "../../domain/task.ts";
import { UnknownReferenceError, WrongTypeReferenceError } from "../errors.ts";

export class CreateTask {
  readonly #taskRepo: TaskRepository;
  readonly #initiativeRepo: InitiativeRepository;
  readonly #projectRepo: ProjectRepository;
  readonly #resolver: ReferenceResolver;

  constructor(
    taskRepo: TaskRepository,
    initiativeRepo: InitiativeRepository,
    projectRepo: ProjectRepository,
    resolver: ReferenceResolver,
  ) {
    this.#taskRepo = taskRepo;
    this.#initiativeRepo = initiativeRepo;
    this.#projectRepo = projectRepo;
    this.#resolver = resolver;
  }

  async execute(input: {
    objectiveId: string;
    title: string;
    dependencies?: string[];
    context?: Record<string, string>;
  }): Promise<string> {
    // 1. Validate objectiveId kind
    const objKind = this.#resolver.resolveKind(input.objectiveId);
    if (objKind === undefined) {
      throw new UnknownReferenceError("objective", input.objectiveId);
    }
    if (objKind !== "objective") {
      throw new WrongTypeReferenceError(
        "objective",
        objKind,
        input.objectiveId,
      );
    }

    // 2. Load objective → initiative → projectId
    const objective = this.#initiativeRepo.getObjective(input.objectiveId);
    if (objective === undefined) {
      throw new UnknownReferenceError("objective", input.objectiveId);
    }
    const initiative = this.#initiativeRepo.get(objective.initiativeId);
    if (initiative === undefined) {
      throw new UnknownReferenceError("initiative", objective.initiativeId);
    }
    const projectId = initiative.projectId;

    // 3. Validate each dependency id — must resolve as "task"
    for (const depId of input.dependencies ?? []) {
      const depKind = this.#resolver.resolveKind(depId);
      if (depKind === undefined) {
        throw new UnknownReferenceError("task", depId);
      }
      if (depKind !== "task") {
        throw new WrongTypeReferenceError("task", depKind, depId);
      }
    }

    // 4. Validate context resource entries
    for (const [type, resourceId] of Object.entries(input.context ?? {})) {
      const resource = this.#projectRepo.getResource(resourceId);
      if (resource === undefined) {
        throw new UnknownReferenceError(type, resourceId);
      }
      if (resource.type !== type) {
        throw new WrongTypeReferenceError(type, resource.type, resourceId);
      }
      // Ensure resource belongs to the same project
      const inProject = this.#projectRepo
        .listResources(projectId)
        .some((r) => r.id === resourceId);
      if (!inProject) {
        throw new UnknownReferenceError(type, resourceId);
      }
    }

    // 5. Persist task and optional context
    const task = newTask({
      objectiveId: input.objectiveId,
      title: input.title,
      dependencies: input.dependencies,
    });
    this.#taskRepo.save(task);
    if (input.context !== undefined && Object.keys(input.context).length > 0) {
      this.#taskRepo.saveTaskContext(task.id, input.context);
    }
    return task.id;
  }
}

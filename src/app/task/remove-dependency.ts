import type {
  TaskRepository,
  InitiativeRepository,
  ReferenceResolver,
  Transactor,
} from "../../storage/port.ts";
import type { EventFeed } from "../../events/port.ts";
import { assertDependenciesEditable } from "../../domain/task.ts";
import { validateGraph } from "../../domain/graph.ts";
import { newEvent } from "../../domain/event.ts";
import { UnknownReferenceError, WrongTypeReferenceError } from "../errors.ts";

export class RemoveDependency {
  readonly #taskRepo: TaskRepository;
  readonly #initiativeRepo: InitiativeRepository;
  readonly #resolver: ReferenceResolver;
  readonly #events: EventFeed;
  readonly #tx: Transactor;

  constructor(
    taskRepo: TaskRepository,
    initiativeRepo: InitiativeRepository,
    resolver: ReferenceResolver,
    events: EventFeed,
    tx: Transactor,
  ) {
    this.#taskRepo = taskRepo;
    this.#initiativeRepo = initiativeRepo;
    this.#resolver = resolver;
    this.#events = events;
    this.#tx = tx;
  }

  async execute(input: {
    taskId: string;
    dependencyId: string;
  }): Promise<void> {
    const { taskId, dependencyId } = input;

    // 1. Validate taskId kind
    const taskKind = this.#resolver.resolveKind(taskId);
    if (taskKind === undefined) {
      throw new UnknownReferenceError("task", taskId);
    }
    if (taskKind !== "task") {
      throw new WrongTypeReferenceError("task", taskKind, taskId);
    }

    // 2. Validate dependencyId kind
    const depKind = this.#resolver.resolveKind(dependencyId);
    if (depKind === undefined) {
      throw new UnknownReferenceError("task", dependencyId);
    }
    if (depKind !== "task") {
      throw new WrongTypeReferenceError("task", depKind, dependencyId);
    }

    // 3. Load the task
    const task = this.#taskRepo.get(taskId);
    if (task === undefined) {
      throw new UnknownReferenceError("task", taskId);
    }

    // 4. If the edge is not present, removal is an idempotent no-op success —
    //    nothing changes, so it is allowed regardless of task status (no event).
    if (!task.dependencies.includes(dependencyId)) {
      return;
    }

    // 5. Pending gate — a real edge mutation is only allowed on a pending task
    assertDependenciesEditable(task);

    // 6. Load objective to get initiativeId and validate the proposed graph
    const proposed = task.dependencies.filter((d) => d !== dependencyId);
    const objective = this.#initiativeRepo.getObjective(task.objectiveId);
    if (objective === undefined) {
      throw new UnknownReferenceError("objective", task.objectiveId);
    }
    const allTasks = this.#taskRepo.listByInitiative(objective.initiativeId);
    const proposedNodes = allTasks.map((t) =>
      t.id === taskId ? { ...t, dependencies: proposed } : t,
    );
    validateGraph(proposedNodes);

    // 7. Persist removal and emit event atomically
    this.#tx.run(() => {
      this.#taskRepo.removeDependency(taskId, dependencyId);
      this.#events.append(newEvent("task.dependencies_changed", { taskId }));
    });
  }
}

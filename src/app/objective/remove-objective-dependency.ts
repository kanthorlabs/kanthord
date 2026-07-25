import type {
  InitiativeRepository,
  ReferenceResolver,
  Transactor,
} from "../../storage/port.ts";
import type { SequencingRepository } from "../../storage/port.ts";
import type { Task } from "../../domain/task.ts";
import {
  SequencingLockedError,
  SequencingScopeError,
  UnknownReferenceError,
  WrongTypeReferenceError,
} from "../errors.ts";

/**
 * Structural interface for reading tasks by objective — narrower than the
 * full TaskRepository so this use case depends on exactly what it needs.
 */
export interface ObjectiveTaskSource {
  listTasksByObjective(objectiveId: string): Task[];
}

export class RemoveObjectiveDependency {
  readonly #initiatives: InitiativeRepository;
  readonly #tasks: ObjectiveTaskSource;
  readonly #sequencing: SequencingRepository;
  readonly #resolver: ReferenceResolver;
  readonly #tx: Transactor;

  constructor(
    initiatives: InitiativeRepository,
    tasks: ObjectiveTaskSource,
    sequencing: SequencingRepository,
    resolver: ReferenceResolver,
    tx: Transactor,
  ) {
    this.#initiatives = initiatives;
    this.#tasks = tasks;
    this.#sequencing = sequencing;
    this.#resolver = resolver;
    this.#tx = tx;
  }

  async execute(input: {
    objectiveId: string;
    dependencyId: string;
  }): Promise<void> {
    const { objectiveId, dependencyId } = input;

    // 1. Validate objectiveId kind
    const objKind = this.#resolver.resolveKind(objectiveId);
    if (objKind === undefined) {
      throw new UnknownReferenceError("objective", objectiveId);
    }
    if (objKind !== "objective") {
      throw new WrongTypeReferenceError("objective", objKind, objectiveId);
    }

    // 2. Validate dependencyId kind
    const depKind = this.#resolver.resolveKind(dependencyId);
    if (depKind === undefined) {
      throw new UnknownReferenceError("objective", dependencyId);
    }
    if (depKind !== "objective") {
      throw new WrongTypeReferenceError("objective", depKind, dependencyId);
    }

    // 3. Load both objectives for scope check
    const objective = this.#initiatives.getObjective(objectiveId);
    if (objective === undefined) {
      throw new UnknownReferenceError("objective", objectiveId);
    }
    const dependency = this.#initiatives.getObjective(dependencyId);
    if (dependency === undefined) {
      throw new UnknownReferenceError("objective", dependencyId);
    }

    // 4. Scope — same initiative
    if (objective.initiativeId !== dependency.initiativeId) {
      throw new SequencingScopeError(objectiveId, dependencyId, "initiative");
    }

    // 5. Idempotence — if edge is absent, no-op
    const existing = this.#sequencing.listObjectiveAfter(objectiveId);
    if (!existing.includes(dependencyId)) {
      return;
    }

    // 6. Retroactive gate
    const tasks = this.#tasks.listTasksByObjective(objectiveId);
    const startedTaskIds = tasks
      .filter((t) => t.status !== "pending")
      .map((t) => t.id)
      .sort();
    if (startedTaskIds.length > 0) {
      throw new SequencingLockedError(objectiveId, startedTaskIds);
    }

    // 7. Write inside transaction
    this.#tx.run(() => {
      this.#sequencing.removeObjectiveAfter(objectiveId, dependencyId);
    });
  }
}

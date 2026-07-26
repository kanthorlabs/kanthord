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
 * Structural interface for reading tasks by initiative — narrower than the
 * full TaskRepository so this use case depends on exactly what it needs.
 */
export interface TaskSource {
  listByInitiative(initiativeId: string): Task[];
}

export class RemoveInitiativeDependency {
  readonly #initiatives: InitiativeRepository;
  readonly #tasks: TaskSource;
  readonly #sequencing: SequencingRepository;
  readonly #resolver: ReferenceResolver;
  readonly #tx: Transactor;

  constructor(
    initiatives: InitiativeRepository,
    tasks: TaskSource,
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
    initiativeId: string;
    dependencyId: string;
  }): Promise<void> {
    const { initiativeId, dependencyId } = input;

    // 1. Validate initiativeId kind
    const initKind = this.#resolver.resolveKind(initiativeId);
    if (initKind === undefined) {
      throw new UnknownReferenceError("initiative", initiativeId);
    }
    if (initKind !== "initiative") {
      throw new WrongTypeReferenceError("initiative", initKind, initiativeId);
    }

    // 2. Validate dependencyId kind
    const depKind = this.#resolver.resolveKind(dependencyId);
    if (depKind === undefined) {
      throw new UnknownReferenceError("initiative", dependencyId);
    }
    if (depKind !== "initiative") {
      throw new WrongTypeReferenceError("initiative", depKind, dependencyId);
    }

    // 3. Load both initiatives for scope check
    const initiative = this.#initiatives.get(initiativeId);
    if (initiative === undefined) {
      throw new UnknownReferenceError("initiative", initiativeId);
    }
    const dependency = this.#initiatives.get(dependencyId);
    if (dependency === undefined) {
      throw new UnknownReferenceError("initiative", dependencyId);
    }

    // 4. Scope — same project
    if (initiative.projectId !== dependency.projectId) {
      throw new SequencingScopeError(initiativeId, dependencyId, "project");
    }

    // 5. Idempotence — if edge is absent, no-op (no gate consulted)
    const existing = this.#sequencing.listInitiativeAfter(initiativeId);
    if (!existing.includes(dependencyId)) {
      return;
    }

    // 6. Retroactive gate
    const tasks = this.#tasks.listByInitiative(initiativeId);
    const startedTaskIds = tasks
      .filter((t) => t.status !== "pending")
      .map((t) => t.id)
      .sort();
    if (startedTaskIds.length > 0) {
      throw new SequencingLockedError(initiativeId, startedTaskIds);
    }

    // 7. Write inside transaction
    this.#tx.run(() => {
      this.#sequencing.removeInitiativeAfter(initiativeId, dependencyId);
    });
  }
}

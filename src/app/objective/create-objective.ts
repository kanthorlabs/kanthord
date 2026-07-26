import type {
  InitiativeRepository,
  ReferenceResolver,
  Transactor,
} from "../../storage/port.ts";
import type { SequencingRepository } from "../../storage/port.ts";
import { newObjective } from "../../domain/initiative.ts";
import { validateDag } from "../../domain/graph.ts";
import { CycleError } from "../../domain/graph.ts";
import {
  UnknownReferenceError,
  WrongTypeReferenceError,
  DuplicateNameError,
  SequencingScopeError,
} from "../errors.ts";

export class CreateObjective {
  readonly #repo: InitiativeRepository;
  readonly #resolver: ReferenceResolver;
  readonly #sequencing?: SequencingRepository;
  readonly #tx?: Transactor;

  constructor(
    repo: InitiativeRepository,
    resolver: ReferenceResolver,
    sequencing?: SequencingRepository,
    tx?: Transactor,
  ) {
    this.#repo = repo;
    this.#resolver = resolver;
    this.#sequencing = sequencing;
    this.#tx = tx;
  }

  async execute(input: {
    initiativeId: string;
    name: string;
    after?: string[];
  }): Promise<string> {
    const kind = this.#resolver.resolveKind(input.initiativeId);
    if (kind === undefined) {
      throw new UnknownReferenceError("initiative", input.initiativeId);
    }
    if (kind !== "initiative") {
      throw new WrongTypeReferenceError("initiative", kind, input.initiativeId);
    }
    const existing = this.#repo.resolveObjectiveByName(
      input.initiativeId,
      input.name,
    );
    if (existing.length > 0) {
      throw new DuplicateNameError("objective", input.initiativeId, input.name);
    }
    const objective = newObjective(input.initiativeId, input.name);

    const afterIds = input.after ?? [];
    if (
      afterIds.length > 0 &&
      this.#sequencing !== undefined &&
      this.#tx !== undefined
    ) {
      const deduped = [...new Set(afterIds)].sort();

      // Validate each dependency
      for (const depId of deduped) {
        const depKind = this.#resolver.resolveKind(depId);
        if (depKind === undefined) {
          throw new UnknownReferenceError("objective", depId);
        }
        if (depKind !== "objective") {
          throw new WrongTypeReferenceError("objective", depKind, depId);
        }
        const dep = this.#repo.getObjective(depId);
        if (dep === undefined) {
          throw new UnknownReferenceError("objective", depId);
        }
        if (dep.initiativeId !== input.initiativeId) {
          throw new SequencingScopeError(objective.id, depId, "initiative");
        }
        if (objective.id === depId) {
          throw new CycleError([objective.id, objective.id]);
        }
      }

      // Cycle check over the full objective DAG
      const dag = this.#sequencing.listObjectiveDag(input.initiativeId);
      const dagWithNew = [
        ...dag,
        { id: objective.id, dependencies: [] as string[] },
      ];
      let proposed = dagWithNew;
      for (const depId of deduped) {
        proposed = proposed.map((n) =>
          n.id === objective.id
            ? { ...n, dependencies: [...n.dependencies, depId] }
            : n,
        );
      }
      validateDag(proposed);

      // Writes: save + edges in one transaction
      this.#tx.run(() => {
        this.#repo.saveObjective(objective);
        for (const depId of deduped) {
          this.#sequencing!.addObjectiveAfter(objective.id, depId);
        }
      });
    } else {
      this.#repo.saveObjective(objective);
    }

    return objective.id;
  }
}

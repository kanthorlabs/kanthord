import type {
  InitiativeRepository,
  ReferenceResolver,
  Transactor,
} from "../../storage/port.ts";
import type { SequencingRepository } from "../../storage/port.ts";
import { newInitiative } from "../../domain/initiative.ts";
import { validateDag } from "../../domain/graph.ts";
import { CycleError } from "../../domain/graph.ts";
import {
  UnknownReferenceError,
  WrongTypeReferenceError,
  DuplicateNameError,
  SequencingScopeError,
} from "../errors.ts";

export class CreateInitiative {
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
    projectId: string;
    name: string;
    after?: string[];
  }): Promise<string> {
    const kind = this.#resolver.resolveKind(input.projectId);
    if (kind === undefined) {
      throw new UnknownReferenceError("project", input.projectId);
    }
    if (kind !== "project") {
      throw new WrongTypeReferenceError("project", kind, input.projectId);
    }
    const existing = this.#repo.resolveInitiativeByName(
      input.projectId,
      input.name,
    );
    if (existing.length > 0) {
      throw new DuplicateNameError("initiative", input.projectId, input.name);
    }
    const initiative = newInitiative(input.projectId, input.name);

    const afterIds = input.after ?? [];
    if (
      afterIds.length > 0 &&
      this.#sequencing !== undefined &&
      this.#tx !== undefined
    ) {
      const deduped = [...new Set(afterIds)].sort();

      // Validate each dependency (must pass kind check, existence, same-project scope, self-edge)
      for (const depId of deduped) {
        const depKind = this.#resolver.resolveKind(depId);
        if (depKind === undefined) {
          throw new UnknownReferenceError("initiative", depId);
        }
        if (depKind !== "initiative") {
          throw new WrongTypeReferenceError("initiative", depKind, depId);
        }
        const dep = this.#repo.get(depId);
        if (dep === undefined) {
          throw new UnknownReferenceError("initiative", depId);
        }
        if (dep.projectId !== input.projectId) {
          throw new SequencingScopeError(initiative.id, depId, "project");
        }
        if (initiative.id === depId) {
          throw new CycleError([initiative.id, initiative.id]);
        }
      }

      // Cycle check over the full DAG including the new initiative
      const dag = this.#sequencing.listInitiativeDag(input.projectId);
      const dagWithNew = [
        ...dag,
        { id: initiative.id, dependencies: [] as string[] },
      ];
      let proposed = dagWithNew;
      for (const depId of deduped) {
        proposed = proposed.map((n) =>
          n.id === initiative.id
            ? { ...n, dependencies: [...n.dependencies, depId] }
            : n,
        );
      }
      validateDag(proposed);

      // Writes: save + edges in one transaction
      this.#tx.run(() => {
        this.#repo.save(initiative);
        for (const depId of deduped) {
          this.#sequencing!.addInitiativeAfter(initiative.id, depId);
        }
      });
    } else {
      this.#repo.save(initiative);
    }

    return initiative.id;
  }
}

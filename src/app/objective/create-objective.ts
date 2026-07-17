import type {
  InitiativeRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import { newObjective } from "../../domain/initiative.ts";
import {
  UnknownReferenceError,
  WrongTypeReferenceError,
  DuplicateNameError,
} from "../errors.ts";

export class CreateObjective {
  readonly #repo: InitiativeRepository;
  readonly #resolver: ReferenceResolver;

  constructor(repo: InitiativeRepository, resolver: ReferenceResolver) {
    this.#repo = repo;
    this.#resolver = resolver;
  }

  async execute(input: {
    initiativeId: string;
    name: string;
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
    this.#repo.saveObjective(objective);
    return objective.id;
  }
}

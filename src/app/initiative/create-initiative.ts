import type {
  InitiativeRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import { newInitiative } from "../../domain/initiative.ts";
import {
  UnknownReferenceError,
  WrongTypeReferenceError,
  DuplicateNameError,
} from "../errors.ts";

export class CreateInitiative {
  readonly #repo: InitiativeRepository;
  readonly #resolver: ReferenceResolver;

  constructor(repo: InitiativeRepository, resolver: ReferenceResolver) {
    this.#repo = repo;
    this.#resolver = resolver;
  }

  async execute(input: { projectId: string; name: string }): Promise<string> {
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
    this.#repo.save(initiative);
    return initiative.id;
  }
}

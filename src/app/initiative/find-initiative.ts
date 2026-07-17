import type { InitiativeRepository } from "../../storage/port.ts";
import { UnknownReferenceError, AmbiguousNameError } from "../errors.ts";

export class FindInitiative {
  readonly #repo: InitiativeRepository;

  constructor(repo: InitiativeRepository) {
    this.#repo = repo;
  }

  async execute(input: { projectId: string; name: string }): Promise<string> {
    const ids = this.#repo.resolveInitiativeByName(input.projectId, input.name);
    if (ids.length === 0) {
      throw new UnknownReferenceError("initiative", input.name);
    }
    if (ids.length > 1) {
      throw new AmbiguousNameError("initiative", input.name, ids);
    }
    return ids[0] as string;
  }
}

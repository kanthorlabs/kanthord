import type { InitiativeRepository } from "../../storage/port.ts";
import { UnknownReferenceError, AmbiguousNameError } from "../errors.ts";

export class FindObjective {
  readonly #repo: InitiativeRepository;

  constructor(repo: InitiativeRepository) {
    this.#repo = repo;
  }

  async execute(input: {
    initiativeId: string;
    name: string;
  }): Promise<string> {
    const ids = this.#repo.resolveObjectiveByName(
      input.initiativeId,
      input.name,
    );
    if (ids.length === 0) {
      throw new UnknownReferenceError("objective", input.name);
    }
    if (ids.length > 1) {
      throw new AmbiguousNameError("objective", input.name, ids);
    }
    return ids[0] as string;
  }
}

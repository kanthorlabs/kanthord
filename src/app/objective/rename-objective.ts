import type { InitiativeRepository } from "../../storage/port.ts";
import { UnknownReferenceError } from "../errors.ts";

export class RenameObjective {
  readonly #repo: InitiativeRepository;

  constructor(repo: InitiativeRepository) {
    this.#repo = repo;
  }

  async execute(input: { id: string; name: string }): Promise<void> {
    const objective = this.#repo.getObjective(input.id);
    if (objective === undefined) {
      throw new UnknownReferenceError("objective", input.id);
    }
    objective.name = input.name;
    this.#repo.saveObjective(objective);
  }
}

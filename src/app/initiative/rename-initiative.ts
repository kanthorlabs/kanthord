import type { InitiativeRepository } from "../../storage/port.ts";
import { UnknownReferenceError } from "../errors.ts";

export class RenameInitiative {
  readonly #repo: InitiativeRepository;

  constructor(repo: InitiativeRepository) {
    this.#repo = repo;
  }

  async execute(input: { id: string; name: string }): Promise<void> {
    const initiative = this.#repo.get(input.id);
    if (initiative === undefined) {
      throw new UnknownReferenceError("initiative", input.id);
    }
    initiative.name = input.name;
    this.#repo.save(initiative);
  }
}

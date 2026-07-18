import type { InitiativeRepository } from "../../storage/port.ts";
import type { Initiative } from "../../domain/initiative.ts";

export class ListInitiatives {
  readonly #initiatives: InitiativeRepository;

  constructor(initiatives: InitiativeRepository) {
    this.#initiatives = initiatives;
  }

  execute(input: { projectId: string }): Initiative[] {
    return this.#initiatives.listInitiatives(input.projectId);
  }
}

import type { InitiativeRepository } from "../../storage/port.ts";
import type { Initiative } from "../../domain/initiative.ts";

export class ListInitiatives {
  readonly #initiatives: InitiativeRepository;

  constructor(initiatives: InitiativeRepository) {
    this.#initiatives = initiatives;
  }

  execute(input: { projectId: string; name?: string }): Initiative[] {
    const initiatives = this.#initiatives.listInitiatives(input.projectId);
    if (input.name === undefined) {
      return initiatives;
    }
    return initiatives.filter((i) => i.name === input.name);
  }
}

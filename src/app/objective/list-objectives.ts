import type { InitiativeRepository } from "../../storage/port.ts";
import type { Objective } from "../../domain/initiative.ts";

export class ListObjectives {
  readonly #initiatives: InitiativeRepository;

  constructor(initiatives: InitiativeRepository) {
    this.#initiatives = initiatives;
  }

  execute(input: { initiativeId: string; name?: string }): Objective[] {
    const objectives = this.#initiatives.listObjectives(input.initiativeId);
    if (input.name === undefined) {
      return objectives;
    }
    return objectives.filter((o) => o.name === input.name);
  }
}

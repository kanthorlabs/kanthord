import type { InitiativeRepository } from "../../storage/port.ts";
import type { Objective } from "../../domain/initiative.ts";

export class ListObjectives {
  readonly #initiatives: InitiativeRepository;

  constructor(initiatives: InitiativeRepository) {
    this.#initiatives = initiatives;
  }

  execute(input: { initiativeId: string }): Objective[] {
    return this.#initiatives.listObjectives(input.initiativeId);
  }
}

import type { Initiative } from "../../domain/initiative.ts";
import { UnknownReferenceError } from "../errors.ts";

interface InitiativeSource {
  get(id: string): Initiative | undefined;
}

export interface GetInitiativeOutput {
  id: string;
  name: string;
  status: string;
  workspace?: string;
}

export class GetInitiative {
  readonly #initiatives: InitiativeSource;

  constructor(initiatives: InitiativeSource) {
    this.#initiatives = initiatives;
  }

  async execute(input: { id: string }): Promise<GetInitiativeOutput> {
    const initiative = this.#initiatives.get(input.id);
    if (initiative === undefined) {
      throw new UnknownReferenceError("initiative", input.id);
    }

    return {
      id: initiative.id,
      name: initiative.name,
      status: initiative.status ?? "building",
      ...(initiative.workspace !== undefined
        ? { workspace: initiative.workspace }
        : {}),
    };
  }
}

import type { Initiative, InitiativeStatus } from "../../domain/initiative.ts";
import { UnknownReferenceError } from "../errors.ts";
import {
  unsatisfiedInitiativeEdges,
  type UnsatisfiedEdge,
} from "../../domain/sequencing.ts";

interface InitiativeSource {
  get(id: string): Initiative | undefined;
}

export interface GetInitiativeOutput {
  id: string;
  name: string;
  status: string;
  paused: boolean;
  /** The publishable initiative branch; convention mirrors composition.ts. */
  branch: string;
  workspace?: string;
  after: string[];
  waiting: UnsatisfiedEdge[];
}

export class GetInitiative {
  readonly #initiatives: InitiativeSource;
  readonly #sequencing?: { listInitiativeAfter(id: string): string[] };

  constructor(
    initiatives: InitiativeSource,
    sequencing?: { listInitiativeAfter(id: string): string[] },
  ) {
    this.#initiatives = initiatives;
    this.#sequencing = sequencing;
  }

  async execute(input: { id: string }): Promise<GetInitiativeOutput> {
    const initiative = this.#initiatives.get(input.id);
    if (initiative === undefined) {
      throw new UnknownReferenceError("initiative", input.id);
    }

    const after = this.#sequencing?.listInitiativeAfter(input.id) ?? [];
    const afterWithStatus: Array<{ id: string; status?: InitiativeStatus }> =
      after.map((id) => ({
        id,
        status: this.#initiatives.get(id)?.status,
      }));
    const waiting = unsatisfiedInitiativeEdges(afterWithStatus);

    return {
      id: initiative.id,
      name: initiative.name,
      status: initiative.status ?? "building",
      paused: initiative.paused,
      branch: `kanthord/init/${initiative.id}`,
      ...(initiative.workspace !== undefined
        ? { workspace: initiative.workspace }
        : {}),
      after,
      waiting,
    };
  }
}

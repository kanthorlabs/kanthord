import type { Objective, ObjectiveStatus } from "../../domain/initiative.ts";
import { UnknownReferenceError } from "../errors.ts";
import {
  unsatisfiedObjectiveEdges,
  type UnsatisfiedEdge,
} from "../../domain/sequencing.ts";

interface ObjectiveSource {
  getObjective(id: string): Objective | undefined;
}

interface RepositoryResolver {
  resolveInitiativeRepository(initiativeId: string): string | undefined;
}

export interface GetObjectiveOutput {
  id: string;
  name: string;
  status: string;
  /** The squashed candidate commit a client must echo back on a verdict. */
  commitOid?: string;
  /** The parent the candidate was built on (the broker's CAS anchor). */
  parentOid?: string;
  integrations: Array<{ repository: string; state: string }>;
  after: string[];
  waiting: UnsatisfiedEdge[];
  /** The ref-update conflict cause, or `null` when none is persisted. */
  conflictCause: string | null;
  /** The gate-failure reason from the most recent conflict, or `null`. */
  conflictReason: string | null;
  /** Guidance stored on the objective, or `null` when unset. */
  note: string | null;
}

export class GetObjective {
  readonly #objectives: ObjectiveSource;
  readonly #repos: RepositoryResolver;
  readonly #sequencing?: { listObjectiveAfter(id: string): string[] };

  constructor(
    objectives: ObjectiveSource,
    repos: RepositoryResolver,
    sequencing?: { listObjectiveAfter(id: string): string[] },
  ) {
    this.#objectives = objectives;
    this.#repos = repos;
    this.#sequencing = sequencing;
  }

  async execute(input: { id: string }): Promise<GetObjectiveOutput> {
    const objective = this.#objectives.getObjective(input.id);
    if (objective === undefined) {
      throw new UnknownReferenceError("objective", input.id);
    }

    const repositoryId = this.#repos.resolveInitiativeRepository(
      objective.initiativeId,
    );
    const status = objective.status ?? "building";

    const after = this.#sequencing?.listObjectiveAfter(input.id) ?? [];
    const afterWithStatus: Array<{ id: string; status?: ObjectiveStatus }> =
      after.map((id) => ({
        id,
        status: this.#objectives.getObjective(id)?.status,
      }));
    const waiting = unsatisfiedObjectiveEdges(afterWithStatus);

    return {
      id: objective.id,
      name: objective.name,
      status,
      ...(objective.commitOid !== undefined
        ? { commitOid: objective.commitOid }
        : {}),
      ...(objective.parentOid !== undefined
        ? { parentOid: objective.parentOid }
        : {}),
      integrations:
        repositoryId !== undefined
          ? [{ repository: repositoryId, state: status }]
          : [],
      after,
      waiting,
      conflictCause: objective.conflictCause ?? null,
      conflictReason: objective.conflictReason ?? null,
      note: objective.note ?? null,
    };
  }
}

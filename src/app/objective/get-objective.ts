import type { Objective } from "../../domain/initiative.ts";
import { UnknownReferenceError } from "../errors.ts";

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
  integrations: Array<{ repository: string; state: string }>;
}

export class GetObjective {
  readonly #objectives: ObjectiveSource;
  readonly #repos: RepositoryResolver;

  constructor(objectives: ObjectiveSource, repos: RepositoryResolver) {
    this.#objectives = objectives;
    this.#repos = repos;
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

    return {
      id: objective.id,
      name: objective.name,
      status,
      integrations:
        repositoryId !== undefined
          ? [{ repository: repositoryId, state: status }]
          : [],
    };
  }
}

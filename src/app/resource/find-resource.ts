import type { ProjectRepository } from "../../storage/port.ts";
import { UnknownReferenceError, AmbiguousNameError } from "../errors.ts";

export class FindResource {
  readonly #repo: ProjectRepository;

  constructor(repo: ProjectRepository) {
    this.#repo = repo;
  }

  async execute(input: { projectId: string; name: string }): Promise<string> {
    const ids = this.#repo.resolveResourceByName(input.projectId, input.name);
    if (ids.length === 0) {
      throw new UnknownReferenceError("resource", input.name);
    }
    if (ids.length > 1) {
      throw new AmbiguousNameError("resource", input.name, ids);
    }
    return ids[0] as string;
  }
}

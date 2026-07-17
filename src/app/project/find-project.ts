import type { ProjectRepository } from "../../storage/port.ts";
import { UnknownReferenceError, AmbiguousNameError } from "../errors.ts";

export class FindProject {
  readonly #repo: ProjectRepository;

  constructor(repo: ProjectRepository) {
    this.#repo = repo;
  }

  async execute(input: { name: string }): Promise<string> {
    const ids = this.#repo.resolveProjectByName(input.name);
    if (ids.length === 0) {
      throw new UnknownReferenceError("project", input.name);
    }
    if (ids.length > 1) {
      throw new AmbiguousNameError("project", input.name, ids);
    }
    return ids[0] as string;
  }
}

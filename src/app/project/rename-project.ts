import type { ProjectRepository } from "../../storage/port.ts";
import { UnknownReferenceError } from "../errors.ts";

export class RenameProject {
  readonly #repo: ProjectRepository;

  constructor(repo: ProjectRepository) {
    this.#repo = repo;
  }

  async execute(input: { id: string; name: string }): Promise<void> {
    const project = this.#repo.get(input.id);
    if (project === undefined) {
      throw new UnknownReferenceError("project", input.id);
    }
    project.name = input.name;
    this.#repo.save(project);
  }
}

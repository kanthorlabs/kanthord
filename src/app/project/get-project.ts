import type { ProjectRepository } from "../../storage/port.ts";
import type { Project } from "../../domain/project.ts";
import { UnknownReferenceError } from "../errors.ts";

export class GetProject {
  readonly #repo: ProjectRepository;

  constructor(repo: ProjectRepository) {
    this.#repo = repo;
  }

  async execute(input: { id: string }): Promise<Project> {
    const project = this.#repo.get(input.id);
    if (project === undefined) {
      throw new UnknownReferenceError("project", input.id);
    }
    return project;
  }
}

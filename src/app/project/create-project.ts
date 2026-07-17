import type { ProjectRepository } from "../../storage/port.ts";
import { newProject } from "../../domain/project.ts";
import { DuplicateNameError } from "../errors.ts";

export class CreateProject {
  readonly #repo: ProjectRepository;

  constructor(repo: ProjectRepository) {
    this.#repo = repo;
  }

  async execute(input: { name: string }): Promise<string> {
    const existing = this.#repo.resolveProjectByName(input.name);
    if (existing.length > 0) {
      throw new DuplicateNameError("project", "global", input.name);
    }
    const project = newProject(input.name);
    this.#repo.save(project);
    return project.id;
  }
}

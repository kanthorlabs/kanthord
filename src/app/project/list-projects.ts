import type { ProjectRepository } from "../../storage/port.ts";
import type { Project } from "../../domain/project.ts";

export class ListProjects {
  readonly #projects: ProjectRepository;

  constructor(projects: ProjectRepository) {
    this.#projects = projects;
  }

  execute(): Project[] {
    return this.#projects.listProjects();
  }
}

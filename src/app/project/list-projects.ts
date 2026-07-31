import type { ProjectRepository } from "../../storage/port.ts";
import type { Project } from "../../domain/project.ts";

export class ListProjects {
  readonly #projects: ProjectRepository;

  constructor(projects: ProjectRepository) {
    this.#projects = projects;
  }

  execute(input?: { name?: string }): Project[] {
    const projects = this.#projects.listProjects();
    if (input?.name === undefined) {
      return projects;
    }
    const needle = input.name.toLowerCase();
    return projects.filter((p) => p.name.toLowerCase().includes(needle));
  }
}

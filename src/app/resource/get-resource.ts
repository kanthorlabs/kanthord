import type { ProjectRepository } from "../../storage/port.ts";
import { UnknownReferenceError } from "../errors.ts";
import { toResourceView, type ResourceView } from "./resource-view.ts";

// ---------------------------------------------------------------------------
// GetResource use case
// ---------------------------------------------------------------------------

export class GetResource {
  private readonly projectRepository: ProjectRepository;

  constructor(projectRepository: ProjectRepository) {
    this.projectRepository = projectRepository;
  }

  execute(id: string): ResourceView {
    const resource = this.projectRepository.getResource(id);
    if (resource === undefined) {
      throw new UnknownReferenceError("resource", id);
    }
    return toResourceView(resource);
  }
}

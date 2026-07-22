import type { ResourceType } from "../../domain/resource.ts";
import type { ProjectRepository } from "../../storage/port.ts";
import { toResourceView, type ResourceView } from "./resource-view.ts";

/**
 * Project-scoped, type-filtered resource query. Reuses `toResourceView` so a
 * listed credential never carries its secret `value` (mirrors `GetResource`).
 */
export class ListResources {
  private readonly projectRepository: ProjectRepository;

  constructor(projectRepository: ProjectRepository) {
    this.projectRepository = projectRepository;
  }

  execute(input: { projectId: string; type: ResourceType }): ResourceView[] {
    const resources =
      this.projectRepository.listResourcesByProject?.(
        input.projectId,
        input.type,
      ) ?? [];
    return resources.map(toResourceView);
  }
}

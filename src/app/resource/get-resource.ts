import type {
  ProjectRepository,
  PublicationRepository,
} from "../../storage/port.ts";
import { UnknownReferenceError } from "../errors.ts";
import { toResourceView, type ResourceView } from "./resource-view.ts";

// ---------------------------------------------------------------------------
// GetResource use case
// ---------------------------------------------------------------------------

export class GetResource {
  private readonly projectRepository: ProjectRepository;
  private readonly publicationRepository?: PublicationRepository;

  constructor(
    projectRepository: ProjectRepository,
    publicationRepository?: PublicationRepository,
  ) {
    this.projectRepository = projectRepository;
    this.publicationRepository = publicationRepository;
  }

  execute(id: string): ResourceView {
    const resource = this.projectRepository.getResource(id);
    if (resource === undefined) {
      throw new UnknownReferenceError("resource", id);
    }
    const view = toResourceView(resource);
    if (
      view.type === "repository" &&
      this.publicationRepository !== undefined
    ) {
      const record = this.publicationRepository.getLatestPublication(view.id);
      view.publication = record ?? null;
    }
    return view;
  }
}

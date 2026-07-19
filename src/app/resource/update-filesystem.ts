import type { ProjectRepository } from "../../storage/port.ts";
import type { Filesystem } from "../../domain/resource.ts";
import { UnknownReferenceError } from "../errors.ts";
import { ImmutableFieldError } from "./update-resource.ts";
import type { UpdateFilesystemInput } from "./update-resource.ts";

const IMMUTABLE_FIELDS = ["id", "projectId", "type"] as const;

export class UpdateFilesystem {
  readonly #projectRepository: ProjectRepository;

  constructor(projectRepository: ProjectRepository) {
    this.#projectRepository = projectRepository;
  }

  async execute(input: UpdateFilesystemInput): Promise<void> {
    const resource = this.#projectRepository.getResource(input.id);
    if (resource === undefined) {
      throw new UnknownReferenceError("resource", input.id);
    }

    const inputRecord: Record<string, unknown> = input;
    const storedRecord = resource as unknown as Record<string, unknown>;
    for (const key of IMMUTABLE_FIELDS) {
      if (key in inputRecord && inputRecord[key] !== storedRecord[key]) {
        throw new ImmutableFieldError(key);
      }
    }

    const fs = resource as Filesystem;
    const updated: Filesystem = {
      ...fs,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.path !== undefined ? { path: input.path } : {}),
    };

    this.#projectRepository.addResource(fs.projectId ?? "", updated);
  }
}

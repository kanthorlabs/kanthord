import type { ProjectRepository } from "../../storage/port.ts";
import {
  hasEmbeddedUserinfo,
  EmbeddedCredentialError,
  isRepository,
} from "../../domain/resource.ts";
import { UnknownReferenceError } from "../errors.ts";
import {
  ImmutableFieldError,
  CacheConflictError,
  type UpdateRepositoryInput,
} from "./update-resource.ts";

const IMMUTABLE_FIELDS = ["id", "projectId", "type"] as const;

export class UpdateRepository {
  readonly #projectRepository: ProjectRepository;
  readonly #homePathExists: (path: string) => Promise<boolean>;

  constructor(
    projectRepository: ProjectRepository,
    homePathExists: (path: string) => Promise<boolean>,
  ) {
    this.#projectRepository = projectRepository;
    this.#homePathExists = homePathExists;
  }

  async execute(input: UpdateRepositoryInput): Promise<void> {
    const resource = this.#projectRepository.getResource(input.id);
    if (resource === undefined) {
      throw new UnknownReferenceError("repository", input.id);
    }

    // Runtime immutable-field check via index cast through unknown
    const inputRecord = input as unknown as Record<string, unknown>;
    const storedRecord = resource as unknown as Record<string, unknown>;
    for (const field of IMMUTABLE_FIELDS) {
      if (
        field in inputRecord &&
        inputRecord[field] !== undefined &&
        inputRecord[field] !== storedRecord[field]
      ) {
        throw new ImmutableFieldError(field);
      }
    }

    // remoteUrl validation (resource must be a Repository to have remoteUrl)
    const storedRepo = isRepository(resource) ? resource : undefined;
    if (input.remoteUrl !== undefined) {
      if (hasEmbeddedUserinfo(input.remoteUrl)) {
        throw new EmbeddedCredentialError(input.remoteUrl);
      }
      const homePath = storedRepo?.path ?? "";
      if (homePath !== "") {
        const exists = await this.#homePathExists(homePath);
        if (exists && !input.reclone) {
          throw new CacheConflictError(input.id);
        }
      }
    }

    // Build updated resource
    const updated = { ...resource } as unknown as Record<string, unknown>;
    if (input.name !== undefined) updated["name"] = input.name;
    if (input.remoteUrl !== undefined) {
      updated["remoteUrl"] = input.remoteUrl;
      if (input.reclone) {
        updated["path"] = "";
      }
    }
    if (input.branch !== undefined) updated["branch"] = input.branch;
    if (input.path !== undefined) updated["path"] = input.path;
    if (input.auth !== undefined) updated["auth"] = input.auth;

    this.#projectRepository.addResource(
      (storedRecord["projectId"] as string) ?? "",
      updated as unknown as typeof resource,
    );
  }
}

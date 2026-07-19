import type { ProjectRepository } from "../../storage/port.ts";
import type { Credential } from "../../domain/resource.ts";
import { UnknownReferenceError } from "../errors.ts";
import { ImmutableFieldError } from "./update-resource.ts";
import type { UpdateCredentialInput } from "./update-resource.ts";

const IMMUTABLE_FIELDS = ["id", "projectId", "type", "provider"] as const;

export class UpdateCredential {
  readonly #projectRepository: ProjectRepository;

  constructor(projectRepository: ProjectRepository) {
    this.#projectRepository = projectRepository;
  }

  async execute(input: UpdateCredentialInput): Promise<void> {
    const resource = this.#projectRepository.getResource(input.id);
    if (resource === undefined) {
      throw new UnknownReferenceError("resource", input.id);
    }

    // Runtime guard — input may arrive as an arbitrary record (e.g. cast by tests
    // to simulate a caller passing an immutable field).
    const inputRecord: Record<string, unknown> = input;
    const storedRecord = resource as unknown as Record<string, unknown>;
    for (const key of IMMUTABLE_FIELDS) {
      if (key in inputRecord && inputRecord[key] !== storedRecord[key]) {
        throw new ImmutableFieldError(key);
      }
    }

    const cred = resource as Credential;
    const updated: Credential = {
      ...cred,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.value !== undefined ? { value: input.value } : {}),
    };

    this.#projectRepository.addResource(cred.projectId ?? "", updated);
  }
}

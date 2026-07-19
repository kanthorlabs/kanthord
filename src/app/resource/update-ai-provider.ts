import type { ProjectRepository } from "../../storage/port.ts";
import type { AIProvider } from "../../domain/resource.ts";
import type { ModelCatalog } from "../../model-catalog/port.ts";
import { UnknownModelError } from "../../model-catalog/port.ts";
import { UnknownReferenceError } from "../errors.ts";
import { ImmutableFieldError } from "./update-resource.ts";
import type { UpdateAiProviderInput } from "./update-resource.ts";

const IMMUTABLE_FIELDS = ["id", "projectId", "type", "provider"] as const;

export class UpdateAiProvider {
  readonly #projectRepository: ProjectRepository;
  readonly #modelCatalog: ModelCatalog;

  constructor(
    projectRepository: ProjectRepository,
    modelCatalog: ModelCatalog,
  ) {
    this.#projectRepository = projectRepository;
    this.#modelCatalog = modelCatalog;
  }

  async execute(input: UpdateAiProviderInput): Promise<void> {
    const resource = this.#projectRepository.getResource(input.id);
    if (resource === undefined) {
      throw new UnknownReferenceError("resource", input.id);
    }

    // Runtime guard — input may arrive as an arbitrary record (e.g. cast by tests
    // to simulate a caller passing an immutable field such as provider).
    const inputRecord = input as unknown as Record<string, unknown>;
    const storedRecord = resource as unknown as Record<string, unknown>;
    for (const key of IMMUTABLE_FIELDS) {
      if (key in inputRecord && inputRecord[key] !== storedRecord[key]) {
        throw new ImmutableFieldError(key);
      }
    }

    const aip = resource as AIProvider;

    // Validate model against the catalog when the caller wants to change it.
    if (input.model !== undefined) {
      if (!this.#modelCatalog.isValid(aip.provider, input.model)) {
        throw new UnknownModelError(aip.provider, input.model);
      }
    }

    const updated: AIProvider = {
      ...aip,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
    };

    // null = explicit clear; undefined = leave unchanged.
    if (input.effort === null) {
      updated.effort = undefined;
    } else if (input.effort !== undefined) {
      updated.effort = input.effort;
    }

    if (input.baseUrl === null) {
      updated.baseUrl = undefined;
    } else if (input.baseUrl !== undefined) {
      updated.baseUrl = input.baseUrl;
    }

    this.#projectRepository.addResource(aip.projectId ?? "", updated);
  }
}

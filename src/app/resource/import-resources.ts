import type {
  ProjectRepository,
  ReferenceResolver,
  UnitOfWork,
} from "../../storage/port.ts";
import {
  buildResource,
  ResourceValidationError,
  UnknownResourceTypeError,
} from "../../domain/resource.ts";
import { UnknownReferenceError } from "../errors.ts";

export class ImportValidationError extends Error {
  readonly index: number;
  readonly entryName: string;

  constructor(index: number, entryName: string, message?: string) {
    super(message ?? `invalid entry at index ${index}: ${entryName}`);
    this.name = "ImportValidationError";
    this.index = index;
    this.entryName = entryName;
  }
}

export class ImportResources {
  readonly #projectRepository: ProjectRepository;
  readonly #referenceResolver: ReferenceResolver;
  readonly #uow: UnitOfWork;

  constructor(
    projectRepository: ProjectRepository,
    referenceResolver: ReferenceResolver,
    uow: UnitOfWork,
  ) {
    this.#projectRepository = projectRepository;
    this.#referenceResolver = referenceResolver;
    this.#uow = uow;
  }

  async execute(input: {
    projectId: string;
    entries: Array<Record<string, unknown>>;
  }): Promise<string[]> {
    const { projectId, entries } = input;

    const kind = this.#referenceResolver.resolveKind(projectId);
    if (kind === undefined || kind !== "project") {
      throw new UnknownReferenceError("project", projectId);
    }

    return this.#uow.transaction<string[]>(() => {
      const ids: string[] = [];

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i] as Record<string, unknown>;
        const oneBasedIndex = i + 1;
        const entryName = String(entry["name"] ?? "");

        let resource;
        try {
          resource = buildResource(entry);
        } catch (err) {
          if (
            err instanceof ResourceValidationError ||
            err instanceof UnknownResourceTypeError
          ) {
            throw new ImportValidationError(oneBasedIndex, entryName);
          }
          throw err;
        }

        const existing = this.#projectRepository.resolveResourceByName(
          projectId,
          resource.name,
        );
        if (existing.length > 0) {
          throw new ImportValidationError(oneBasedIndex, resource.name);
        }

        this.#projectRepository.addResource(projectId, resource);
        ids.push(resource.id);
      }

      return ids;
    });
  }
}

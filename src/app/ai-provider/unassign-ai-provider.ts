// src/app/ai-provider/unassign-ai-provider.ts — UnassignAiProvider use case
// (008.2 Story B: unassign a provider from a project).

import type {
  AiProviderRegistry,
  ReferenceResolver,
  UnitOfWork,
} from "../../storage/port.ts";
import { UnknownReferenceError } from "../errors.ts";

export interface UnassignAiProviderInput {
  projectId: string;
  providerId: string;
}

export class UnassignAiProvider {
  readonly #registry: AiProviderRegistry;
  readonly #refResolver: ReferenceResolver;
  readonly #uow: UnitOfWork;

  constructor(
    registry: AiProviderRegistry,
    refResolver: ReferenceResolver,
    uow: UnitOfWork,
  ) {
    this.#registry = registry;
    this.#refResolver = refResolver;
    this.#uow = uow;
  }

  execute(input: UnassignAiProviderInput): void {
    this.#uow.transaction(() => {
      const { projectId, providerId } = input;

      // Validate project exists.
      if (this.#refResolver.resolveKind(projectId) !== "project") {
        throw new UnknownReferenceError("project", projectId);
      }

      // Validate provider exists.
      if (this.#registry.get(providerId) === undefined) {
        throw new UnknownReferenceError("ai_provider", providerId);
      }

      // Unassign is idempotent — the adapter no-ops if the row doesn't exist.
      this.#registry.unassign(projectId, providerId);
      this.#registry.compactRanks(projectId);
    });
  }
}

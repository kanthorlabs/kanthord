// src/app/ai-provider/assign-ai-provider.ts — AssignAiProvider use case
// (008.2 Story B: assign a provider to a project at a specified rank).

import type {
  AiProviderRegistry,
  ReferenceResolver,
  UnitOfWork,
} from "../../storage/port.ts";
import { UnknownReferenceError } from "../errors.ts";
import { DuplicateAssignmentError, InvalidRankError } from "./errors.ts";

export interface AssignAiProviderInput {
  projectId: string;
  providerId: string;
  rank?: number;
}

export class AssignAiProvider {
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

  execute(input: AssignAiProviderInput): void {
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

      // Reject duplicate assignment.
      if (this.#registry.getAssignment(projectId, providerId) !== undefined) {
        throw new DuplicateAssignmentError(projectId, providerId);
      }

      // Determine effective rank: when omitted, append at maxRank + 1.
      const effectiveRank =
        input.rank ?? (this.#registry.maxRank(projectId) ?? -1) + 1;

      // B3: reject negative rank.
      if (effectiveRank < 0) {
        throw new InvalidRankError(effectiveRank);
      }

      // Shift existing ranks to make room for the new assignment.
      this.#registry.shiftRanksFrom(projectId, effectiveRank);
      this.#registry.assign(projectId, providerId, effectiveRank);
    });
  }
}

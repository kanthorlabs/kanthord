// src/app/ai-provider/resolve-project-chain.ts — 008.2 Story D
// Resolved-chain use case: given a projectId, reads assigned providers and
// the global default from the registry, runs the pure resolver, and maps to
// AiProviderView (no value/credential leak).

import type {
  AiProviderRegistry,
  ReferenceResolver,
} from "../../storage/port.ts";
import type { AiProviderView } from "./ai-provider-view.ts";
import { resolveProviderChain } from "../../domain/resolve-provider-chain.ts";
import { UnknownReferenceError } from "../errors.ts";

export class ResolveProjectChain {
  readonly #registry: AiProviderRegistry;
  readonly #refResolver?: ReferenceResolver;

  constructor(registry: AiProviderRegistry, refResolver?: ReferenceResolver) {
    this.#registry = registry;
    this.#refResolver = refResolver;
  }

  execute(projectId: string): AiProviderView[] {
    // S3: validate project exists when a resolver is available.
    if (
      this.#refResolver !== undefined &&
      this.#refResolver.resolveKind(projectId) !== "project"
    ) {
      throw new UnknownReferenceError("project", projectId);
    }

    const assigned = this.#registry.listAssigned(projectId);
    const defaultProvider = this.#registry.getDefault();
    const chain = resolveProviderChain(assigned, defaultProvider);

    return chain.map((p) => ({
      id: p.id,
      name: p.name,
      provider: p.provider,
      model: p.model,
      baseUrl: p.baseUrl,
      effort: p.effort,
      state: p.state,
      isDefault: p.id === defaultProvider?.id,
    }));
  }
}

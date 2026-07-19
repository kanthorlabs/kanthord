/**
 * PiModelCatalog — ModelCatalog adapter backed by the pi-ai builtin catalog.
 * Only composition.ts imports this module (port.ts must never import adapters).
 */

import type { ModelCatalog } from "./port.ts";

// Minimal structural type for the model-listing function — avoids importing
// from apps/. The real ListModels (returning ModelInfo[]) satisfies this by
// structural typing (ModelInfo has provider + id plus additional fields).
type ModelEntry = { provider: string; id: string };
type ListModels = (provider?: string) => ModelEntry[];

/**
 * Implements ModelCatalog by delegating to a ListModels function (the same
 * function composition.ts derives from builtinModels()). For each
 * isValid call, retrieves the catalog for the given provider and checks for
 * an exact (provider, model) match.
 */
export class PiModelCatalog implements ModelCatalog {
  readonly #listModels: ListModels;

  constructor(listModels: ListModels) {
    this.#listModels = listModels;
  }

  isValid(provider: string, model: string): boolean {
    const models = this.#listModels(provider);
    return models.some((m) => m.provider === provider && m.id === model);
  }
}

import type { ModelCatalog } from "./port.ts";

/**
 * In-memory fake for use in hermetic tests.
 * No-args constructor rejects all pairs; supply an explicit list to accept specific pairs.
 */
export class FakeModelCatalog implements ModelCatalog {
  readonly #validPairs: ReadonlyArray<{ provider: string; model: string }>;

  constructor(validPairs?: Array<{ provider: string; model: string }>) {
    this.#validPairs = validPairs ?? [];
  }

  isValid(provider: string, model: string): boolean {
    return this.#validPairs.some(
      (p) => p.provider === provider && p.model === model,
    );
  }
}

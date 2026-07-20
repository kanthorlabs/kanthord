/**
 * ModelCatalog port — validates (provider, model) pairs at create/update time.
 * Lives in the model-catalog capability directory; consumed by app/ use cases.
 * Only composition.ts imports the concrete adapter (src/model-catalog/pi.ts).
 */

export interface ModelCatalog {
  /** Returns true if the (provider, model) pair is known and usable. */
  isValid(provider: string, model: string): boolean;
}

/**
 * Thrown by AddResource and UpdateAiProvider when the (provider, model) pair
 * is not in the catalog. Message must contain "list model" verbatim so that the
 * CLI error-map can forward it to stderr and the Proof's grep check passes.
 */
export class UnknownModelError extends Error {
  readonly provider: string;
  readonly model: string;

  constructor(provider: string, model: string) {
    super(
      `Unknown (provider, model) pair: "${provider}" / "${model}". Run \`list model\` to see available models.`,
    );
    this.name = "UnknownModelError";
    this.provider = provider;
    this.model = model;
  }
}

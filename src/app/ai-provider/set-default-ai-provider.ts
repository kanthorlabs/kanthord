// src/app/ai-provider/set-default-ai-provider.ts — SetDefaultAiProvider use case
// (008.1 Story C: set-default repoints the default pointer to an active provider).

import type { AiProviderRegistry } from "../../storage/port.ts";
import { UnknownReferenceError } from "../errors.ts";
import { LoggedOutProviderError } from "./errors.ts";

export class SetDefaultAiProvider {
  readonly #registry: AiProviderRegistry;

  constructor(registry: AiProviderRegistry) {
    this.#registry = registry;
  }

  execute(id: string): void {
    const provider = this.#registry.get(id);
    if (provider === undefined) {
      throw new UnknownReferenceError("ai_provider", id);
    }
    if (provider.state !== "active") {
      throw new LoggedOutProviderError(id, "set-default");
    }
    this.#registry.setDefault(id);
  }
}

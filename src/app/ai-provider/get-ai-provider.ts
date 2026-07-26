// src/app/ai-provider/get-ai-provider.ts — GetAiProvider use case
// (008.1 Story C: read use case, derives isDefault from the pointer).

import type { AiProviderRegistry } from "../../storage/port.ts";
import type { AiProviderView } from "./ai-provider-view.ts";
import { UnknownReferenceError } from "../errors.ts";

export class GetAiProvider {
  readonly #registry: AiProviderRegistry;

  constructor(registry: AiProviderRegistry) {
    this.#registry = registry;
  }

  execute(id: string): AiProviderView {
    const provider = this.#registry.get(id);
    if (provider === undefined) {
      throw new UnknownReferenceError("ai_provider", id);
    }

    const defaultProvider = this.#registry.getDefault();
    return {
      id: provider.id,
      name: provider.name,
      provider: provider.provider,
      model: provider.model,
      baseUrl: provider.baseUrl,
      effort: provider.effort,
      state: provider.state,
      isDefault: id === defaultProvider?.id,
    };
  }
}

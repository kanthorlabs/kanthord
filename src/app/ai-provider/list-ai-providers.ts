// src/app/ai-provider/list-ai-providers.ts — ListAiProviders use case
// (008.1 Story C: read/register CLI, derives isDefault from the pointer).

import type { AiProviderRegistry } from "../../storage/port.ts";
import type { AiProviderView } from "./ai-provider-view.ts";

export class ListAiProviders {
  readonly #registry: AiProviderRegistry;

  constructor(registry: AiProviderRegistry) {
    this.#registry = registry;
  }

  execute(): AiProviderView[] {
    const providers = this.#registry.list();
    const defaultProvider = this.#registry.getDefault();

    return providers.map((p) => ({
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

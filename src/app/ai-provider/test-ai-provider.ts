// src/app/ai-provider/test-ai-provider.ts — TestAiProvider use case
// (008.1 Story D / BLOCKER B1: delegates probing to ProviderProbe port).

import type { ProviderProbe } from "../../agent-runner/port.ts";

export interface TestAiProviderInput {
  id: string;
  prompt: string;
}

export class TestAiProvider {
  readonly #probe: ProviderProbe;

  constructor(probe: ProviderProbe) {
    this.#probe = probe;
  }

  async execute(input: TestAiProviderInput): Promise<string> {
    return this.#probe.probe(input.id, input.prompt);
  }
}

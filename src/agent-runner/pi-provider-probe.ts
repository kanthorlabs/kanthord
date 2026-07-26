// src/agent-runner/pi-provider-probe.ts — ProviderProbe adapter
// (008.1 BLOCKER B1: wraps PiProviderSessionFactory behind the port boundary).

import type { ProviderProbe } from "./port.ts";
import type { AiProviderRegistry } from "../storage/port.ts";
import type { ProviderSessionFactory } from "./pi-session.ts";
import {
  UnknownReferenceError,
  LoggedOutProviderError,
} from "../domain/errors.ts";
import { toResolvedProvider } from "./resolved-provider.ts";

export class PiProviderProbe implements ProviderProbe {
  readonly #registry: AiProviderRegistry;
  readonly #sessions: ProviderSessionFactory;

  constructor(registry: AiProviderRegistry, sessions: ProviderSessionFactory) {
    this.#registry = registry;
    this.#sessions = sessions;
  }

  async probe(providerId: string, prompt: string): Promise<string> {
    const p = this.#registry.get(providerId);
    if (p === undefined) {
      throw new UnknownReferenceError("ai_provider", providerId);
    }
    if (p.state === "logged_out") {
      throw new LoggedOutProviderError(providerId, "test");
    }

    // Build ResolvedProvider from the GlobalAiProvider record
    const resolvedProvider = toResolvedProvider(p);

    const session = await this.#sessions.for(
      resolvedProvider,
      undefined,
      p.credentialVersion,
    );

    // Drain the stream: collect text_delta deltas only
    const chunks: string[] = [];
    for await (const raw of session.streamFn(session.model, {
      messages: [
        {
          role: "user",
          content: [{ type: "text" as const, text: prompt }],
          timestamp: Date.now(),
        },
      ],
    } as any)) {
      const event = raw as { type: string; delta?: string };
      if (event.type === "text_delta" && event.delta !== undefined) {
        chunks.push(event.delta);
      }
    }

    return chunks.join("");
  }
}

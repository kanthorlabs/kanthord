// src/agent-runner/pi-provider-probe.test.ts — PiProviderProbe adapter
// (008.1 BLOCKER B2(b): logged_out provider guard).

import { test } from "node:test";
import assert from "node:assert/strict";
import { PiProviderProbe } from "./pi-provider-probe.ts";
import type { AiProviderRegistry, GlobalAiProvider } from "../storage/port.ts";
import type { ProviderSessionFactory, ProviderSession } from "./pi-session.ts";
import type { AIProvider, Credential } from "../domain/resource.ts";
import { LoggedOutProviderError } from "../app/ai-provider/errors.ts";

// ------------------------------------------------------------------ fakes

class FakeRegistry implements AiProviderRegistry {
  get(id: string): GlobalAiProvider | undefined {
    if (id === "logged-out-id") {
      return {
        id: "logged-out-id",
        name: "logged-out-provider",
        provider: "custom-one",
        model: "qwen-max",
        baseUrl: "http://localhost:8080/v1",
        effort: null,
        value: null,
        state: "logged_out",
        credentialVersion: 2,
        api: "openai-completions",
        contextWindow: 32768,
        maxTokens: 4096,
      };
    }
    return undefined;
  }

  register(): GlobalAiProvider {
    throw new Error("not used in this test");
  }
  list(): GlobalAiProvider[] {
    return [];
  }
  getDefault(): GlobalAiProvider | undefined {
    return undefined;
  }
  setDefault(_id: string): void {}
  clearDefault(): void {}
  logout(_id: string): void {}
  remove(_id: string): void {}
}

class FakeSessionFactory implements ProviderSessionFactory {
  async for(
    _aiProvider: AIProvider,
    _credential: Credential,
  ): Promise<ProviderSession> {
    throw new Error(
      "sessions.for() should not be called for logged_out provider",
    );
  }
}

// ------------------------------------------------------------------ tests

test("PiProviderProbe: logged_out provider throws LoggedOutProviderError up front", async () => {
  const probe = new PiProviderProbe(
    new FakeRegistry(),
    new FakeSessionFactory(),
  );

  await assert.rejects(
    () => probe.probe("logged-out-id", "hello"),
    LoggedOutProviderError,
  );
});

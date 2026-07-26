// src/app/ai-provider/test-ai-provider.test.ts — TestAiProvider use case
// (008.1 Story D / BLOCKER B1: one-shot completion test of an AI provider).

import { test } from "node:test";
import assert from "node:assert/strict";
import { UnknownReferenceError } from "../errors.ts";
import { TestAiProvider } from "./test-ai-provider.ts";
import type { ProviderProbe } from "../../agent-runner/port.ts";

// ------------------------------------------------------------------ fakes

class FakeProbe implements ProviderProbe {
  readonly #store = new Map<string, string>();

  set(id: string, text: string): void {
    this.#store.set(id, text);
  }

  async probe(providerId: string, _prompt: string): Promise<string> {
    const text = this.#store.get(providerId);
    if (text === undefined) {
      throw new UnknownReferenceError("ai_provider", providerId);
    }
    return text;
  }
}

// -------------------------------------------------------- tests

test("TestAiProvider: execute with known id returns concatenated text from streamFn", async () => {
  const probe = new FakeProbe();
  probe.set("some-id", "Hello World");
  const uc = new TestAiProvider(probe);

  const result = await uc.execute({ id: "some-id", prompt: "Hi?" });

  assert.equal(result, "Hello World");
});

test("TestAiProvider: execute with unknown id throws UnknownReferenceError", async () => {
  const probe = new FakeProbe();
  const uc = new TestAiProvider(probe);

  await assert.rejects(
    () => uc.execute({ id: "no-such-id", prompt: "Hi" }),
    UnknownReferenceError,
  );
});

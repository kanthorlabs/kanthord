/**
 * Story C — Session reconstruction for custom providers.
 *
 * Given a custom GlobalAiProvider (api != null), PiProviderSessionFactory.for()
 * builds a session-local model catalog with createModels/createProvider,
 * deriving the runtimeId from the record id ("custom:<id>") so two custom
 * accounts of the same kind never collide.
 *
 * Hermetic: no network, no real adapters.  The session factory and pi-ai are
 * real; provider/model must exist in pi's builtin catalog so the builtin path
 * succeeds (though the custom path bypasses it).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AIProvider, Credential } from "../domain/resource.ts";
import { PiProviderSessionFactory } from "./pi-session.ts";

// ---------- fixture builders -------------------------------------------------

function makeCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: "cred-01",
    type: "credential",
    name: "custom-key",
    provider: "qwen-token-plan",
    value: "sk-custom-val",
    ...overrides,
  };
}

/**
 * Build a provider that represents a custom OpenAI-compatible record.
 * The `api` field signals custom-provier reconstruction; at the domain-type
 * level it is spliced in as an extra field the session factory will read.
 */
function makeCustomProvider(
  id: string,
  overrides: Partial<AIProvider> & {
    api?: "openai-completions" | "openai-responses";
    contextWindow?: number;
    maxTokens?: number;
  } = {},
): AIProvider & {
  api: "openai-completions" | "openai-responses";
  contextWindow: number;
  maxTokens: number;
} {
  return {
    id,
    type: "ai_provider",
    name: "custom-qwen",
    provider: "qwen-token-plan",
    model: "qwen-max",
    baseUrl: "http://localhost:8080/v1",
    api: "openai-completions",
    contextWindow: 32768,
    maxTokens: 4096,
    ...overrides,
  } as AIProvider & {
    api: "openai-completions" | "openai-responses";
    contextWindow: number;
    maxTokens: number;
  };
}

function makeFactory(): PiProviderSessionFactory {
  return new PiProviderSessionFactory({
    saveCredentialValue: () => {},
  });
}

// ---------- custom-provider session reconstruction ---------------------------

test("PiProviderSessionFactory custom provider returns session with model.provider derived from record id", async () => {
  const factory = makeFactory();
  const provider = makeCustomProvider("aip-custom-1");
  const session = await factory.for(provider, makeCredential());

  // The runtimeId must be derived from the record id, not the bare
  // --custom-provider-id, so two accounts of the same kind never collide.
  assert.equal(
    session.model.provider,
    "custom:aip-custom-1",
    "model.provider is the record-derived runtimeId",
  );
});

test("PiProviderSessionFactory custom provider sets model.baseUrl from the custom url", async () => {
  const factory = makeFactory();
  const provider = makeCustomProvider("aip-custom-2", {
    baseUrl: "https://my-gateway.example.com/v1",
  });
  const session = await factory.for(provider, makeCredential());

  assert.equal(
    session.model.baseUrl,
    "https://my-gateway.example.com/v1",
    "model.baseUrl matches the custom endpoint",
  );
});

test("PiProviderSessionFactory custom provider getApiKey returns the credential value", async () => {
  const factory = makeFactory();
  const provider = makeCustomProvider("aip-custom-3");
  const session = await factory.for(
    provider,
    makeCredential({ value: "sk-my-folded-key" }),
  );

  assert.equal(
    session.getApiKey(),
    "sk-my-folded-key",
    "getApiKey returns the folded credential value",
  );
});

test("PiProviderSessionFactory custom provider does not throw for a valid custom record", async () => {
  const factory = makeFactory();
  const provider = makeCustomProvider("aip-custom-4");
  // Should resolve without UnknownModelError or CredentialError
  const session = await factory.for(provider, makeCredential());
  assert.ok(session, "session is returned for a valid custom record");
  assert.ok(session.model, "session has a model");
  assert.equal(
    session.model.id,
    "qwen-max",
    "model id is the custom model name",
  );
});

test("PiProviderSessionFactory custom provider streamFn produces text events through the real HTTP path", async () => {
  const factory = makeFactory();
  const provider = makeCustomProvider("aip-stream-test", {
    baseUrl: "http://127.0.0.1:0/v1",
  });

  // Start a local HTTP server that speaks SSE with DATETIME-OK
  const { createServer } = await import("node:http");
  let receivedAuthHeader: string | undefined;
  const server = createServer((req, res) => {
    receivedAuthHeader = req.headers.authorization;
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" } }] })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "DATETIME-OK" } }] })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
      );
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("no address"));
    });
  });

  try {
    provider.baseUrl = `http://127.0.0.1:${port}/v1`;
    const credential = makeCredential({ value: "sk-secret-key" });
    const session = await factory.for(provider, credential);

    // Drain the stream — if auth is missing, pi will error with "No API key"
    const texts: string[] = [];
    let error: unknown = undefined;
    try {
      for await (const raw of session.streamFn(session.model, {
        messages: [
          {
            role: "user",
            content: [{ type: "text" as const, text: "hello" }],
            timestamp: Date.now(),
          },
        ],
      })) {
        const event = raw as { type: string; delta?: string };
        if (event.type === "text_delta" && event.delta !== undefined) {
          texts.push(event.delta);
        }
      }
    } catch (e) {
      error = e;
    }

    assert.equal(error, undefined, "stream must not throw 'No API key' error");
    assert.ok(
      texts.length > 0,
      "stream must produce at least one text_delta event",
    );
    assert.equal(texts.join(""), "DATETIME-OK");
  } finally {
    server.close();
  }
});

test("PiProviderSessionFactory two custom records with different ids yield distinct runtime ids", async () => {
  const factory = makeFactory();
  const provider1 = makeCustomProvider("aip-custom-5");
  const provider2 = makeCustomProvider("aip-custom-6");

  const session1 = await factory.for(provider1, makeCredential());
  const session2 = await factory.for(provider2, makeCredential());

  assert.notEqual(
    session1.model.provider,
    session2.model.provider,
    "two records with same --custom-provider-id but different ids get distinct runtime ids",
  );
  assert.equal(session1.model.provider, "custom:aip-custom-5");
  assert.equal(session2.model.provider, "custom:aip-custom-6");
});

// ═══════════════════════════════════════════════════════════════════
// S5 — openai-responses flavor + stale cast cleanup
// ═══════════════════════════════════════════════════════════════════

test("PiProviderSessionFactory custom provider with openai-responses flavor returns session with correct model", async () => {
  const factory = makeFactory();
  const provider = makeCustomProvider("aip-responses-1", {
    api: "openai-responses",
  });
  const session = await factory.for(provider, makeCredential());

  assert.ok(
    session,
    "session is returned for openai-responses custom provider",
  );
  assert.equal(session.model.provider, "custom:aip-responses-1");
});

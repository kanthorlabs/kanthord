// src/agent-runner/pi-provider-probe.test.ts — PiProviderProbe adapter
// (008.1 BLOCKER B2(b): logged_out provider guard).

import { test } from "node:test";
import assert from "node:assert/strict";
import { PiProviderProbe } from "./pi-provider-probe.ts";
import type { AiProviderRegistry, GlobalAiProvider } from "../storage/port.ts";
import type { ProviderSessionFactory, ProviderSession } from "./pi-session.ts";
import type { ResolvedProvider } from "./port.ts";
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
  updateCredentialCAS(
    _id: string,
    _value: string,
    _expectedVersion: number,
  ): { applied: true; newVersion: number } | { applied: false } {
    return { applied: false };
  }

  // ── 008.2 project→provider assignment — not exercised by this test ──
  assign(_projectId: string, _providerId: string, _rank: number): void {}
  unassign(_projectId: string, _providerId: string): void {}
  listAssigned(_projectId: string): GlobalAiProvider[] {
    return [];
  }
  maxRank(_projectId: string): number | undefined {
    return undefined;
  }
  shiftRanksFrom(_projectId: string, _rank: number): void {}
  compactRanks(_projectId: string): void {}
  getAssignment(
    _projectId: string,
    _providerId: string,
  ): { rank: number } | undefined {
    return undefined;
  }
  listProjectsAssigning(_providerId: string): string[] {
    return [];
  }
}

class FakeSessionFactory implements ProviderSessionFactory {
  async for(_provider: ResolvedProvider): Promise<ProviderSession> {
    throw new Error(
      "sessions.for() should not be called for logged_out provider",
    );
  }
}

/** A registry that returns a normal active provider for "active-id". */
class NormalFakeRegistry implements AiProviderRegistry {
  get(id: string): GlobalAiProvider | undefined {
    if (id === "active-id") {
      return {
        id: "active-id",
        name: "active-provider",
        provider: "openai-codex",
        model: "gpt-5.6-sol",
        baseUrl: null,
        effort: null,
        value: "sk-test",
        state: "active",
        credentialVersion: 3,
        api: null,
        contextWindow: null,
        maxTokens: null,
      };
    }
    return undefined;
  }
  register(): GlobalAiProvider {
    throw new Error("not used");
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
  updateCredentialCAS(
    _id: string,
    _value: string,
    _expectedVersion: number,
  ): { applied: true; newVersion: number } | { applied: false } {
    return { applied: false };
  }
  assign(_projectId: string, _providerId: string, _rank: number): void {}
  unassign(_projectId: string, _providerId: string): void {}
  listAssigned(_projectId: string): GlobalAiProvider[] {
    return [];
  }
  maxRank(_projectId: string): number | undefined {
    return undefined;
  }
  shiftRanksFrom(_projectId: string, _rank: number): void {}
  compactRanks(_projectId: string): void {}
  getAssignment(
    _projectId: string,
    _providerId: string,
  ): { rank: number } | undefined {
    return undefined;
  }
  listProjectsAssigning(_providerId: string): string[] {
    return [];
  }
}

/** A session factory that records the expectedCredentialVersion arg. */
class CapturingSessionFactory implements ProviderSessionFactory {
  readonly capturedVersions: (number | undefined)[] = [];

  async for(
    _provider: ResolvedProvider,
    _context?: import("./pi-session.ts").SessionContext,
    expectedVersion?: number,
  ): Promise<ProviderSession> {
    this.capturedVersions.push(expectedVersion);
    const asyncIter = async function* () {
      yield { type: "text_delta" as const, delta: "ok" };
      yield {
        type: "done" as const,
        reason: "stop",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      };
    };
    return {
      model: {} as any,
      streamFn: () => asyncIter() as any,
      getApiKey: () => "key",
    } as any;
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

test("(BLOCKER 4) PiProviderProbe passes expectedCredentialVersion to sessions.for()", async () => {
  const sessions = new CapturingSessionFactory();
  const probe = new PiProviderProbe(new NormalFakeRegistry(), sessions);

  await probe.probe("active-id", "test prompt");

  // Current code (pi-provider-probe.ts:53) calls sessions.for() with only 2 args — no credentialVersion.
  // Fix: pass the provider's credentialVersion as 4th arg.
  assert.equal(
    sessions.capturedVersions.length,
    1,
    "sessions.for() must be called once",
  );
  assert.equal(
    sessions.capturedVersions[0],
    3,
    "sessions.for() must receive expectedCredentialVersion (3) matching the provider's credentialVersion",
  );
});

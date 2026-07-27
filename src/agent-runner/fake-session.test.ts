/**
 * Story 04 T2 — FakeSessionFactory driving a real Agent
 *
 * Proves that scripted turns satisfy the real pi Agent loop:
 *   - a scripted tool call is executed with its arguments,
 *   - the final scripted text becomes the last assistant message.
 * No network, no timers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FakeSessionFactory,
  fakeSessionFactoryFromTurns,
} from "./fake-session.ts";
import type { FakeTurnMap } from "./fake-session.ts";
import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { ResolvedProvider } from "./port.ts";

test("FakeSessionFactory drives real Agent: scripted tool call is executed with its arguments and final text is the last assistant message", async () => {
  const capturedArgs: unknown[] = [];

  // Two scripted turns:
  //   turn 0 → agent calls "echo" tool with { message: "hello from agent" }
  //   turn 1 → agent emits final text "task complete"
  const factory = new FakeSessionFactory([
    {
      toolCalls: [{ name: "echo", arguments: { message: "hello from agent" } }],
    },
    { text: "task complete" },
  ]);

  const agent = new Agent({ streamFn: factory.streamFn });

  // Register one recording echo tool
  const echoParams = Type.Object({ message: Type.String() });
  const echoTool: AgentTool<typeof echoParams> = {
    name: "echo",
    label: "Echo",
    description: "Echo a message back",
    parameters: echoParams,
    execute: async (_toolCallId, params) => {
      capturedArgs.push({ ...params });
      return {
        content: [{ type: "text" as const, text: String(params.message) }],
        details: {},
      };
    },
  };
  agent.state.tools = [echoTool];

  await agent.prompt("x");
  await agent.waitForIdle();

  // Scripted tool call was executed with its arguments
  assert.equal(capturedArgs.length, 1, "echo tool called exactly once");
  assert.deepEqual(capturedArgs[0], { message: "hello from agent" });

  // Final text is the last assistant message
  const assistantMessages = agent.state.messages.filter(
    (m): m is Extract<typeof m, { role: "assistant" }> =>
      m.role === "assistant",
  );
  const lastAssistant = assistantMessages[assistantMessages.length - 1];
  assert.ok(lastAssistant, "expected at least one assistant message");

  const textContent = lastAssistant.content.find(
    (c): c is { type: "text"; text: string } => c.type === "text",
  );
  assert.ok(textContent, "expected text content in last assistant message");
  assert.equal(textContent.text, "task complete");
});

// ---------------------------------------------------------------------------
// fakeSessionFactoryFromTurns — per-task turn selection (EPIC 007.14 Story D)
// ---------------------------------------------------------------------------

/** Drive a real Agent with `streamFn` and a recording "mark" tool; return the
 * `region` argument the scripted turn passed to it (or undefined if none). */
async function runMark(streamFn: StreamFn): Promise<string | undefined> {
  let captured: string | undefined;
  const agent = new Agent({ streamFn });
  const params = Type.Object({ region: Type.String() });
  const markTool: AgentTool<typeof params> = {
    name: "mark",
    label: "Mark",
    description: "Record a region",
    parameters: params,
    execute: async (_id, p) => {
      captured = String(p.region);
      return { content: [{ type: "text" as const, text: "" }], details: {} };
    },
  };
  agent.state.tools = [markTool];
  await agent.prompt("x");
  await agent.waitForIdle();
  return captured;
}

const PROVIDER = {} as ResolvedProvider;
const markTurn = (region: string): FakeTurnMap[string] => [
  { toolCalls: [{ name: "mark", arguments: { region } }] },
  { text: "done" },
];

test("fakeSessionFactoryFromTurns keyed map serves each task title its own turns", async () => {
  const factory = fakeSessionFactoryFromTurns({
    "Sibling — top region": markTurn("top"),
    "Sibling — overlap region": markTurn("overlap"),
  });

  const top = await factory.for(PROVIDER, {
    taskTitle: "Sibling — top region",
  });
  const overlap = await factory.for(PROVIDER, {
    taskTitle: "Sibling — overlap region",
  });

  assert.equal(await runMark(top.streamFn), "top");
  assert.equal(await runMark(overlap.streamFn), "overlap");
});

test("fakeSessionFactoryFromTurns keyed map falls back to the '*' default for an unknown title", async () => {
  const factory = fakeSessionFactoryFromTurns({
    "Known task": markTurn("known"),
    "*": markTurn("default"),
  });

  const session = await factory.for(PROVIDER, { taskTitle: "Unlisted task" });
  assert.equal(await runMark(session.streamFn), "default");
});

test("fakeSessionFactoryFromTurns plain array serves the same turns regardless of task title (backward compatible)", async () => {
  const factory = fakeSessionFactoryFromTurns(markTurn("same"));

  const a = await factory.for(PROVIDER, { taskTitle: "Task A" });
  const b = await factory.for(PROVIDER, { taskTitle: "Task B" });
  const none = await factory.for(PROVIDER);

  assert.equal(await runMark(a.streamFn), "same");
  assert.equal(await runMark(b.streamFn), "same");
  assert.equal(await runMark(none.streamFn), "same");
});

// ---------------------------------------------------------------------------
// 008.4 Story 01 — KANTHORD_FAKE_FAIL_PROVIDERS seam
//
// `fakeSessionFactoryFromTurns` accepts an optional `failProviders: string[]`
// that lists provider `name` (or `provider`) values. When the resolved
// provider matches an entry in the list, `.for()` REJECTS with a typed
// provider-level error so the runner classifies the failure as
// `providerError: true` and the failover loop advances to the next provider
// in the chain. The seam is the hermetic replacement for the Proof's
// `KANTHORD_FAKE_FAIL_PROVIDERS` env wiring.
// ---------------------------------------------------------------------------

const PROVIDER_BAD: ResolvedProvider = {
  id: "ai-bad",
  name: "bad",
  provider: "openai-codex",
  model: "gpt-5.6-terra",
  value: "sk-bad",
  credentialVersion: 1,
};
const PROVIDER_GOOD: ResolvedProvider = {
  id: "ai-good",
  name: "good",
  provider: "openai-codex",
  model: "gpt-5.6-sol",
  value: "sk-good",
  credentialVersion: 1,
};

test("(008.4 Story 01) fakeSessionFactoryFromTurns with failProviders: .for() rejects for a listed provider name (typed provider error)", async () => {
  const factory = fakeSessionFactoryFromTurns([{ text: "done" }], {
    failProviders: ["bad"],
  });

  await assert.rejects(
    () => factory.for(PROVIDER_BAD, { taskTitle: "x" }),
    (err: unknown) => {
      // The thrown error must be an Error instance with a non-empty .name —
      // the runner classifies on `err.name`, so a plain string would not be
      // picked up by the CredentialError / UnknownModelError arms and would
      // fall through to the generic 'provider_unavailable' bucket (still a
      // provider error, but the typed path is what the Proof depends on).
      return err instanceof Error && err.name.length > 0;
    },
    "factory.for() must reject with a typed provider error for a provider listed in failProviders",
  );
});

test("(008.4 Story 01) fakeSessionFactoryFromTurns with failProviders: .for() resolves normally for a provider NOT listed", async () => {
  const factory = fakeSessionFactoryFromTurns([{ text: "done" }], {
    failProviders: ["bad"],
  });

  const session = await factory.for(PROVIDER_GOOD, { taskTitle: "x" });
  assert.ok(
    session !== undefined && typeof session.streamFn === "function",
    "factory.for() must resolve to a normal session for a provider NOT in failProviders",
  );
});

test("(008.4 Story 01) fakeSessionFactoryFromTurns with failProviders: matches by `provider` field as well as `name`", async () => {
  // The Proof registers providers whose `name` differs from `provider`
  // (e.g. name="bad", provider="openai-codex"). The seam must accept either
  // identity so a hermetic Proof can list the FAIL providers by their
  // registration name and have the fake raise.
  const factory = fakeSessionFactoryFromTurns([{ text: "done" }], {
    failProviders: ["openai-codex"],
  });

  // Different `name`, same `provider` → still must fail.
  await assert.rejects(
    () => factory.for(PROVIDER_BAD, { taskTitle: "x" }),
    (err: unknown) => err instanceof Error,
    "factory.for() must reject when the provider's `provider` field is listed (not just `name`)",
  );
});

test("(008.4 Story 01) fakeSessionFactoryFromTurns with no failProviders: .for() never rejects on provider identity (backward compat)", async () => {
  // The original signature is `(turns)` only — no opts. The factory must
  // keep working for every provider without an opts argument so callers that
  // never wire KANTHORD_FAKE_FAIL_PROVIDERS (or wire an empty list) keep
  // succeeding.
  const factory = fakeSessionFactoryFromTurns([{ text: "done" }]);

  const a = await factory.for(PROVIDER_BAD, { taskTitle: "x" });
  const b = await factory.for(PROVIDER_GOOD, { taskTitle: "x" });
  assert.ok(
    typeof a.streamFn === "function" && typeof b.streamFn === "function",
    "factory without failProviders must resolve for every provider (backward compat)",
  );
});

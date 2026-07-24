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
import type { AIProvider, Credential } from "../domain/resource.ts";

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

const AI = {} as AIProvider;
const CRED = {} as Credential;
const markTurn = (region: string): FakeTurnMap[string] => [
  { toolCalls: [{ name: "mark", arguments: { region } }] },
  { text: "done" },
];

test("fakeSessionFactoryFromTurns keyed map serves each task title its own turns", async () => {
  const factory = fakeSessionFactoryFromTurns({
    "Sibling — top region": markTurn("top"),
    "Sibling — overlap region": markTurn("overlap"),
  });

  const top = await factory.for(AI, CRED, {
    taskTitle: "Sibling — top region",
  });
  const overlap = await factory.for(AI, CRED, {
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

  const session = await factory.for(AI, CRED, { taskTitle: "Unlisted task" });
  assert.equal(await runMark(session.streamFn), "default");
});

test("fakeSessionFactoryFromTurns plain array serves the same turns regardless of task title (backward compatible)", async () => {
  const factory = fakeSessionFactoryFromTurns(markTurn("same"));

  const a = await factory.for(AI, CRED, { taskTitle: "Task A" });
  const b = await factory.for(AI, CRED, { taskTitle: "Task B" });
  const none = await factory.for(AI, CRED);

  assert.equal(await runMark(a.streamFn), "same");
  assert.equal(await runMark(b.streamFn), "same");
  assert.equal(await runMark(none.streamFn), "same");
});

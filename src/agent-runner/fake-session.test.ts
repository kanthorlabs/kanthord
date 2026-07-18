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
import { FakeSessionFactory } from "./fake-session.ts";
import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

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

# SU3 Pi Session Surface Findings

Date: 2026-07-05

Packages verified:
- `@earendil-works/pi-ai@0.80.3`
- `@earendil-works/pi-agent-core@0.80.3`

## Install And Import

- Added both packages to `dependencies` with exact pinned versions.
- `node --version`: `v24.12.0`.
- Import probe passed:
  `node --input-type=module -e "await import('@earendil-works/pi-agent-core'); await import('@earendil-works/pi-ai'); console.log('ok')"`

## Session Construction

Use `Agent` from `@earendil-works/pi-agent-core`.

Relevant constructor surface:
- `sessionId`: forwards an app/session identifier to provider stream options and exposes it as `agent.sessionId`.
- `initialState.systemPrompt`: injects the system brief.
- `initialState.messages`: injects prior context before a prompt.
- `initialState.model`: selects the active pi-ai model.
- `initialState.tools`: sets the available tool list.
- `streamFn`: allows Core to route through a selected `Models.streamSimple`, proxy stream, or test/faux stream.
- `beforeToolCall`: policy hook before execution.
- `afterToolCall`: result post-processing hook before final tool result events.

No-network probe used `createFauxCore` and confirmed a session retained both:
- system brief: `KAN THORD SYSTEM BRIEF: stay offline.`
- prior context message: `KAN THORD CONTEXT BRIEF: prior plan context.`

## `beforeToolCall` Hook

Signature:

```ts
beforeToolCall?: (
  context: BeforeToolCallContext,
  signal?: AbortSignal,
) => Promise<BeforeToolCallResult | undefined>
```

Observed `BeforeToolCallContext` includes:
- `assistantMessage`: assistant message that requested the tool call.
- `toolCall`: raw tool call block.
- `args`: schema-validated arguments.
- `context`: current `AgentContext` with system prompt, messages, and tools.

Blocking semantics are sufficient for kanthord policy gates:
- Returning `{ block: true, reason: '...' }` prevents `AgentTool.execute` from running.
- The loop emits an error `toolResult` using the supplied reason.
- Probe result: `web_fetch` had validated args `{ url: 'https://example.invalid' }`, was blocked, and the tool execute function was not called.

## Teardown

Available cleanup surface:
- `Agent.abort()` aborts the current active run.
- `Agent.waitForIdle()` waits for run/listener settlement.
- `Agent.reset()` clears transcript/runtime queues.
- `cleanupSessionResources(sessionId?)` and `registerSessionResourceCleanup(...)` from `@earendil-works/pi-ai` provide session-scoped resource cleanup callbacks.

Probe registered one cleanup callback and `cleanupSessionResources('su3-session-probe')` invoked it exactly once.

## Context-Size Signal

Observable context signal is available in `@earendil-works/pi-agent-core` compaction helpers:
- `estimateContextTokens(messages)` returns `{ tokens, usageTokens, trailingTokens, lastUsageIndex }`.
- `calculateContextTokens(usage)` returns total context tokens from provider usage.
- `shouldCompact(contextTokens, contextWindow, settings)` applies the compaction threshold.
- `prepareCompaction(...)` and `compact(...)` are available for session-entry compaction workflows.

Probe result after a faux two-turn session:
- `estimateContextTokens(...).tokens`: `191`.
- `usageTokens`: `191`.
- `lastUsageIndex`: `4`.
- `calculateContextTokens(lastAssistant.usage)`: `191`.

This is sufficient for the Phase 2A compaction threshold seam.

## Cost And Token Usage Signal

Observable usage is present on every `AssistantMessage.usage`:
- `input`
- `output`
- `cacheRead`
- `cacheWrite`
- `reasoning?`
- `totalTokens`
- `cost.{input,output,cacheRead,cacheWrite,total}`

Additional cost helper:
- `calculateCost(model, usage)` computes provider-rate cost components from model metadata.

Probe result:
- Faux assistant usage was present on the final assistant message.
- `calculateCost(...)` with a model cost table returned non-zero input/output/cache components and total.

This is sufficient for budget reconciliation.

## Tool Restriction And Network Denial

Tool list restriction is explicit:
- `initialState.tools` controls the available `AgentTool[]`.
- `agent.state.tools` can be reassigned to replace the active top-level tool array.
- `AgentHarness` also exposes `setTools(...)`, `getActiveTools()`, and `setActiveTools(...)` when using the higher-level harness.

Two denial modes were verified:
- Tool configured but denied by policy: `beforeToolCall` returned `{ block: true }`; result was an error tool result and execute did not run.
- Tool omitted from active list: a faux assistant call to `web_fetch` with `tools: []` produced error text `Tool web_fetch not found`.

For kanthord, use both:
- Do not include network tools in the active tool list for normal Core sessions.
- Keep `beforeToolCall` as a second policy gate for allowlisted tools and dynamic approvals.

## Decision

SU3 passes with no interface correction required.

Required signals are observable:
- hook blocking semantics: yes.
- context-size signal: yes.
- cost/token usage signal: yes.
- tool restriction/network denial: yes.

# Story 001 - Direct Pi Run Control

Epic: `.agent/plan/epics/012-agent-ai-integration.md`

## Goal
Core drives a minimal pi-agent-core/pi-ai run directly, proves fake-provider execution, enforces run controls, routes tool calls through the tool contract, and streams tokens to the transport.

## Acceptance Criteria
- A run exceeding max-iteration cap stops with terminal reason `max_iterations_exceeded`.
- A run exceeding token budget, defined as total input + output tokens, stops with terminal reason `token_budget_exceeded`.
- Each run persists cost state with at least input and output token counts.
- Monetary price is deferred unless pi-ai reports price directly.
- A tool call from pi-agent-core goes through Epic 009 contract.
- Tool call passes `canRun` and produces exactly one `ToolFinished`.
- pi-ai token stream maps to Epic 010 proto stream shape and reaches the client over Epic 011 stream.

## Constraints
- Use `pi-agent-core@0.80.2` and `pi-ai@0.80.2` directly with no Core adapter layer (D3).
- No project-owned `AgentAdapter`, `AIAdapter`, or parallel provider/tool abstraction.
- If no clean hook exists for iteration/token/cost, fork the package instead of wrapping.
- pi packages must be pure JS / no native dependency.
- Scope is minimal integration and run-control primitives only.

## Verification Gate
- `npm run typecheck`
- `npm test`
- Source review confirms no wrapper abstraction.

### Task 012-SPIKE - pi run-control and streaming surface

**Input:** `.agent/plan/findings/12-pi-agent-run-control.md`.

**Action - RED:** none - spike.

**Action - GREEN:** Read pi-agent-core/pi-ai source to confirm how to drive a run, attach points for iteration/token/cost, tool calling surface, streaming API, native-free dependency status, and fork scope if hooks are missing.

**Action - REFACTOR:** none.

**Verify:** Findings file records attach points or fork scope.

### Task 012-RED - Direct pi integration tests

**Input:** `packages/core/src/**/*.test.ts` or the agent package test home.

**Action - RED:** Add fake/mock provider tests for max iteration, token budget, persisted token counts, pi-issued tool call through `canRun`/`ToolFinished`, and token stream to transport shape.

**Action - GREEN:** none - RED only.

**Action - REFACTOR:** none.

**Verify:** `npm test` fails because pi integration is missing.

### Task 012-GREEN - Direct pi integration

**Input:** `package.json`, `package-lock.json`, `packages/core/src/**` or the agent/ai package source home.

**Action - RED:** none - opened by Task `012-RED`.

**Action - GREEN:** Add pi packages and implement the minimal direct integration, run controls, tool routing, and token stream mapping.

**Action - REFACTOR:** Keep run-control code as pi hooks/middleware or package changes, not a parallel adapter abstraction.

**Verify:** `npm run typecheck && npm test` exits 0.

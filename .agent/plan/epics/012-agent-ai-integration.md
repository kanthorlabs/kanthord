# 012 Agent + AI Integration

## Outcome
Directly integrate pi-agent-core and pi-ai with a fake-provider run, tool calls through Epic 009, token streaming through Epic 011, and run-control primitives for iteration cap, token budget, and token cost state.

## Decision Anchors
- D3: pi packages are the adapter; use directly and do not wrap.
- S2: add iteration cap, token budget, and cost on top.
- §3 Agent/AI Runtime.
- S1: agent-loop durability is deferred.

## Stories
- `.agent/plan/stories/012-agent-ai-integration/001-direct-pi-run-control.md` - direct pi integration with fake provider, run controls, tool routing, token stream.

## Verification Gate
- `npm run typecheck` exits 0.
- `npm test` exits 0.
- Source review confirms direct pi imports with no project-owned adapter abstraction.

## Dependencies
- Epic 001.
- Epic 002 for persisted run cost/state.
- Epic 004 for events.
- Epic 009 for tool contract/retry findings.
- Epic 010 for mapped stream shape.
- Epic 011 for token stream.

## Non-Goals
- No durable/resumable full agent loop; next milestone owns that.
- No real provider API call in tests.

## Findings Out
- `.agent/plan/findings/12-pi-agent-run-control.md`

# Feedback — 019.2 must own the real pi `Agent` wiring

Recorded 2026-07-10 during the 019.1 review cycle (Ulrich). Owning epic: 019.2.
Source finding: `.agent/plan/feedback/019.1-pi-tool-model-alignment/allow-deny-interface-alignment.md`.

## The gap

The real pi `Agent` constructor takes structured objects, not strings:

```
new Agent({ initialState: { tools: AgentTool[], ... }, beforeToolCall: ({ toolCall, args, context }) => ... })
```

Today nothing constructs that. `spawnPiSession`/`respawnPiSession` target a
`FakePiSurface` stand-in (`tools: string[]`), and 019.1 explicitly deferred the
real wiring (its Non-Goal: "the real caller does not exist yet"). But 019.2 as
currently authored also does NOT own it:

- it reuses the `spawnPiSession` fake seam (Non-Goal line 123: "no new pi mechanism");
- it only *consumes* the tool manifest 019.1 produces (lines 38, 104);
- its automated gate uses doubles; the real pi path is maintainer-LP-only
  (Non-Goal line 131).

So mapping pi tool names → `AgentTool[]` and adapting the ring-1 chain to pi's
`beforeToolCall({ toolCall, args, context })` signature has **no story, no AC, no
test** in any epic.

## What 019.2 should add (author/debate step folds this in)

A story (or an addition to `002-live-agent-run.md`) that owns the real `Agent`
adapter — the only place `tools: string[]` becomes `AgentTool[]` and the ring-1
hook is bound to pi's real `beforeToolCall`:

1. **Allow** — construct `initialState.tools: AgentTool[]` from
   `PI_DEFAULT_ALLOWED_MANIFEST` (the 6 non-exec pi tools). bash is absent by
   construction.
2. **Deny** — bind `beforeToolCall` to the ring-1 hook, with
   `unknownEffectfulToolNames` sourced from `PI_EXEC_TOOLS` (`{bash}`) so a
   pathless `bash` call is blocked fail-closed. (Proven at the taxonomy layer in
   019.1: `hook-binding.test.ts` bash-deny test.)
3. **Test the adapter boundary** — at least one hermetic test on the
   name→`AgentTool` mapping and the `beforeToolCall` binding, so the real deny path
   is not purely maintainer-verified.

This keeps 019.2's "pure assembly, reuse existing seams" spirit: it does not invent
a new ring-1/pi mechanism — it wires the taxonomy (`PI_DEFAULT_ALLOWED_MANIFEST`,
`PI_EXEC_TOOLS`) 019.1 already produced into the real `Agent` shape. If the real
`Agent` shape differs from the current `FakePiSurface`, record the delta here as a
seam gap when assembling.

## Also decide here

Converge the exec/blocked name copies. After 019.1, exec names live in 3 places:
`PI_EXEC_TOOLS` (pi-tools), `EXEC_SHELL_CLASS_TOOLS`/`NETWORK_CAPABLE_TOOLS`
(network-denial), and caller-supplied `unknownEffectfulToolNames` (hook). 019.1
unified only the pi-session copy. Decide whether the live wiring sources all three
from `PI_EXEC_TOOLS`.

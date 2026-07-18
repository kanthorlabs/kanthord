# Story 01 — Executable pi runtime proof (characterization)

Epic: `.agent/plan/epics/009-agent-security.md`

## Goal

A hermetic `node:test` suite pins pi-agent-core 0.80.3's ACTUAL runtime
behavior at the seams EPIC 009 builds on (R3 S4: "`.d.ts` shows shape, not
runtime ordering"): `beforeToolCall` blocking, hook ordering + validated args,
multi-tool-call turns under both execution modes, per-turn tool replacement,
hook-throw behavior, and `afterToolCall` output overrides. The suite is the
executable evidence for rulings D-B (no-general-bash + backstop hook), D-C
(where an output policy can attach), and EPIC 008 B6 (advisory-gate
semantics) / R3 B8 (parallel-call revocation races).

## Confirmed installed surface (verified 2026-07-17 against `node_modules/@earendil-works/pi-agent-core/dist`)

- `AgentOptions.beforeToolCall?: (context: BeforeToolCallContext, signal?) =>
Promise<BeforeToolCallResult | undefined>` — `BeforeToolCallResult =
{ block?: boolean; reason?: string }`; `block: true` → "the loop emits an
  error tool result instead", `reason` becomes its text (types.d.ts:35-43).
- `BeforeToolCallContext = { assistantMessage; toolCall; args /* validated
against the tool schema */; context }` (types.d.ts:66-76).
- `afterToolCall` → `AfterToolCallResult { content?; details?; isError?;
terminate? }`, field-by-field replacement, no deep merge
  (types.d.ts:44-65).
- `Agent.toolExecution: ToolExecutionMode = "sequential" | "parallel"`
  (types.d.ts:22, agent.d.ts:56).
- `agent.state.tools` assignment copies the top-level array
  (agent.d.ts:70-74); `abort()`, `waitForIdle()`, `subscribe` per agent.d.ts.
- Scripted model: `FakeSessionFactory` / `FakeTurn` from
  `src/agent-runner/fake-session.ts` (landed, EPIC 006 S04-T2);
  `FakeTurn.toolCalls` is an array, so multi-call turns are scriptable.
  Wiring template: `src/agent-runner/fake-session.test.ts`.

## Protocol (characterization)

These tests DOCUMENT behavior; they do not demand it. Expected flow is
immediate GREEN (the `/work` GREEN-ONLY pass-through). When an assertion
contradicts actual behavior, the ACTUAL behavior wins: fix the assertion to
match reality and record the surprise under `## Findings` below — the
surprise IS the deliverable. No kanthord production code; the only permitted
non-test edit is extending `FakeSessionFactory` when a scripted shape is
missing (kanthord-owned test infra; its existing tests stay green).

## Constraints

- Hermetic: `FakeSessionFactory` only — no network, no real provider, no
  timers.
- Test file `src/agent-runner/pi-runtime.test.ts` (adapter layer — may import
  pi and fake-session directly).
- Assert through public transcript/state (`agent.state.messages`,
  tool-execute recordings), never pi internals.

## Verification Gate

- `node --test src/agent-runner/pi-runtime.test.ts` green; `npm run verify`
  stays green.

### Task T1 — block semantics

**Requires:** EPIC 006 S04-T2 (`FakeSessionFactory`, landed).

**Input:** new `src/agent-runner/pi-runtime.test.ts`.

**Action — RED (characterization; expect immediate GREEN):** script one
tool-call turn + one text turn; register one recording echo tool. With
`beforeToolCall` returning `{ block: true, reason: "blocked-by-test" }`
assert: (a) the tool's `execute` is NEVER invoked; (b) the transcript
contains an error tool result whose text contains `blocked-by-test`; (c) the
run continues — the final text turn arrives and `waitForIdle()` resolves, no
throw. Control case: the same setup returning `undefined` → `execute`
invoked exactly once.

**Action — GREEN:** none expected; on divergence, document actual behavior.

**Action — REFACTOR:** none.

**Output:** pinned block/allow behavior (the backstop-gate primitive).

**Verify:** suite green; `npm run typecheck` exit 0.

### Task T2 — ordering, validated args, output override

**Requires:** T1.

**Input:** same file.

**Action — RED (characterization):** shared log array — the hook pushes
`before:<tool>`, the tool's `execute` pushes `exec:<tool>`, `afterToolCall`
pushes `after:<tool>`; assert the exact order. Assert `context.args`
deep-equals the scripted arguments (validated shape). With `afterToolCall`
returning `{ isError: true, content: [{ type: "text", text:
"policy-redacted" }] }` assert the transcript's tool result carries the
override verbatim — the OutputPolicy attach point (D-C evidence).

**Action — GREEN:** none expected. **Action — REFACTOR:** none.

**Output:** pinned hook ordering + override semantics.

**Verify:** suite green.

### Task T3 — multi-call turns under both execution modes

**Requires:** T1.

**Input:** same file (+ `src/agent-runner/fake-session.ts` ONLY if two calls
in one turn cannot be scripted yet — permitted edit, mirror pi-ai faux
shapes, keep its tests green).

**Action — RED (characterization):** script ONE assistant turn carrying TWO
tool calls (`echo-a`, `echo-b`). For each `toolExecution` mode
(`"sequential"`, `"parallel"`): (a) the hook fires once per call (two
`before:` entries); (b) with `echo-a` blocked and `echo-b` allowed, `echo-b`
still executes and the transcript carries both results — one error, one
success. Record any between-mode difference verbatim.

**Action — GREEN:** none expected. **Action — REFACTOR:** none.

**Output:** pinned selective-block + parallel-call behavior (008 B6 / R3 B8
evidence: what a mid-batch revocation can and cannot stop).

**Verify:** suite green.

### Task T4 — per-turn tool replacement + hook throw

**Requires:** T1.

**Input:** same file.

**Action — RED (characterization):** (a) after turn 1, reassign
`agent.state.tools` to a different set; script turn 2 calling a REMOVED tool
→ record the actual behavior (error tool result? run failure?) — this pins
per-turn tool replacement, the mechanism 009's per-task curation uses;
(b) `beforeToolCall` THROWS (instead of returning `block`) → record whether
the loop converts the throw into an error tool result or fails the whole run
(D-B evidence: can the backstop gate ever crash a task?).

**Action — GREEN:** none expected. **Action — REFACTOR:** none.

**Output:** pinned replacement + hook-error behavior.

**Verify:** suite green; `npm run verify` stays green.

## Findings (evidence for the 009 resolution round)

(Appended by the `/work` cycle — one bullet per pinned behavior, named for
the ruling it informs: D-B, D-C, 008 B6, R3 B8. Empty until the story runs.)

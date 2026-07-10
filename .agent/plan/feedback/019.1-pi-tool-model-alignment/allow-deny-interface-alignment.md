# Feedback — 019.1: wire tool allow/deny into the real pi Agent seams

Recorded 2026-07-10 during the 019.1 review cycle, on Ulrich's direction.
Owning epic/story: 019.1 (Stories 002/003); forward-looking finding for 019.2.

## Decision (Ulrich, 2026-07-10) — supersedes part of 019.1's design

pi's real `Agent` interface exposes exactly two tool-policy seams:

- **allow** = `initialState.tools: AgentTool[]` — a tool is usable only if it is in
  this array. `bash` is denied by simply not being included.
- **deny** = `beforeToolCall(...) → { block: true, reason }` — the runtime guard.

There is no "manifest filter" concept in the real interface. The
`PI_BLOCKED_TOOL_NAMES` + `filterToolManifest` step in `pi-session.ts` was a third,
redundant mechanism with no counterpart in pi, containing 18 names that are **not
pi tools** (`sh`, `exec`, `shell`, `spawn`, `curl`, `fetch`, `wget`, `http_*`, …)
and therefore can never appear in a pi manifest. `bash` is pi's only exec built-in;
shell/network effects are reachable only *through* `bash`, so blocking `bash` blocks
them transitively.

### Change applied (B1)

- Delete `PI_BLOCKED_TOOL_NAMES` (the 18 generic names + bash grab-bag) from
  `src/agent/pi-tools.ts`.
- Export `PI_EXEC_TOOLS = new Set(["bash"])` as the single source for the exec/deny
  class (pi's one real exec built-in).
- Remove the `allowedToolNames.filter(!BLOCKED_TOOL_NAMES.has)` step from
  `spawnPiSession`/`respawnPiSession`; pass `allowedToolNames` straight to `tools`.
- Invariant preserved: a session built from `PI_DEFAULT_ALLOWED_MANIFEST` never
  exposes `bash`; the exec deny is expressed at the `beforeToolCall` seam (the ring-1
  hook's `unknownEffectfulToolNames`, sourced from `PI_EXEC_TOOLS`), not a spawn
  manifest filter.

### Plan-intent overrides this creates (documented, not silently changed)

- 019.1 Non-Goal "No removal of the generic network-capable/exec-shell fallback
  sets" is **reversed for the pi-session copy** — the generic set is removed there.
  (The separate `network-denial.ts` generic sets are Epic 015's and are left alone
  by this change; see the finding below.)
- 019.1 Verification Gate item "spawnPiSession/respawnPiSession given a manifest
  containing bash produce a filtered manifest with bash removed" is **superseded**:
  bash-absence is now guaranteed by construction (default manifest) + the
  `beforeToolCall` deny, not by a spawn-layer filter.
- Story 003's "single source of truth via the shared blocked set" AC is satisfied
  differently — there is no blocked set to share; the shared source is now the
  read/write/exec class taxonomy (`PI_EXEC_TOOLS`).

## Finding — real `AgentTool[]` + structured `beforeToolCall` wiring is UNOWNED

Verified against the 019.2 epic + its 4 stories (2026-07-10):

- 019.2 **reuses** `spawnPiSession`/`respawnPiSession` (the `FakePiSurface`,
  `tools: string[]`); Non-Goal line 123 forbids new pi mechanism.
- 019.2 only **consumes** the corrected manifest 019.1 produces (lines 38, 104).
- 019.2 Non-Goal line 131: the real pi path is exercised by maintainer LP runs, not
  the automated gate (doubles only).

So constructing the real `new Agent({ tools: AgentTool[], beforeToolCall })` —
mapping pi tool names → `AgentTool` objects, and adapting the ring-1 chain to pi's
`beforeToolCall({ toolCall, args, context })` signature — has **no owning story, no
AC, and no test**. It is implied to live in `src/cli/run.ts` ("injects real
adapters") but is untested maintainer-only surface.

Also surfaced: the exec/blocked names still exist in **three** places
(`PI_EXEC_TOOLS` now in pi-tools, `EXEC_SHELL_CLASS_TOOLS`/`NETWORK_CAPABLE_TOOLS`
in network-denial, caller-supplied `unknownEffectfulToolNames` in the hook). 019.1's
"single source of truth" only unified the pi-session copy.

**Recommendation:** author a small follow-up (or a 019.2 story addition) that owns
the real `Agent` adapter — the `AgentTool[]` construction from
`PI_DEFAULT_ALLOWED_MANIFEST` and the `beforeToolCall` adapter wiring
`unknownEffectfulToolNames = PI_EXEC_TOOLS` — with at least one test on the adapter
boundary, so the real deny path is not purely maintainer-verified. Decide there
whether to also converge `network-denial.ts`'s exec set onto `PI_EXEC_TOOLS`.

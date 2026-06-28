# 12 Agent + AI Integration (pi-agent-core + pi-ai)

Goal:             A **minimal** direct integration of pi-agent-core + pi-ai (no
                  wrapper) that proves one fake-provider run, routes a tool call
                  through epic 09, streams tokens through epic 11 — plus the three
                  run-control primitives pi lacks (iteration cap, token budget,
                  cost), as concrete contracts. NOT the agent loop (S1 deferred).

Decision anchors: D3 (the pi packages ARE the adapter — use directly, do NOT wrap;
                  fork if missing), S2 (pi does only compaction + transient retry;
                  **we add** iteration cap, token budget, cost), §3 Agent/AI
                  Runtime, S1 (agent-loop durability/resumability DEFERRED to the
                  next milestone).

ACs:
- A run exceeding the **max-iteration cap** (an integer step count) stops at the
  cap with terminal reason **`max_iterations_exceeded`**.
- A run exceeding its **token budget** (budget unit = **total input+output
  tokens**) stops with terminal reason **`token_budget_exceeded`**.
- Each run **persists cost in run state**: at minimum input+output **token counts**
  per run. Monetary price (tokens × a rate table) is **deferred** unless pi-ai
  reports price directly.
- A tool call originating from pi-agent-core goes through the **epic-09 contract**
  (passes `canRun`; exactly one `ToolFinished`; deny → `denied`).
- pi-ai's **token stream** is mapped to the epic-10 proto stream shape and reaches
  the client over the epic-11 server→client stream.

Constraints:
- pi-agent-core@0.80.2 + pi-ai@0.80.2 are used **directly — no Core abstraction
  layer** (D3). **No project-owned `AgentAdapter` / `AIAdapter` / parallel
  provider/tool abstraction** is introduced (this is the auditable no-wrapper line;
  adding cap/budget/cost via pi's own hooks/middleware is allowed, a parallel
  abstraction is not).
- If the spike finds **no clean hook** for iteration/token/cost, the fallback is to
  **fork the package** and add it there (D3) — never to wrap.
- Cap/budget/cost are **added on top** (S2); pi provides only compaction +
  transient retry.
- Tool invocation routes through the **epic-09 contract** (canRun, terminal status,
  retry per the epic-09 spike). **This epic owns** the pi-ai-stream → epic-10
  proto-token mapping.
- pi packages must be **pure JS / no native** (D2); a native dep triggers the
  fork-or-replace decision (B2 deferred).
- **Scope:** minimal integration + the three control primitives only. Agent-loop
  crash recovery / resumability / idempotent replay (S1) is the NEXT milestone.

Spike?:           YES — deepest pinned-dep integration; extends the epic-09/10
                  `pi-agent-core` + `pi-ai` source read (authoring rules 3+4):
                  confirm how to **drive a run**, **whether** clean attach points
                  exist for iteration/token/cost (if not, record the **fork scope**
                  per D3), how **tool calling surfaces**, the **streaming** API
                  shape, and that both packages are native-free.

Verification:     `node:test` / integration with a **fake/mock provider** (no real
                  API): a run stops at the cap with `max_iterations_exceeded`; a run
                  stops at the budget with `token_budget_exceeded`; per-run token
                  counts are persisted in run state; a pi-issued tool call passes
                  `canRun` and emits one `ToolFinished`; tokens stream to the
                  transport. Review note: source imports pi directly with no
                  project-owned adapter abstraction. Spike does NOT close the task;
                  tests do (rule 8).

Dependencies:     01, 02 (persist run cost/state), 04 (events), 09 (tool contract +
                  retry findings), 10 (mapped types + stream shape), 11 (token
                  stream). Uses the epic-09 pi findings.

Findings out:     `.agent/milestone/01-infrastructure/plan/findings/12-pi-agent-run-control.md`
                  — attach points (or fork scope) for iteration/budget/cost + the
                  streaming API. The next (agent-design) milestone builds on it.

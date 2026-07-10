# Feedback — 019.2 live-path enforcement gaps (agentic-system review)

Recorded 2026-07-10 during the agentic-system dimension review (Ulrich +
debate engine). Owning epic: 019.2. Companion to
`real-agent-wiring-owner.md` (which owns the `AgentTool[]`/`beforeToolCall`
adapter); this file adds four more live-path gaps found by tracing what the
current `src/cli/run.ts` + `src/daemon/run-loop.ts` actually deliver to a
real session. All are "assemble existing seams", none invent a mechanism —
they fit 019.2's spirit.

## Gap 1 — tick() neutralizes ring-1 policy

`run-loop.ts` `tick()` passes `allowedToolNames: []` (empty manifest) and an
inline allow-all role registry (`allow: ["**"]`), so role-path policy is a
no-op in the live path; only write-scope is enforced.

Fold in: tick sources the manifest from `PI_DEFAULT_ALLOWED_MANIFEST` and the
role registry from slot/feature config (or an explicit, decision-recorded
MVP default that is not silently allow-all).

AC shape: a live-path session that calls a tool outside the manifest, or
reads a role-denied path, is blocked — proven against the real hook chain,
not a double.

## Gap 2 — outbound secret-scan guard never wired

`diffScanGuard` is an optional param on the git-push verb; neither
`run-loop.ts` nor `cli/run.ts` constructs or passes one. Because it is
optional, fail-closed never engages — the live daemon pushes diffs with no
secret scan, and the §6.2.3 "secret-scan block" operator routine can never
fire.

Fold in: the launcher constructs `makeOutboundScanGuard` from the pattern
registry and threads it into every outbound verb; a missing/unloadable
registry must block submits (fail-closed), not skip scanning.

AC shape: a push containing a registry-matching pattern is blocked with an
escalation item carrying only `patternClass`; with the registry absent, the
submit is blocked with `scan-unavailable`.

## Gap 3 — model + API-key provisioning unowned in code

019.2's automated gate is hermetic by design (no real model call), and the
LP runbook lists the pi/LLM key as a setup item — but no story owns threading
model selection + provider auth into the real `Agent` construction. Without
it, LP1 fails on day one for a boring reason.

Fold in: the real-adapter story (see `real-agent-wiring-owner.md`) also
threads model id + API key (env-sourced, through `safeEnvAllowlist` /
keyring conventions — never logged) into the Agent options.

## Gap 4 — budget accounting is not durable

`runDaemon` tracks spend in an in-memory `Map`; the `budget_ledger` SQLite
table exists but is unused in the live path. A daemon restart resets spend
to zero, so the budget breaker and the §6.3.3 budget-override routine are
not trustworthy for daily use.

Fold in: tick's reserve/settle path reads and writes `budget_ledger`
(idempotent per task), Map becomes at most a cache.

AC shape: breach a budget, restart the daemon, and the task is still halted
— spend survives restart.

## Gap 5 — prompt parity: pi tool guidance is lost

kanthord embeds pi-agent-core and bypasses pi-coding-agent's
`buildSystemPrompt`, so sessions get tool schemas but none of pi's per-tool
usage snippets/guidelines. The 5-block concat in `pi-session.ts`
(task+epic+runbook+STATE+AGENTS.md) keeps the task layer (good) but drops
the tool-guidance layer (accidental loss, degrades output quality).

Fold in: prompt assembly gains a tool-guidance block equivalent to pi's
promptSnippets/guidelines for the allowed manifest. Record AGENTS.md-only
(no CLAUDE.md, no walk-up) as an intentional divergence while at it.

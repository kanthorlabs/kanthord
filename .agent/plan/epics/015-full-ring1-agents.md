# 015 Full Ring 1 for Agents — Path Policy, Real Write-Scope Blocking, Network Denial

## Outcome

The complete ring-1 deterministic policy an agent session runs under, validated
against the **SU3-documented pi hook shape** (live-runtime fidelity is Epic 016's
smoke gate — the phrasing is deliberate; debate finding: the shape is recorded,
not yet live-proven): **path allowlists/denylists per agent role** evaluated on
canonicalized paths, the Phase-1 write-scope check (Epic 007) enforcing on that
hook shape with blocked writes escalated as re-planning signals, and
**no-direct-network enforcement** at the manifest/env boundary. The precise claim
(debate finding — say what ring 1 can guarantee): ring 1 does not expose
network-capable tools or configured credentials through the manifest/env path,
and every classified external-effect route goes to the broker; it does **not**
prevent OS-level egress by an allowlisted executable tool — that residual channel
is named, and exec/shell-class tools are permanently un-allowlistable to shrink
it. This Epic is the policy half of the phases.md security invariant; the
**structural** enforcement (no spawn path without this policy bundle) is Epic
016's spawn API, which takes the bundle as a required constructor input.

## Decision Anchors

- phases.md Phase 2A Deliverable 4 — full ring 1 for agents: path allowlists +
  write-scope `beforeToolCall` blocking + escalation; a hard precondition for the
  real-agent-sessions brick.
- PRD §4 ring 1 — path allowlists/denylists per agent role; write-scope
  enforcement via `beforeToolCall`; **no direct network access for agents** — all
  external I/O goes through the broker; guardrails are model-independent.
- PRD §4 — a blocked out-of-scope write is a re-planning signal.
- Epic 007 — the write-scope check and escalation event shape exist (fake-enforced);
  this Epic binds them to the real hook signature, it does not redesign them.
- Epic 011 SU3 findings — the real `beforeToolCall` signature, its blocking
  semantics, and how a session's tool list is restricted.

## Stories

- `001-role-path-policy.md` — per-role path allowlist/denylist registry evaluated
  in `beforeToolCall` ahead of write-scope; a denied path is blocked + escalated
  regardless of the task's `write_scope`.
- `002-real-hook-write-scope.md` — the Epic 007 write-scope check bound to the
  pi hook shape from SU3: block-and-escalate on the real signature, re-planning
  tag preserved, model-independence re-asserted.
- `003-agent-network-denial.md` — a session's tool manifest is filtered to a
  deterministic allowlist with no network-capable tool; the spawn environment
  carries no credential material; a request for external effect must be a broker
  submission.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites.
- A tool call writing inside `write_scope` but under a role-denied path (e.g. a
  coding-role write to `~/.ssh/`) is blocked and escalated naming the role and
  rule; a role-allowed, in-scope write passes. Deny wins over allow; policy
  evaluation order (role policy → write-scope) is asserted.
- The same calls driven through the **real hook signature** (SU3 shape, scripted
  caller) produce block/pass identically; the blocked-write escalation carries
  the re-planning tag (Epic 007 semantics on the real seam).
- A session tool manifest passed through the filter contains no tool matching the
  network-capable set — which **includes exec/shell-class tools** (debate
  finding: network capability is not encoded in a name; anything that can spawn
  a process can reach the network); the filter is deny-by-default for unknown
  tool names (fail-closed), and an unknown tool is blocked unless a trusted
  registry classifies it pure (debate finding — purity is declared in config,
  not inferred).
- The spawn-environment builder is **allowlist-only**: given a hostile inherited
  env (SU4 credential values plus credential-adjacent names — `SSH_AUTH_SOCK`,
  `AWS_*`, `GITHUB_*`, `NPM_TOKEN`-style patterns), the output contains only the
  explicitly allowlisted variables (debate finding — absence of configured keys
  alone is too narrow).
- Path decisions are made on **canonicalized paths** (symlinks resolved, `..`
  collapsed, absolute; macOS case-insensitivity documented) and multi-path
  operations (rename/copy) check every involved path (debate finding — a policy
  without canonicalization tests green and still bypasses).
- All enforcement paths are pure/deterministic functions of (role, task,
  call) — no model input in any decision (PRD §4). Asserted **statically**: a
  dependency-boundary test proves the ring-1 modules import no model/session
  module (debate finding — the import boundary is the real invariant; the
  two-model run is kept as a smoke check only).

## Dependencies

- **Epic 007** (write-scope check + escalation events). "Bound, not rebuilt"
  means the **externally observable semantics are preserved**; if the real hook
  shape forces internal adaptation (async return, multi-file calls), that is
  allowed with a short decision record (debate finding — don't let the
  preservation rule block a necessary correction).
- **Epic 011 SU3** (pi hook + tool-restriction findings), **SU4** (credential key
  names for the negative assertion).
- **Epic 006** (agent-session seam whose spawn path calls these).

## Non-Goals

- No real pi session spawn — Epic 016 (this Epic proves policy against the hook
  *shape*; 016 plugs live sessions in).
- No ring-2 classifier (Epic 025); no ring-3 approval routing (Epic 017) — the
  escalation events emitted here land in 017's inbox.
- No OS-level sandboxing — ring 1 blocks at the tool-call seam; it does not claim
  process isolation (PRD §7.3's negative guarantee stance).
- Tool-call and wall-clock budget dimensions (PRD §4 lists them) — deferred as an
  **accepted deviation, recorded here** (debate finding — precedent is not
  rationale): phases.md's 2A deliverables name only the secret scan + cost
  breaker for minimal ring 1 and the path/write-scope/escalation set for full
  agent ring 1; the two extra budget dimensions are not on any Phase-2
  deliverable list and move to Phase 3 hardening unless the 2A proof shows they
  are needed sooner.

## Findings Out

- none. The policy registry format and hook-binding contract are documented in the
  stories and asserted by tests; Epic 016 consumes them as its spawn precondition.

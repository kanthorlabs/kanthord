# Story 003 - Agent Network Denial

Epic: `.agent/plan/epics/015-full-ring1-agents.md`

## Goal

An agent session can only affect the outside world through the broker: its tool
manifest is filtered to a deterministic allowlist containing no network-capable
tool, and its spawn environment carries no credential material.

## Acceptance Criteria

- The tool-manifest filter, given a candidate tool list (shape per SU3 findings),
  returns only tools on the configured allowlist; any tool not explicitly
  allowlisted is dropped — deny-by-default (PRD §4 — no direct network access for
  agents; fail-closed posture).
- The allowlist registry (yaml) contains no network-capable tool; a registry
  entry attempting to allow a tool named in the network-capable set — which
  permanently includes exec/shell-class tools (debate finding: a process spawn
  is a network path) — is a load error naming the tool (a config mistake cannot
  quietly re-open the hole).
- An unknown tool is dropped unless the trusted registry classifies it `pure`;
  purity is declared config, never inferred from tool metadata (debate finding —
  the classifier must not trust the classified).
- The dropped-tool set is journaled at spawn (audit trail of what the session
  could not do).
- The spawn-environment builder is allowlist-only: given a hostile inherited env
  containing the SU4 credential values **and** credential-adjacent variables
  (`SSH_AUTH_SOCK`, `AWS_*`, `GITHUB_*`, `NPM_TOKEN`-style patterns), the output
  contains exactly the allowlisted safe variables and nothing else (debate
  finding — prove the allowlist against a hostile baseline, not key absence
  against an empty one).
- The only external-effect path available to the scripted session is a broker
  submission (asserted: the manifest's effectful tools are the broker-submit tool
  plus file tools already gated by Stories 001/002).

## Constraints

- Filtering happens in the session-spawn path Epic 016 will call — exposed as
  part of the `ring1PolicyChain` seam family (Story 001 T2), not buried in pi
  wiring.
- Deterministic, model-independent, no LLM involvement (PRD §4).

## Verification Gate

- `npm test` green for `src/ring1/network-denial.test.ts`.

### Task T1 - Manifest filter + registry guard

**Input:** `src/ring1/network-denial.ts`, `src/ring1/network-denial.test.ts`

**Action - RED:** Write tests: (a) a candidate list with fetch-like AND
exec/shell-class tools filters down to allowlisted-only, dropped set journaled;
(b) unknown tool ⇒ dropped unless registry-classified pure; (c) a registry
allowing a network-capable or exec-class tool name fails to load naming the
tool.

**Action - GREEN:** Implement the filter + registry validation with the
pure-classification lookup.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Credential-free spawn environment

**Input:** `src/ring1/network-denial.ts`, `src/ring1/network-denial.test.ts`

**Action - RED:** Write a test that the spawn-env builder, given a hostile
inherited env (SU4 credential values plus `SSH_AUTH_SOCK`, `AWS_*`, `GITHUB_*`,
`NPM_TOKEN`-style entries), produces an env containing exactly the allowlisted
safe variables — nothing else survives.

**Action - GREEN:** Implement the spawn-env builder with an explicit pass-through
allowlist of safe variables.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

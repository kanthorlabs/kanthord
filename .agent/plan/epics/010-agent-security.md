# EPIC 009 — Agent security (SPLIT into 009.1 + 009.2)

> **This epic was split into two phases on 2026-07-18** (debate-decided). Do not
> author against this file. The three-part security architecture and its rulings
> (D-A … D-H, three debate rounds) are preserved in git history at the pre-split
> commit, and the surviving rulings are carried into the two phase epics'
> `## Decisions` sections.

## The two phases

- **`009.1-agent-run-identity-hardening.md`** — Phase 1. The shared **attempt
  identity** contract (which EPIC 008's durable rows consume) + common-case
  confidentiality/integrity hardening that needs no capability machinery
  (agent-subprocess env allowlist, `SecretRedactor`, `PathPolicy` on the SDK file
  tools, `InstructionLoader` hardening) + the tested **tier-1** enforcement
  statement (role tool policy = tool-set absence + post-step lane diff; tier-1
  keeps the EPIC 006 coding set incl. general bash). Protects the common case
  (`generic@1` + `tdd@1` tier-1). Ships as EPIC 008's prerequisite.

- **`009.2-credentialed-capability-security.md`** — Phase 2. The three-part
  credentialed-capability subsystem: binding-aware resource **lease manager**,
  **scoped tool registry**, **authorization policy** (exposure + atomic call),
  per-tool `OutputPolicy`, **tier-2** deny-by-default profile, high-risk tool
  **subprocess custody host**, the `Capability` domain variant + migration + CLI,
  `blocked_on_resource` status, and the first concrete capability (`company-db`
  SQL tool). Builds on 009.1's opaque `attemptId`.

## Story files

`.agent/plan/stories/009-agent-security/` (authored story 01 = pi-runtime-proof,
index) predates the split. When the phases start: the minimal pi runtime tests
go to 009.1; the full pi proof + all capability/lease/authorization stories go to
009.2. Re-home during phase story-authoring.

# Story 005 - operator docs + Epic 024/026/027 references

Epic: `.agent/plan/epics/019.4-ai-provider-integration.md`

## Goal

An operator can read one page and manage accounts + run against them from the CLI; and
the later epics know these are the **core functions to wire to, not reimplement**.

## Acceptance Criteria

- A `docs/` page documents: the provider kinds (OpenAI OAuth via openai-codex,
  OpenAI-compatible, GitHub Copilot OAuth); **multi-account** management via the CLI
  (add/list/update/remove an account, `kanthord login <kind> --account <label>`); how
  credentials are held (kanthord custody, keyed by account id, not `~/.pi`);
  running a repo/slot against a chosen account and how the **durable per-task binding**
  keeps a task on its account across respawn/restart (and a forward note that *switching*
  a running task between accounts is Epic 043); and the maintainer live-proof procedure
  (login + smoke inside Podman on an isolated credential copy).
- The page states explicitly that **Epic 026 exposes these core operations over the
  control-plane API and Epic 027 wires the dashboard UI — both are wiring only, no
  logic** (the CRUD, login operation, resolver, and switch are owned here).
- The page notes Claude is deferred and links the open decision (pi-ai `anthropic`
  provider vs Claude Agent SDK).
- Epic 024's `004-provider-registry` story carries a reference note pointing at Epic
  019.4 as the runtime account engine the registry names candidates over (added during
  authoring — see Constraints).

## Constraints

- **Docs path named explicitly** so the lane check allows the write (Task Rule 6; per
  [[lane-check-docs-gap]] docs are orchestrator- or docs-scoped, not a production-lane
  SE turn).
- **No plan-file edits in implementation** — the Epic 024 reference note is a
  plan-authoring change made when this epic is authored, not during the TDD build (Task
  Rule 7). This story's implementation touches `docs/` only.

## Verification Gate

- The `docs/` page exists and covers the ACs; a maintainer completes an
  add-account → login → run → switch → remove flow from it using the CLI.
- Epic 024 `004-provider-registry` shows the reference note; the 026/027 wiring-only
  framing appears in the doc (verified by inspection).

### Task T1 - operator provider doc (GREEN-only)

**Input:** `docs/md/ai-providers.md`

**Action - RED:** none - GREEN-only. Documentation has no behavior test; the behavior is
covered by Stories 001-004's suites + the maintainer live proof.

**Action - GREEN:** write `docs/md/ai-providers.md` covering provider kinds, multi-
account CLI management, the login flow + what the operator sees, custody, account
selection per repo/slot, the durable per-task binding (and the Epic 043 forward note for
switching), the 026/027 wiring-only framing, the Claude-deferred note, and the Podman
live-proof procedure.

**Action - REFACTOR:** none.

**Verify:** the page exists and a maintainer confirms the CLI account-management flow
matches it (the `login`/account CLI `--help` agrees with the doc).

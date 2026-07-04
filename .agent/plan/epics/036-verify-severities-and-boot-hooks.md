# 036 `kanthord verify` Severities & Boot Hooks

## Outcome

`kanthord verify` grows the three PRD severity levels — every divergence class
in the projection contract is mapped to **warn / repairable drift / fatal
corruption** — and, only once those severities exist, the daemon gains
**startup and post-crash verify hooks**: warn logs and continues, repairable
drift self-repairs through the existing rebuild path and continues, fatal
corruption halts dispatch into a degraded-but-readable state with an
escalation. A verify-engine failure itself never blocks boot — the hook
degrades to a journaled warning, honoring the PRD's "a verify failure must
never block the daemon from self-repair".

## Decision Anchors

- phases.md Phase 3 Deliverable 2 — "`kanthord verify` grows
  warn/repairable/fatal severity levels, then startup/post-crash verify hooks
  once severities are wired (PRD §6.1)" — the ordering (severities first,
  hooks second) is the PRD's own.
- PRD §6.1 — the three severity levels; ships on-demand first,
  startup/post-crash hooks added only once severities are wired; a verify
  failure must never block self-repair; the projection is a documented,
  versioned contract.
- Epic 018 — the verify engine and operator entrypoint; this Epic extends
  them, never a second differ.
- Epic 003 — the rebuild-from-markdown path is the repair action; no new
  repair mechanism.

## Stories

- `001-severity-classification.md` — the projection contract's divergence
  classes each map to a declared severity (unmapped class ⇒ fatal by
  default, fail-closed); the report groups findings by severity; exit codes:
  0 clean-or-warn-only, 1 repairable present, 2 fatal present; `--strict`
  makes warn exit 1 for CI use.
- `002-boot-hooks-and-self-repair.md` — the boot pipeline runs verify after
  crash-recovery reconciliation: warn ⇒ journal + continue; repairable ⇒
  rebuild the derived rows from markdown (Epic 003 path), journal the repair,
  re-verify, continue; fatal ⇒ dispatch halted, read surfaces + inbox stay
  up, escalation raised with the verify report as evidence; verify-engine
  crash ⇒ journaled warning, boot continues; hook config-disableable
  (default on).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites (temp
  stores — hermetic).
- Every divergence class named in the projection contract has an asserted
  severity mapping; a synthetic unknown class classifies fatal (fail-closed
  asserted).
- Exit codes: a clean store exits 0; an injected repairable drift exits 1; an
  injected corruption exits 2; `--strict` turns a warn-only run into exit 1.
- Boot with injected repairable drift: the daemon self-repairs, journals
  the repair, the post-repair re-verify is clean, and dispatch proceeds — no
  human interaction (asserted end-to-end on the harness restart scenario).
- Boot with injected fatal corruption: the degraded contract holds (no
  dispatch or new submits; reconciliation of in-flight ops continues; reads
  answer; recovery-only inbox actions; degraded `/healthz`), the inbox holds
  an escalation carrying the report; clearing the corruption and rebooting
  restores normal dispatch (debate finding — the degraded state is a defined
  contract, not "gated dispatch" prose).
- Boot with a verify engine forced to throw: the daemon boots and dispatch
  proceeds, with an inbox escalation naming the hook failure (debate finding
  — loud, not a journal line; the verifier must never brick the daemon —
  PRD §6.1 non-blocking rule asserted as a stated design decision).
- A reboot facing an already-attempted divergence fingerprint escalates
  instead of re-repairing (debate finding — no repair-reboot loops).
- The severity additions bump the projection-contract version per its
  versioning rule (Epic 018's contract discipline).

## Dependencies

- **Epic 031** (setup gate).
- **Epic 018** (verify engine + entrypoint — extended), **Epic 003**
  (rebuild path = repair action), **Epic 009** (boot pipeline), **Epic 017**
  (escalation inbox), **Epic 010** (restart scenarios — composed).

## Non-Goals

- No independent second parser for the projection (the PRD logs the shared-
  parser blind spot as accepted; not addressed here).
- No repair of markdown itself — markdown is truth; only derived state is
  rebuilt (PRD §6.1).
- No scheduled/periodic verify — on-demand + boot hooks only.

## Findings Out

- none. Severity mappings live in the versioned projection contract document.

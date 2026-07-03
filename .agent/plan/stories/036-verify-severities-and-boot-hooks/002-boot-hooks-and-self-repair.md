# Story 002 - Boot Hooks & Self-Repair

Epic: `.agent/plan/epics/036-verify-severities-and-boot-hooks.md`

## Goal

The daemon verifies itself at boot and after crash recovery, repairs what is
repairable without a human, halts into a readable degraded state on
corruption, and never lets the verifier itself block a boot.

## Acceptance Criteria

- The boot pipeline runs verify **after** crash-recovery reconciliation
  (ordering asserted — reconcile writes must not be flagged as drift).
- Warn findings: journaled, boot continues, no escalation.
- Repairable findings: the daemon rebuilds the derived rows from markdown
  (Epic 003 path) **into a shadow swapped in atomically** — a crash
  mid-repair leaves the pre-repair state resumable, never a half-rebuilt
  store (debate finding); journals the repair (classes repaired + counts),
  re-runs verify, and continues on a clean re-verify — end-to-end with no
  human interaction (asserted on the harness restart scenario with injected
  drift, including a crash injected mid-repair).
- A repair whose re-verify still reports repairable-or-worse escalates as
  fatal (no repair loops — one repair attempt per boot); the attempt is
  recorded durably keyed by a **divergence fingerprint**, and a reboot facing
  the same fingerprint escalates instead of repairing again (debate finding —
  "once per boot" alone permits an infinite repair-reboot cycle).
- Fatal findings: the daemon enters the **degraded contract** (debate finding
  — "gated dispatch" needs definition): no task dispatch and no new broker
  submits; broker reconciliation of already-in-flight ops continues (it is
  self-repair); read surfaces and inbox stay up; inbox responses limited to
  recovery/admin actions — other control verbs are rejected with a degraded
  error; `/healthz` reports the degraded state; an escalation carries the
  Story 001 report as evidence; clearing the corruption + reboot restores
  normal dispatch (each asserted).
- A verify engine crash during the hook: boot continues **with an inbox
  escalation naming the hook failure** — not a journal line alone (debate
  finding — a broken watchdog must be loud); dispatch still proceeds: the
  verifier must never be the single point of failure that bricks the daemon
  (PRD §6.1; stated design decision), asserted with a thrown engine fault.
- The hook is config-disableable, default on; disabled ⇒ no verify at boot
  and the disablement itself is journaled at every boot (audit trail —
  debate finding); asserted both ways.

## Constraints

- Repair = the Epic 003 rebuild path — no new repair mechanism (Epic 036
  anchor; PRD §6.1).
- The degraded state reuses the Epic 026/017 surfaces (read + inbox stay up)
  — no new server mode; the degraded contract above is a dispatch/verb gate,
  and the last-verify outcome (time, severity summary) is a daemon-ops read
  field like last-ping (debate finding — boot-with-warnings must be
  distinguishable from clean without log-diving).
- Boot ordering per Epic 032 Story 003's recovery sequence, verify appended
  after it (one documented boot order).

## Verification Gate

- `npm test` green for `src/daemon/verify-hook.test.ts`;
  `npm run typecheck` exits 0.

### Task T1 - Hook ordering + warn/repairable paths

**Input:** `src/daemon/verify-hook.ts`, `src/daemon/boot.ts`,
`src/daemon/verify-hook.test.ts`

**Action - RED:** Write tests: (a) verify runs after reconciliation (order
observed via journal sequence); (b) warn ⇒ journal + continue; (c) injected
repairable drift ⇒ rebuild, repair journal, clean re-verify, dispatch
proceeds, zero human interaction; (d) still-dirty re-verify ⇒ fatal
escalation, no second repair attempt; (e) hook disabled ⇒ no verify ran.

**Action - GREEN:** Implement the hook in the boot pipeline with the single
repair attempt.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Fatal degraded state + non-blocking failure

**Input:** `src/daemon/verify-hook.ts`, `src/rpc/read-surfaces.ts`,
`src/rpc/control-verbs.ts`, `src/daemon/verify-hook.test.ts` (debate finding
— the degraded contract touches the RPC surfaces; Input is authoritative)

**Action - RED:** Write tests: (a) injected corruption ⇒ the degraded
contract holds (no dispatch/submits, reconciliation continues, reads answer,
recovery-only inbox actions, degraded `/healthz`, report-carrying
escalation); (b) fix + reboot ⇒ normal dispatch; (c) engine throw ⇒ boot
continues + inbox escalation naming the hook; (d) last-verify state readable
on daemon-ops.

**Action - GREEN:** Implement the degraded-contract gate and the non-blocking
guard around the engine call.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

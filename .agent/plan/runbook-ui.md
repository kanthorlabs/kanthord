# Runbook — UI/UX track (opencode / dashboard)

Status: **execution plan** (authored 2026-07-04, debate-hardened). Sibling:
`runbook-core.md` (Claude / Aelita — the daemon Core). Shared acceptance oracle:
`.agent/plan/e2e/` (phase1/2/3 testsuites).

This runbook says **who builds what, in what order, against which contract, and
how this track feeds the gate**. It is **not** a test spec.

## 0. Rules this runbook obeys

- **The e2e testsuites are the only acceptance oracle.** This runbook references
  gate IDs (G-series, TC-\*, LP-\*) as **responsibility tags** only. It does not
  restate assertions. On conflict, `.agent/plan/e2e/` wins. A missing/ambiguous
  gate requirement is fixed by editing/debating the e2e source, not by expanding
  this runbook (debate finding).
- **Ownership model** (debate finding): **UI owns browser-mediated user
  workflows** against Core's contracts; **Core owns runtime truth + API
  contracts**; **the gate owns integrated behavior.** The `clients/web/src/**` lane is
  the **implementation** boundary, not the ownership boundary.
- **All work runs through the TDD `/work` loop** and lane-lock discipline.
  Locked story files are not edited during implementation; corrections route
  through a decision record.

## 1. Scope of this track

**Everything under `clients/web/src/**` (the PROFILE `web` variant lane).** Concretely:

- **Epic 027** — the web dashboard, Stories 000–007 (Phase 2B).
- **Epic 040 Story 003** `(web)` — portfolio/rubber-stamp views (Phase 3).
- **Epic 034 Story 003** `(web)` — escalation-evidence rendering (Phase 3).

**Mixed epics are split story-by-story on the `(web)` lane tag** (debate finding
— verify the tag in the story file, do not assume): Epic 034/040 Story 003 are
UI; their other stories are Core.

**Not this track:** the daemon, the Connect API (Epic 026), the **generated
Connect-Web client** (§2), and all non-web stories. See `runbook-core.md`.

### What this track does NOT own (debate finding — resolve the lane conflict)

The **generated Connect-Web client** lands under `clients/web/` but is
**bootstrap/toolchain output, not UI implementation.** UI **never hand-edits
it.** Regeneration is a Core toolchain/SU7-bootstrap action + a decision record.
UI consumes it as a fixed dependency.

## 2. The contracts this track depends on

UI does not depend on one seam but on the readiness contracts Core produces
(`runbook-core.md` §2): **C1** API descriptor→client, **C2** golden fixture +
seeded state, **C3** auth/origin, **C4** pre-flight daemon, **C5** milestone
gates. Each UI story is pinned to a **contract-maturity level** (Core §3):

- **L0** SU7 bootstrap client → Story 000.
- **L1** frozen read+control descriptor → Stories 001–006.
- **L2** Epic 029 Story 002 read side → Story 007.
- **L3** Phase-3 read methods (Epic 040 aggregation; Epic 034 classes) →
  Epic 040 S003, Epic 034 S003.

Any mismatch between a pinned interface hypothesis and the delivered contract →
**decision record, re-open the story, never ad-hoc edit** (the Epic 027 posture).

## 3. Timeline — this track starts at Phase 2B (be honest)

There is **no dashboard before Phase 2B**. Phase 1 ships no UI; Phase 2A's human
surface is curl/CLI. So:

| Phase | This track |
|---|---|
| **Phase 1** | **No story implementation.** Readiness prep only (§3.1). No gate obligation. |
| **Phase 2A** | **No story implementation.** Readiness prep only. No gate obligation. |
| **Phase 2B** | **First real work** — Epic 027, gated by SU7 + Epic 026 + Story 000 (§4). |
| **Phase 3** | Epic 040 S003 + Epic 034 S003 (§4). |

### 3.1 Pre-2B readiness prep (debate finding — a runbook must not say "nothing")

Before any story is dispatchable, this track does **contract/readiness
preparation only — no specs, no product implementation**:

- Review the Epic 027 story sequence (000–007) and its dependency notes.
- Confirm the dashboard **workflow inventory** against the Phase-2B/3 gate
  surfaces (§5 matrix).
- Prepare the **locator strategy** expectations (`clients/web/src/locators.ts`).
- Map **each dashboard screen's data needs** to Epic 026 read methods.
- Draft open **contract questions as decision records** (not story edits).
- Prepare the **SU7 + descriptor-freeze handoff checklist**.
- Prepare the **Chrome MCP / live-proof operating procedure** (e2e §6).

## 4. Dispatch order (contract-maturity gated)

**Hard precondition for every story: the SU7 bootstrap gate passes.** Then:

1. **Story 000** app-shell + design foundation — dispatches first (needs SU7 =
   L0; DESIGN.md/shadcn foundation is part of SU7).
2. **Stories 001–006** — need SU7 + frozen Epic 026 descriptor (L1) + Story 000:
   `001` features list/drill-down + authenticated baseline; `002` plan flows
   (sign-off/halt/replan-approve); `003` inbox + responses (**carries the 2A
   approval-flow re-validation E2E**); `004` approval-tier verbs
   (`github.merge`, enforcement-observed E2E); `005` broker+slots views;
   `006` budgets + daemon ops.
3. **Story 007** per-feature summary — additionally needs **Epic 029 Story 002**
   (L2). Epic 027 closes only after all eight stories.
4. **Phase 3:** **Epic 040 S003** (needs Epic 026 + 027 shell + Epic 034
   classes, L3); **Epic 034 S003** evidence rendering (L3).

## 5. Workflow-readiness matrix (first-class axis — debate finding #9)

The dashboard's gate burden is **workflow-shaped**, not only epic-shaped. Track
readiness by workflow as well as by story:

| Workflow | Gate ID(s) | Blocked on |
|---|---|---|
| Auth baseline + **unauth-negative** | Story 001 E2E; **G-AUTH-NEG** | Epic 026 auth (C3) |
| **2A approval flow re-validated in 2B dashboard** | Epic 027 S003 E2E; phase2 §4 | Epic 017 methods via 026 |
| **Dashboard-driven LP-B1…B4** | phase2 LP-B\*; G-VID | full 2B daemon + Chrome MCP |
| Single-origin network / read-only client | **G-NET, G-RO** (client side) | Epic 026 (C1) |
| **TC-H3 web row** (evidence rendering) | phase3 TC-H3 | Epic 034 S002 classes (L3) |
| **TC-H9 web row** (portfolio/rubber-stamp views) | phase3 TC-H9 | Epic 040 S001/S002 (L3) |
| **LP1…LP3 dashboard drive** (real project) | phase3 LP1–3; G-VID | polished daemon (Epics 032–040) |
| Recordings / visual artifacts | **G-VID** | Chrome MCP (fallback: screenshot sequence) |

## 6. Checkpoint responsibility (gate IDs only)

| Gate | UI owns | Gate captain |
|---|---|---|
| **Phase 1** | **NONE** (no UI obligation) | — |
| **Phase 2A** | **NONE** | — |
| **Phase 2B** | G1 `typecheck:web`; G2 `test:web` + `e2e:web`; web surfaces of TC-H-B; **G-AUTH-NEG**; **client side** of G-NET / G-RO; G-VID; **dashboard drive** of LP-B1…LP-B4 | UI lead (for UI portions) |
| **Phase 3** | **web rows** of TC-H3 + TC-H9; `e2e:web`; **dashboard drive** of LP1…LP3; G-VID; carried-forward **client side** of G-AUTH-NEG / G-NET / G-RO on the Phase-3 build | UI lead (for UI portions) |

## 7. Joint convergence — the live proofs (LP-B\*, LP1–4)

The live proofs are **dashboard-driven and belong to both runbooks.** UI is the
**gate-runner lead for the browser side**:

- **UI lead:** drive every human action from the dashboard via Chrome MCP
  (sign-off, escalation responses, approvals incl. `github.merge`, halt/resume,
  portfolio views); produce recordings + per-step screenshots (G-VID); reproduce
  the user flow; keep locators stable.
- **Core lead:** running daemon, seeded repos, ledger/API-log evidence, and the
  **server-side origin/provenance proof** (G-ORIGIN / dashboard-exclusivity) —
  the video shows *what* the UI did; server-side records prove *nothing happened
  off-dashboard* (`runbook-core.md` §6).
- **Failure-triage rule** (debate finding): a browser/live-proof failure is
  **first classified as API / state / client / test-harness** before it is
  assigned to a track — a browser symptom is often a Core cause.

## 8. Coordination protocol (kept identical in both runbooks)

1. **Contract ownership:** Core owns C1–C5; the descriptor is the sole
   generated-code interface. UI consumes the generated client, never edits it.
2. **Freeze + decision-record:** UI pins to the frozen descriptor per maturity
   level (§2); mismatch → decision record, re-open the story, never ad-hoc edit.
3. **Shared test oracle = the golden `tdd@1` fixture;** `e2e:web` runs against a
   pre-flight daemon seeded with it.
4. **Joint sync points:** SU7 bootstrap gate; each descriptor maturity level
   (L0→L3); each live proof.
5. **Serial-debate / lane-lock discipline** unchanged; web stories are
   bootstrap-gated.

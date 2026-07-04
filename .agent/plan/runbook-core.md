# Runbook — Core track (Claude / Aelita)

Status: **execution plan** (authored 2026-07-04, debate-hardened). Sibling:
`runbook-ui.md` (opencode / dashboard track). Shared acceptance oracle:
`.agent/plan/e2e/` (phase1/2/3 testsuites).

This runbook says **who builds what, in what order, against which contract, and
how this track feeds the gate**. It is **not** a test spec.

## 0. Rules this runbook obeys

- **The e2e testsuites are the only acceptance oracle.** This runbook references
  gate IDs (G-series, TC-\*, LP-\*) as **responsibility tags** only. It does not
  restate assertions. On any conflict, `.agent/plan/e2e/` wins. A missing or
  ambiguous gate requirement is fixed by editing/debating the e2e source, **not**
  by expanding this runbook (debate finding — runbooks must not become stale
  duplicate acceptance criteria).
- **Ownership model** (debate finding — the file lane is not the whole model):
  - **Core owns runtime truth + API contracts** — the daemon, the store, the
    scheduler, the broker, the rings, the Connect API, fixture/seed state,
    auth/origin provenance, and every server-side gate artifact.
  - **UI owns browser-mediated user workflows** against those contracts.
  - **The gate owns integrated behavior.**
  - The `clients/web/src/**` vs `src/**` file lane is the **implementation** boundary,
    not the ownership boundary.
- **All work runs through the TDD `/work` loop** and lane-lock discipline
  (`.agent/tdd`). Locked story files are not edited during implementation;
  corrections route through a decision record.

## 1. Scope of this track

**Everything under `src/**` + the toolchain/bootstrap lane.** Concretely:

- Phase 1: Epics **001–010** (all).
- Phase 2A: Epics **011–019** (all).
- Phase 2B: Epics **020–026, 028, 029, 030**.
- Phase 3: Epics **031, 032, 033, 035, 036, 037, 038, 039, 041, 042**.
- **Mixed epics, split story-by-story on the lane tag** (debate finding — verify
  the story's `(web)` tag, do not assume): Epic **034** Stories 001+002 (drift
  mechanics, evidence contract); Epic **040** Stories 001+002 (portfolio
  aggregation, rubber-stamp analysis). Their `(web)` Story 003 belongs to UI.

**Not this track:** Epic 027 (all), Epic 040 Story 003 `(web)`, Epic 034
Story 003 `(web)`. See `runbook-ui.md`.

## 2. Readiness contracts this track produces (debate finding — not one seam)

The UI track does not depend on one seam; it depends on a set of **readiness
contracts** Core is responsible for delivering:

| # | Contract | Core epic/story | Consumed by |
|---|---|---|---|
| C1 | **API descriptor** (SU6) → generated Connect-Web client — the only generated-code interface | Epic 020 SU6/SU7 + Epic 026 | all UI stories |
| C2 | **Fixture/state** — the golden `tdd@1` fixture + pre-flight daemon seeding | Epic 010 fixture; PROFILE pre-flight | `e2e:web`, LP drives |
| C3 | **Auth/origin** — Basic-over-TLS bind + server-side dashboard-origin provenance | Epic 026 Story 003 | G-AUTH, G-ORIGIN |
| C4 | **Pre-flight daemon** — daemon served per SU7/PROFILE arrangement | Epic 020 SU7 | `e2e:web` |
| C5 | **Milestone gates** — SU7 bootstrap; Epic 029 S2 → 027 S7; Epic 034 classes → 040 S3; 2A approval flow re-validated in the 2B dashboard | Epics 020, 029, 034 | UI dispatch order |

### C1 generated-client ownership (debate finding — resolve the lane conflict)

- **Descriptor + code-generation invocation** live in the **toolchain/bootstrap
  lane** (Core side, via the Epic 020 SU7 bootstrap). The **descriptor is
  Core-owned.**
- The **generated Connect-Web client lands under `clients/web/`** but is
  **bootstrap/toolchain output, not UI implementation.** Neither SE lane
  hand-edits it: UI never edits it, Core never hand-edits it under `clients/web/`.
  **Regeneration goes through the SU7 bootstrap/toolchain path + a decision
  record** — never an ad-hoc edit.

## 3. Contract-maturity staging (debate finding — "freeze" is not one milestone)

Core delivers C1 in stages so UI unblocks story-by-story, not all-at-once:

- **L0 — SU7 bootstrap client** (hello-world through the pipeline) → unblocks UI
  Story 000 (shell).
- **L1 — frozen read+control descriptor** → unblocks UI Stories 001–006.
- **L2 — Epic 029 Story 002 read side** (per-feature summary) → unblocks UI
  Story 007.
- **L3 — Phase-3 read methods** (Epic 040 aggregation/annotation; Epic 034
  evidence classes) → unblocks UI Epic 040 S003 and Epic 034 S003.

## 4. Ordered worklist (by phase, dependency order)

### Phase 1 — frame on fakes (100% Core)
`001` foundations → `002` compiler → `003` markdown-store → `004` dag-scheduler
→ `005` broker-skeleton → `006` workflow+agent-session → `007` ring1-policy-seams
→ `008` deploy-chain → `009` daemon-shell+transport → `010` harness-suite.
**Done:** 001, 002. **Then the Phase-1 gate** (§5).

### Phase 2A — real vertical slice (100% Core)
`011` milestone-setup → `012` real-markdown-store → `013` minimal-ring1 →
`014` real-broker-minimal → `015` full-ring1 → `016` real-agent-sessions →
`017` approval-surface (curl/CLI — **not** the dashboard) → `018` verify-basic →
`019` phase2a-proof. **Then the Part-A gate** (§5). Security ordering (G-SEC):
013 before 014; 015 before 016.

### Phase 2B — full breadth (Core side of a JOINT phase)
**Critical path first — front-load the API/bootstrap readiness chain that
unblocks UI** (debate finding — but respect Epic 026's own deps):
1. `020` milestone-setup → **SU7 bootstrap gate** (delivers C1-L0, C4). Front-loaded.
2. `026` control-plane-api → **frozen descriptor** (C1-L1, C3). Depends on
   002/004/012/017/013/018/**029**. Because 026 depends on 029's dead-man status
   read side, and UI Story 007 depends on Epic 029 Story 002, **Epic 029 is on
   the critical path for both** — schedule it early, not last.
3. `029` deadman-ping (Story 002 delivers C1-L2). Pull earlier than its
   deliverable-number order because of (2).
Then the rest, in dependency order: `021` s3-sync, `022` broker-verbs, `023`
fff-search, `024` workflow+model-policy, `025` ring2-classifier, `028`
deploy-observers, `030` phase2b-proof. **Then the Part-B gate** (§5, joint).

### Phase 3 — polish on a real project (Core side of a JOINT phase)
`031` setup-gate (SU1–SU5, incl. first-feature observation) → `032`
broker-reconciliation-depth → `033` replanning-flow → `034` **Stories 001+002**
(drift + evidence contract) → `035` operational-hardening → `036`
verify-severities+boot-hooks → `037` dirty-plan-continuation → `038`
plan-tooling+tuning → `039` property-tests → `040` **Stories 001+002**
(aggregation + rubber-stamp) → `041` usage-driven-additions (**HD1-gated**;
resolve HD1 after LP1/LP3 data exists) → `042` phase3-mvp-proof. **Then the
Phase-3 gate** (§5, joint).

## 5. Checkpoint responsibility (gate IDs only)

| Gate | Core owns | Gate captain |
|---|---|---|
| **Phase 1** | **ALL** — G1–G5, TC-01…TC-11 | Core |
| **Phase 2A** | **ALL** — G1–G3, G-SEC, TC-H-A, LP-A1…LP-A5 | Core |
| **Phase 2B** | TC-H-B non-web scenarios + full deliverable coverage; **server side** of G-AUTH / G-NET / G-RO; wiring manifest (G2 core); daemon+API+broker side and **server-side origin** of LP-B1…LP-B5; PB7 control-point inventory (self-reported descriptor) | Core-coordinated (joint) |
| **Phase 3** | TC-H1, TC-H2, TC-H4–H8, TC-H10 + **core rows** of TC-H3/TC-H9; G-HD1; **server-side** G-ORIGIN; LP1/LP2/LP3 core mechanics + LP4 guideline; supervisor (P8), fixture composition (Epic 042 S001) | Core-coordinated (joint) |

## 6. Joint convergence — the live proofs (LP-B\*, LP1–4)

The live proofs are **dashboard-driven and belong to both runbooks.** Core is
the **gate-runner lead for daemon truth** (debate finding — "joint" must still
name an owner or nobody owns the failure):

- **Core lead:** running daemon at the named cutpoint, seeded sandbox/company
  repos, broker debug hold-point, ledger/journal/API-log evidence, **server-side
  origin/provenance proof** (G-ORIGIN / dashboard-exclusivity), verify exit
  codes, decision records.
- **UI lead:** browser driving via Chrome MCP, recordings (G-VID), web
  assertions, user-flow reproduction (see `runbook-ui.md`).
- **Failure-triage rule** (debate finding — prevents thrash): a live-proof/browser
  failure is **first classified as API / state / client / test-harness** before
  it is assigned to a track. A kanthord-caused failure fails the gate and re-runs
  from LP-B1 / LP1; an external-service fault allows a recorded re-run.

## 7. Coordination protocol (kept identical in both runbooks)

1. **Contract ownership:** Core owns C1–C5 (§2); the descriptor is the sole
   generated-code interface.
2. **Freeze + decision-record:** UI pins to the frozen descriptor at each
   maturity level (§3); any mismatch → decision record
   (`.agent/plan/feedback/027-web-dashboard/toolchain-decision.md`), re-open the
   affected stories, never an ad-hoc edit.
3. **Shared test oracle = the golden `tdd@1` fixture** (C2); UI's `e2e:web` runs
   against a pre-flight daemon seeded with it (C4).
4. **Joint sync points:** SU7 bootstrap gate; each descriptor maturity level
   (L0→L3); each live proof.
5. **Serial-debate / lane-lock discipline** unchanged; web stories are
   bootstrap-gated.

# 020 Phase-2B Milestone Setup (maintainer gate — blocks all 2B TDD epics)

## Outcome

The dependencies, credentials, external accounts, spikes, and codegen that Phase
2B **cannot do through the TDD lane**: S3-compatible storage access + client
choice, the fff dependency and its embedding spike, Jira/Slack credential custody,
the ring-2 classifier model configuration, TLS material + VPN-interface binding
config, the full control-plane Connect schema extension, and the **web-client
toolchain decision** (a human decision this gate surfaces, not buries). After this
Epic, no 2B `src/**` story hits a missing **maintainer-lane** dependency — with
one named exception this gate cannot absorb: Epic 027 remains blocked until the
SU7 decision produces an executable pipeline (debate finding — the absolute
claim was wrong; the gate reduces known maintainer-lane blockers, it does not
guarantee every external surface resolved).

## Why this is a gate, not RED/GREEN tasks

Same rationale as Epics 000/011: `lane-check.sh` denies `package.json`,
lockfile, `scripts/**`, CI config, and generated proto output for every engineer
role; external accounts and credentials are maintainer-owned. Spikes follow the
`.agent/authoring.md` Spike Gate (unknown external API behavior; pinned
dependency's real surface). The Epic 011 **spike safety boundary** applies to
every SU here (scratch-only targets, least-privilege tokens, probe cleanup).

## Setup items

### SU1 — S3-compatible storage access + spike  *(unblocks Epic 021 story 001)*
- **Action (maintainer):** provision a scratch bucket on the chosen S3-compatible
  provider; choose the client path (AWS SDK v3 vs a lighter S3 lib vs signed
  `fetch`); spike: put/get/list/delete under a prefix, conditional put or ETag
  semantics, error shapes for missing object / auth failure / throttling. The
  findings file **is the client decision record** and must state the chosen
  client plus the exact capabilities Epic 021 codes against (conditional put /
  ETag reliability / metadata support for a stored content digest — debate
  finding: ETags are not trustworthy content hashes on S3-compatibles). Record
  findings in `.agent/plan/feedback/021-s3-sync-single-checkout/s3-surface.md`;
  add the chosen dep to `package.json` + lockfile; credentials into the
  Epic 011 SU4 custody config (same invariants: git-ignored, `0600`, no env
  propagation).
- **Verify:** findings file answers each point; the dep imports cleanly; a probe
  round-trips an object on the scratch bucket and cleans up.

### SU2 — fff dependency + embedding spike  *(unblocks Epic 023)*
- **Action (maintainer):** add `fff` (dmtrKovalenko/fff) at a **pinned** version
  (PRD §6.4 — pre-1.0, fast-moving nightlies) and spike the embedding surface the
  daemon needs: start/stop the index on a directory, path + content query,
  frecency behavior, watcher lifecycle, memory footprint, and how a non-git
  directory behaves (kanthord rejects non-git at registration — assumption #5 —
  but the spike records fff's own behavior for the findings). Record in
  `.agent/plan/feedback/023-fff-search/fff-surface.md`.
- **Verify:** the pinned dep imports/binds cleanly **in the runtime Epic 023's
  tests will actually run in** — the Podman dev container by default; if the
  binding only works native-on-Mac, the findings file must formally declare
  native-only development for Epic 023 and Epic 023's gate inherits that
  declaration (debate finding — "works on my Mac" does not unblock a
  container-run pipeline); the findings file answers each point.

### SU3 — Jira + Slack credential custody + API spikes  *(unblocks Epics 022, 029)*
- **Action (maintainer):** provision least-privilege API credentials for Jira
  (scratch project) and Slack (a DM/bot scope able to message the maintainer);
  add to custody config. Spike and record in
  `.agent/plan/feedback/022-remaining-broker-verbs/jira-slack-surface.md`: Jira
  transition + comment endpoints, idempotency signals, error taxonomy
  (retryable / terminal / escalate — the Epic 011 SU2 standard); Slack DM post
  and — because Slack has no server-side idempotency key — the **explicit
  duplicate-suppression strategy** Epic 022 will implement (metadata marker or
  recent-history search; debate finding: "idempotency story" alone was too
  soft); rate-limit shapes for both.
- **Verify:** custody invariants hold (the Epic 011 SU4 checks); the findings
  file answers each point; probes ran against scratch targets and cleaned up.

### SU4 — ring-2 classifier model config  *(unblocks Epic 025; two steps — debate finding: the registry shape is Epic 024's, a later TDD epic)*
- **Action (maintainer), step 1 — now:** provision the classifier provider
  credential into the Epic 011 SU4 custody config.
- **Action (maintainer), step 2 — after Epic 024 Story 004 lands the provider
  registry shape:** add the classifier model entry to **global daemon config**
  (PRD §4/§8 — global config only, never plan-overridable). This ordering is
  explicit so the gate does not circularly depend on a 2B epic's design; Epic
  025 is blocked on step 2, not on this whole gate.
- **Verify:** step 1 — credential present under custody invariants; step 2 —
  config loads and the classifier entry resolves to a registered provider; no
  credential in tracked files.

### SU5 — TLS material + VPN-interface binding config  *(unblocks Epic 026 story 003)*
- **Action (maintainer):** generate/obtain the TLS cert+key for the daemon,
  store under custody rules; record the VPN interface identification approach
  (how the daemon finds the VPN interface address on the host; PRD §9 — bound to
  the VPN interface, never `0.0.0.0`) in
  `.agent/plan/feedback/026-control-plane-api/tls-vpn-binding.md`.
- **Verify:** cert/key load in a TLS-server probe; the findings file answers the
  interface-detection question; nothing sensitive tracked.

### SU6 — full control-plane Connect schema + stubs  *(unblocks Epic 026)*
- **Action (maintainer):** extend the service schema with the 2B control-plane
  surface (feature list/drill-down reads, sign-off, halt, re-planning diff
  approval, broker views, repo-slot views, budget views + override, daemon-ops
  incl. trigger-verify) per Epic 026's method list; regenerate and commit stubs.
  Same interface-hypothesis note as Epic 011 SU6: Epic 026's stories define
  behavior; mismatches are decision-recorded re-gens, and those decision records
  are appended to the 2B section of
  `.agent/plan/feedback/009-daemon-shell-and-transport/connect-surface.md`
  (debate finding — the re-gen protocol now has a named destination; generated
  stubs are inertia, so the hypothesis status must stay visible).
- **Verify:** stubs import cleanly; the descriptor lists exactly the Phase-1 +
  2A + named 2B methods.

### SU7 — web-client toolchain decision  *(HUMAN DECISION — unblocks Epic 027)*
- **Action (maintainer/Ulrich):** decide how the web dashboard is built and
  gated: PROFILE.md defines only the `core` variant and states the Web SPA
  "ships from separate bakes" — so Epic 027 **cannot run through this TDD
  pipeline as configured**. Options: (a) a separate PROFILE/pipeline for the SPA
  repo/dir; (b) extend this PROFILE with a `web` variant; (c) maintainer-built
  SPA outside the TDD loop with Epic 030 validating only behavior. Record the
  decision in `.agent/plan/feedback/027-web-dashboard/toolchain-decision.md`.
- **Verify:** the decision file exists AND the chosen path is **demonstrated
  executable**: a hello-world change flows through the chosen pipeline end to
  end (lane rules, test ownership, and gate mechanics exercised, not merely
  documented — debate finding: a decision note can exist while the pipeline
  remains unusable).

## Verification Gate

- SU1–SU7 Verify checks all pass. Epic 027 is **additionally blocked on the SU7
  human decision**; other 2B epics are setup-unblocked once their SUs pass
  (behavioral ordering stays with each epic's Dependencies — Epic 011 wording).

## Dependencies

- **Epic 019 passed** (the 2A checkpoint is the gate into 2B; phases.md).

## Non-Goals

- No product behavior; not run through `/work`.
- No production-project onboarding (Phase 3 starts the real company project).

## Findings Out

- `.agent/plan/feedback/021-s3-sync-single-checkout/s3-surface.md` (SU1)
- `.agent/plan/feedback/023-fff-search/fff-surface.md` (SU2)
- `.agent/plan/feedback/022-remaining-broker-verbs/jira-slack-surface.md` (SU3)
- `.agent/plan/feedback/026-control-plane-api/tls-vpn-binding.md` (SU5)
- `.agent/plan/feedback/027-web-dashboard/toolchain-decision.md` (SU7)
- 2B section appended to
  `.agent/plan/feedback/009-daemon-shell-and-transport/connect-surface.md`
  (SU6 — schema hypothesis + any re-gen decision records)

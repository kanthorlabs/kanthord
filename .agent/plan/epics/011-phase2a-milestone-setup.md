# 011 Phase-2A Milestone Setup (maintainer gate — blocks all 2A TDD epics)

## Outcome

The toolchain, credentials, and de-risking spikes that Phase 2A **cannot do through
the TDD lane** exist and are verified: the real-dependency installs (pi packages,
GitHub API access path), the git-CLI and GitHub-API spikes, the pi session-surface
spike, credential custody in daemon config, and a provisioned sandbox repository for
the 2A single-repo proof. After this Epic, no `src/**` RED/GREEN story in Epics
012–018 hits a missing dependency or an unresolved external-API surface, and Epic
019's live proof has a real repo to run against. **Setup-unblocked is not
order-unblocked** (debate finding): the behavioral/security ordering between the 2A
epics (013 before 014's external mutation; 015 before 016's live sessions) is owned
by those epics' own Dependencies and stands regardless of this gate.

**Spike safety boundary (applies to every SU below, debate finding):** all spike and
provisioning probes run against **scratch-only** targets (the SU5 sandbox repo or a
throwaway repo), with a **least-privilege token** scoped to that repo only — no
production org access; anything a probe creates externally (branches, PRs) is closed
and deleted as part of the SU's Verify.

## Why this is a gate, not RED/GREEN tasks

Same rationale as Epic 000: `lane-check.sh` denies `package.json`,
`package-lock.json`, `tsconfig*.json`, `scripts/**`, and CI config for every
engineer role. Dependency installs, credential provisioning, and external-account
setup are therefore a **maintainer-executed checklist** (`Setup item → Action →
Verify`), not dispatched through `/work`. The spikes follow `.agent/authoring.md`'s
Spike Gate: unknown external API behavior (GitHub, pi) is de-risked before
production stories code against it.

## Setup items

### SU1 — git CLI execution path + spike  *(unblocks Epic 014 story 001; Epic 016 worktrees)*
- **Action (maintainer):** decide and verify how Core drives git: shell out to the
  `git` CLI via `child_process` (expected default — platform built-in, no dep) vs a
  library. Exercise on a temp repo: `clone`, `fetch`, `branch`, `commit`, `push` to a
  local bare remote, `worktree add`/`remove`, and error surfaces (non-zero exit,
  stderr shape, detecting "nothing to commit"). Also settle the operational contract
  (debate finding): working-directory isolation, env sanitization for the child
  process (no credential-helper surprises), timeout/kill behavior, and path quoting.
  Record findings in
  `.agent/plan/feedback/014-real-broker-minimal-path/git-cli.md` (chosen approach,
  exact invocations, exit-code/stderr contract the adapters code against).
- **Verify:** the findings file exists and answers each point; the probe commands run
  clean on a temp repo inside the dev sandbox.

### SU2 — GitHub API access path + spike  *(unblocks Epic 014 stories 002–003)*
- **Action (maintainer):** choose the client (plain `fetch` against the REST API vs
  `octokit`) and spike against a scratch repo: create a PR, read PR state by number
  **and find a PR by head branch** (the reconcile correlation key), observe
  rate-limit headers and the error shapes for "PR already exists" and auth failure.
  The findings must include a **terminal error taxonomy** precise enough for the
  broker's poll/backoff/timeout/reconcile behavior (debate finding): secondary
  rate limits / abuse detection, draft PRs, closed PRs on the same head, and
  deleted head branches — each classified as retryable / terminal / escalate.
  Record findings in
  `.agent/plan/feedback/014-real-broker-minimal-path/github-api.md` (client choice,
  endpoints, idempotency-by-head-branch behavior, rate-limit/backoff signals).
  Add any chosen dependency to `package.json` + lockfile.
- **Verify:** the findings file exists and answers each point; if a dep was added,
  `node --input-type=module -e "await import('<dep>'); console.log('ok')"` prints
  `ok`.

### SU3 — pi packages + session-surface spike  *(unblocks Epics 015, 016)*
- **Action (maintainer):** add `@earendil-works/pi-agent-core` and
  `@earendil-works/pi-ai` to `package.json` (pinned exact versions — PRD assumption
  #12: pre-1.0, fast-moving) and spike the session surface Epics 015/016 code
  against: spawn a session with an injected system/context brief; the
  `beforeToolCall` hook signature and whether it can **block** a call; teardown;
  the observable **context-size signal** (for the compaction threshold) and the
  observable **cost/token usage signal** (for budget reconciliation); how a tool
  list is restricted (network-tool denial). Record findings in
  `.agent/plan/feedback/016-real-agent-sessions/pi-session-surface.md`.
- **Verify:** both packages import cleanly under Node 24 ESM; the findings file
  answers each listed question (hook blocking semantics, context-size signal, cost
  signal, tool restriction). **Failure path (debate finding):** if any required
  signal is **not** observable, SU3 does not pass with a findings file alone — it
  requires a decision record updating the affected 2A interfaces (Epics 015/016,
  possibly the Phase-1 session seam) **before** those epics proceed (phases.md —
  a correction needs a short decision record; the harness updated and green).

### SU4 — credential custody in daemon config  *(unblocks Epics 013, 014; consumed by 016)*
- **Action (maintainer):** define the daemon-config credential entries (GitHub
  token, model-provider API key) as local, git-ignored config loaded only by the
  daemon process — **central credential custody**: agents never see them (PRD §5).
  Verify the config path is git-ignored and readable by the daemon config loader.
- **Verify:** a probe loads the config and confirms both credentials present;
  `git check-ignore` confirms the config path is ignored; no credential string
  appears in any tracked file; the config file is mode `0600` and owned by the
  daemon user; a probe subprocess spawned without explicit env pass-through sees
  none of the credential values; the daemon config loader's log output contains no
  credential value (debate finding — custody has verifiable setup invariants
  beyond git-ignore).

### SU5 — sandbox repository for the 2A proof  *(unblocks Epic 019)*
- **Action (maintainer):** create/designate a real sandbox GitHub repository
  (throwaway, no production code), register it as a kanthord repo slot
  (`worktree` strategy), and confirm the SU4 token can push branches and open PRs
  on it. Specify the proof-run posture (debate finding — a repo is a target, not
  proof readiness): branch-protection settings, **merge stays with the human
  account** (the daemon token must not be able to merge — merge is an
  approval-tier verb the 2A proof exercises by hand), and the cleanup policy for
  proof branches/PRs.
- **Verify:** the repo-slot yaml exists and registration succeeds; a manual
  branch-push + PR-open + PR-close cycle with the SU4 token works; a merge
  attempt with the daemon token is rejected; the posture (protection, merge
  rights, cleanup) is recorded in the Epic 019 proof-run file's preamble.

### SU6 — Connect schema extension: 2A control methods  *(unblocks Epic 017 stories 001–002)*
- **Action (maintainer):** extend the Epic 000 SU3 service schema with the 2A
  control surface — list escalations/approvals, respond-to-escalation,
  respond-to-approval (and nothing broader; the full control-plane API is Phase
  2B) — regenerate and commit the stubs. Record the method list in the SU4-era
  findings file `.agent/plan/feedback/009-daemon-shell-and-transport/connect-surface.md`
  (append a 2A section).
- **Verify:** the generated stubs import cleanly; the descriptor lists exactly the
  Phase-1 read methods plus the named 2A control methods, nothing else.
- **Note (debate finding):** the method list is an **interface hypothesis**, not
  frozen law — Epic 017's stories define the behavior; if they surface a mismatch,
  the correction is a decision record + schema re-gen (another SU6 pass), per the
  phases.md seam-correction rule. SU6 exists because codegen is lane-forbidden,
  not because the API design is settled here.

## Verification Gate

- SU1–SU6 Verify checks all pass. Until then, Epics 012–018's affected stories are
  **blocked** (their first RED test would fail on module resolution or code against
  a guessed external surface), and Epic 019 has no proof target.

## Dependencies

- **Phase-1 gate passed** (Epic 010 green) — Phase 2A starts only after the Phase-1
  harness suite is the regression net (phases.md Phase 2 Requirements).

## Non-Goals

- No product behavior — installs, credentials, spikes, and provisioning only.
- Not run through `/work` — maintainer checklist (lane rationale above).
- No 2B dependencies (S3 client, fff, Jira/Slack credentials, TLS material, web
  toolchain) — those are Epic 020, so 2A is not blocked on breadth it does not use.

## Findings Out

- `.agent/plan/feedback/014-real-broker-minimal-path/git-cli.md` (SU1)
- `.agent/plan/feedback/014-real-broker-minimal-path/github-api.md` (SU2)
- `.agent/plan/feedback/016-real-agent-sessions/pi-session-surface.md` (SU3)
- 2A section appended to
  `.agent/plan/feedback/009-daemon-shell-and-transport/connect-surface.md` (SU6 —
  debate finding: it was produced but unlisted)
- decision records for any SU3 signal-unavailability corrections (path recorded in
  the record itself; see SU3 failure path)

# EPIC 012 — Inert import, explicit activation & candidate-guarded verdicts

> Split out of a rejected single-epic draft (debate 2026-07-27). Both halves are
> the same class of bug: the CLI is safe because a human runs one command at a
> time against ids they just read, and a programmatic client is not.
>
> Sibling: `011-client-discovery-surface.md`. Lease-fenced run recovery
> (`abandon task`) is deliberately NOT here — see Non-goals.

## Goal

Importing a graph no longer starts work as a side effect, and a verdict can no
longer be applied to a candidate the client never saw. After this epic:
`create initiative --paused` and `import graph --create --paused` produce an
initiative that a full `run daemon --until-idle` pass moves **not at all** (no
status change, no execution event, no provisioned workspace); `resume
initiative` is the single explicit start gate; `get initiative --json` reports
`paused` as a field distinct from `status`; `get objective --json` exposes
`commitOid` so a client can read the candidate id it is reviewing; and
`approve objective` / `reject objective` **require** `--expected-commit`,
compared inside the same transaction as the write and **before any git
mutation**, so a stale verdict is refused with no state change.

## Verification Gate

Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).
Hermetic coverage required beyond the Proof:

- `paused` is part of the initiative row `INSERT` (see Decisions), so there is no
  window in which an unpaused initiative is visible to `enqueueReadyTasks`. A
  test asserts `newInitiative({paused:true})` → the row is paused on first read,
  with no second write.
- `paused` stays orthogonal to `InitiativeStatus`: a paused initiative's status
  is still `building`, and no transition reads or writes `paused`.
- The verdict guard is compared **inside** the `UnitOfWork.transaction` that
  writes the transition. The test drives the interleaving through a store double
  whose read of the objective returns the reviewed `commitOid`, then mutates the
  persisted row before the transaction body runs; the verdict must be refused.
- Ordering: the guard is checked **before** the objective broker touches any git
  ref. A test with a failing-if-called landing double asserts a stale verdict
  never reaches it — SQLite cannot roll back a moved ref.
- The guard is REQUIRED: omitting `--expected-commit` is a usage error, and the
  use-case input type makes it non-optional (not `string | undefined`).
- Both verdicts are covered in both directions: stale approve, stale reject,
  matching approve, matching reject.

Proof: `scripts/e2e/activation-verdict-proof.sh` — deterministic, no model, no
network, driven through the real CLI with the `KANTHORD_FAKE_AGENT` seam and a
30s bounded daemon pass. Run from the repo root:

```bash
scripts/e2e/activation-verdict-proof.sh
```

It must print `012 ok: …`. Phases: **A** `create initiative --paused` reports
`paused:true` with `status:"building"` · **B** an imported paused graph is inert
under a full daemon pass — every task still `pending`, the global event count
unchanged, no `task.started`/`agent.started`/`task.ready`/`objective.building`
event, no workspace provisioned · **C** `resume initiative` releases it and the
same daemon pass then does work · **D** a stale `--expected-commit` on
`approve objective` exits non-zero, leaves the objective
`awaiting_confirmation`, and leaves the initiative branch ref unmoved; a stale
`reject objective` is likewise refused; **omitting** the flag is refused; the
matching id integrates.

Scope honesty, stated in the script: a sequential CLI proof shows **refusal and
no state change**. That the comparison happens inside the write transaction is
proven hermetically in `npm run verify` — a CLI cannot interleave two writers.

Confirmed RED against the current tree (2026-07-27). Because `set -e` stops at
the first failure, each gap was ALSO probed independently: `create initiative
--paused` / `import graph --paused` → `unknown option '--paused'`;
`approve objective --expected-commit` and `reject objective --expected-commit` →
`unknown option '--expected-commit'`. Verified by inspection: `get initiative
--json` currently emits `{id,name,status,branch,after,waiting}` with no
`paused`, and `get objective --json` emits `{id,name,status,integrations,after,
waiting}` with no `commitOid`.

## Stories

1. **`paused` becomes part of initiative creation.** `newInitiative` takes a
   required `paused` flag (defaulting is done by callers, not by the domain — an
   optional field here is what allows the two-write window). The initiative row
   is inserted with its paused state in a single write, so no transaction
   straddling `save` + `setPaused` is needed on any creation path.
   `CreateInitiative` and `CreateGraph` each pass it through; `CreateGraph` does
   NOT call `CreateInitiative` (no use-case-calls-use-case).

2. **`--paused` on `create initiative` and `import graph --create`.** CLI
   plumbing for story 1, plus `paused` added to the `get initiative --json` view
   as a field separate from `status`.

3. **`commitOid` on the objective read view.** `get objective --json` exposes
   `commitOid` (and `parentOid`, already on the `Objective` domain type) so a
   client can read the candidate id it must echo back. Without this the guard in
   story 4 is unusable from any client.

4. **Required `--expected-commit` on objective verdicts.** `ApproveObjective`,
   `RejectObjective`, and `RetryObjective` take a required expected commit. The
   comparison runs inside the same `UnitOfWork.transaction` as the transition
   write and before any git mutation; a mismatch raises a typed stale error
   mapped to a non-zero CLI exit with a message matching `/stale|expected|moved/i`.
   `RetryObjective` is in scope because `reject objective --resolution retry`
   routes to it (`src/apps/cli/commands/reject/objective.ts:28`), and its
   `execute` currently falls off the end silently for an
   `awaiting_confirmation` objective (`src/app/objective/retry-objective.ts`) —
   the Proof requires that route to exit non-zero on a stale id.

5. **Update every existing caller in the same slice.** Making the flag required
   intentionally breaks all current objective-verdict callers. Enumerate and fix
   them together with story 4 — the e2e scripts under `scripts/e2e/` must read
   `commitOid` from the real read surface (story 3) and echo it back, never
   hard-code it and never bypass the guard. A caller that bypasses the guard is
   the one way this change could hide a regression.

## Decisions

- **`paused` is set in the creation INSERT, not by a follow-up `setPaused`**
  (debate 2026-07-27). `CreateInitiative` currently only opens a transaction on
  its sequencing branch, so a `save` + `setPaused` pair would leave a real window
  where `enqueueReadyTasks` can see an unpaused initiative. One write has no
  window by construction.
- **`resume initiative` is the start gate; no new `activate` command** (debate
  2026-07-27). The domain has no "never started" state — both names would clear
  the same boolean, so `activate` would be a pure alias, and two code paths for
  one transition is worse than one name the dashboard can label "Activate" in
  its own UI. `OPEN:` if a real "never started" state is ever needed (e.g. an
  `activatedAt` for onboarding telemetry), that is a domain change with its own
  event type and migration — not an alias.
- **The guard is required, not optional** (AGENTS.md: never weaken a
  spec-required field to optional). An optional guard leaves the unguarded race
  reachable, which is the same as not shipping it.
- **Objective verdicts only, this epic.** `approve task` / `reject task` need a
  candidate identifier whose meaning is not yet settled — `OPEN:` is
  `--expected-proposal` the `task_results.proposal_commit`, and is it stable
  across retries? Since 007.12 the workspace-bound task path completes directly
  and the human gate is the objective, so the task-level guard is not on the
  dashboard's critical path. It gets its own slice once the identifier is
  defined.

## Non-goals

- **No `abandon task`, no run fence.** A hung run needs a lease identity
  threaded through completion / failure / result / event writes, plus an answer
  for the abandoned process still mutating the shared initiative clone. That is
  a concurrency epic, not a CLI flag, and it is blocked on a design decision.
- **No cancel of a live agent process.**
- **No HTTP API, no diff query, no decision-inbox query.**
- **No change to any lifecycle status set.** `InitiativeStatus` stays
  `building|landed|discarded`; `paused` remains a separate axis.

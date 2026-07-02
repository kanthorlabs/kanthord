# 018 `kanthord verify` (basic) — Shadow Rebuild, Diff, Report

## Outcome

The operator drift detector, in its basic 2A form: an on-demand command that
rebuilds a shadow SQLite from the markdown store (Epic 003 rebuild path + the
Epic 005 ledger projection), diffs the **markdown-derived projection** against
the live database per the versioned contract, and reports each divergence with
file, field, and both values. **Read-only means (debate finding — defined, not
implied): no mutation of the live database, the markdown store, or any daemon
state; the shadow rebuild writes only to an ephemeral temp target the command
creates and deletes.** Exit-code contract, stated up front because Epic 019 and
the 2B dashboard consume it: **0 clean / 1 divergent / 2 contract-version
mismatch**. No severity levels, no startup hooks — those are Phase 3.
**Consistency caveat (debate finding):** verify does not claim a consistent
logical snapshot against a daemon actively writing — SQLite and markdown are
updated in separate steps, so a mid-flight run can report transient divergence;
the documented operator guidance is to run it quiescent or re-run on divergence,
and Phase 3's severity levels will classify transients.

## Decision Anchors

- phases.md Phase 2A Deliverable 7 — basic `kanthord verify`: rebuild shadow
  SQLite from markdown, diff the markdown-derived projection, report divergences;
  severity levels and startup hooks come later.
- PRD §6.1 — `kanthord verify --from-markdown --read-only`: shadow rebuild, diff
  ignoring runtime-only fields, per the documented versioned projection contract;
  ships on-demand first; a verify failure must never block the daemon.
- Epic 003 — the projection contract + `rebuildFromMarkdown`; Epic 005 Story 006 —
  the ledger projection under the bumped contract version. Verify **composes**
  them; it does not re-specify what "markdown-derived" means.

## Stories

- `001-verify-engine.md` — rebuild shadow, diff live vs shadow per the contract
  version, produce a typed divergence report (file/entity, field, live value,
  shadow value); clean run yields an empty report.
- `002-verify-entrypoint.md` — the operator entrypoint (`node src/cli/verify.ts
  --from-markdown --read-only`): runs the engine against a store root + live DB,
  prints the report, exits 0 on clean / non-zero on divergence; provably writes
  nothing.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites.
- On a golden compiled feature with an untouched live DB, verify reports zero
  divergences and exits 0.
- A hand-mutated **markdown-derived** live field (a node status flipped directly
  in SQLite) is reported with entity, field, live value, and shadow value; exit
  code non-zero.
- A mutated **runtime-only** field (a lease row) is NOT reported (contract
  exclusion — Epic 003's negative case re-asserted through the full command).
- A ledger row divergence is reported (the Epic 005 Story 006 projection is
  inside verify's scope — contract version match asserted).
- A contract-version mismatch between engine and store data is a distinct typed
  failure (exit 2), not a silent wrong diff — and the diff itself is asserted to
  enumerate **exactly the contract's field list** (a coverage check comparing
  diff-enumerated fields against the contract enumeration, so a stale field list
  under an unchanged version is caught; debate finding).
- Read-only proof: the command opens the live DB read-only, mutates neither
  store (a write-counting seam on both records zero writes), takes no writer
  lock (Epic 012) — verify runs while the daemon holds it — and its only writes
  go to the ephemeral shadow target it creates and deletes.

## Dependencies

- **Epic 003** (rebuild + contract), **Epic 005 Story 006** (ledger projection),
  **Epic 012** (real store root + read-only open path), **Epic 001** (SQLite
  seam).

## Non-Goals

- No warn/repairable/fatal severity levels; no startup/post-crash hooks; no
  repair actions — Phase 3 (PRD §6.1; phases.md Phase 3 Deliverable 2).
- No independent second parser — the rebuild reuses the writer's parser; the
  shared-bug blind spot stays logged (PRD §6.1), not fixed here.
- No remote/S3 verification — verify reads the local store root (S3 is Epic 021,
  replication only).
- No `kanthord` **binary packaging** — the PRD's `kanthord verify` operator name
  maps to the documented `node src/cli/verify.ts` invocation in 2A because a
  `package.json` `bin` entry is lane-forbidden; the bin alias is a deferred
  maintainer packaging item (debate finding — the naming gap is deliberate and
  recorded, not an oversight).

## Findings Out

- none. Epic 019 (2A proof) and Epic 026 (dashboard "trigger verify") consume the
  engine seam and exit-code contract documented in the stories.

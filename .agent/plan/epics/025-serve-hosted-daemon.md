# EPIC 025 — serve-hosted daemon and run control

> Authored 2026-07-30, on top of EPIC 021 (commits `8d7684a`, `3db820d`) and the
> planning branch `feature/epic-022-025` (merged 2026-07-30).
>
> **This epic replaces a rejected draft.** `retirement.md` plans this slot as
> "Target 025 — the async job API": `POST /api/job` → `202` + a job resource,
> `GET /api/job/:id` for progress. Three adversarial debate rounds killed that
> design. The finding was simple: `resume initiative` already IS "start the
> graph" (`import graph --create --paused` prints _"nothing runs until
> `resume initiative`"_), and `EnqueueReadyTasks` already skips paused
> initiatives. A daemon is a switch, not a job. Modelling it as a job resource
> dragged in a `202` widening, a new `http_jobs` table, a supervisor, a
> `stopping` lifecycle and an ownership epoch — none of which buy the user
> anything. All of that is dropped. See Decision 1.
>
> **The roadmap slot.** The order is **024 ai-provider writes → 025 (this epic)
> → 026 the UI** (Ulrich, 2026-07-30). 024 precedes this
> epic for a code-grounded reason: an empty resolved provider chain fails every
> task without attempting it (`src/app/task/run-next-task.ts:289-295`,
> `no_provider_available`), and `ai_provider` is a blocking config check
> (`src/app/project/project-readiness.ts:45-50`). Provider setup must exist
> before a daemon is driven over HTTP.
>
> Superseded states, recorded so none is reintroduced: `retirement.md` once had
> 024/025 as frontend/provider-writes (swapped — the 024 epic file was right);
> this epic briefly sat at 026; and the roadmap once carried a "Target 027 —
> delivery". Final: provider writes 024, **this epic 025**, the UI 026. 027 is
> cut and `land repository` / `publish repository` are unassigned.
> `retirement.md`, `.agent/plan/epics/022-event-feed.md` and
> `.agent/plan/epics/024-ai-provider-writes.md` are corrected to match.
>
> **025 does NOT change 023's scope.** An earlier draft moved
> `pause initiative` / `resume initiative` into this epic by extending
> `initiative.patch`. EPIC 023 landed first with a different, reviewed answer —
> `PUT | DELETE /api/initiative/:id/suspension` — so that move is reversed and
> 023 keeps all nine of its leaves. See Decision 5.
>
> **025 delivers no UI, and retires no CLI leaf.** The UI is Target 026 and lands
> **after** this epic, so when 025 ships no screen calls its rows. The retirement
> rule is _"a leaf is removed only when its HTTP route(s) exist, are proved by
> their epic's Proof, and the UI uses them"_, and 025 satisfies two of three.
> Beyond that, **the retirement plan is on hold**: Ulrich revisits it after the UI
> and integration are done (`retirement.md`, 2026-07-30). So 025 records that
> `db status` has a route, and removes nothing. The title says "run control", not "execution surface", so the scope is
> not overstated.

## Goal

`kanthord serve` becomes the whole running program: it serves the API **and**
runs the execution loop, so work no longer needs a second terminal running
`kanthord run daemon`. An initiative's `paused` flag is the run control and EPIC
023 already exposes it over HTTP (`PUT | DELETE /api/initiative/:id/suspension`);
025 is what makes a server actually obey it — resume starts work, pause stops new
work from being enqueued. Exactly one daemon runs
per database, enforced by an atomic lease rather than a heartbeat guess, and a
daemon that dies or fails releases that lease immediately instead of blocking its
replacement. `db status` joins the read surface so a client can ask "is this
database usable" before any project exists. No new table, no new HTTP status
code, no migration, and one new route.

## Decisions (binding; do not re-open at build time)

1. **No job API.** Dropped from the rejected draft and not to be revived in this
   epic: `POST|GET /api/job`, `GET /api/job/:id`, `POST /api/job/:id/shutdown`,
   the `http_jobs` table, widening `RouteMeta.successStatus` to include `202`,
   the `location`-iff-`201`-or-`202` dispatcher branch, a persisted
   `running/stopping/stopped/interrupted` job lifecycle, `ownerId`/`ownerEpoch`
   restart reconciliation, and `job.started` / `job.finished` event types.

2. **`serve` runs the daemon BY DEFAULT; `--no-daemon` opts out.** An earlier
   draft defaulted it off to protect three existing fixture proofs. That is a
   test argument driving a product decision, and it is rejected: a `serve` that
   exposes pause/resume controls which cannot execute anything is incoherent.
   `scripts/e2e/http-serve-proof.sh`, `http-reads-proof.sh` and
   `http-writes-proof.sh` each gain `--no-daemon` on their one `serve` line, in
   the same story that flips the default, so no intermediate commit breaks
   `npm run verify`.

   The host reuses the bracket `src/apps/cli/daemon.ts` already proves: start the
   heartbeat **inside** the `try`, stop it in the `finally`, wire the signal to
   `daemon.stop()`.

3. **Single-daemon ownership is an ATOMIC lease.** A preflight "is a heartbeat
   fresh?" read followed by a start is **not** mutual exclusion — two processes
   can both read "stale" and both start. `daemon_heartbeats` cannot serve as the
   authority either; migration 29's own comment says it is _"observation only —
   no lease"_, and it deliberately tolerates a `multiple` reading.

   The lease is a single row claimed with
   `UPDATE … WHERE (unowned OR expired) RETURNING` — the same atomic claim
   AGENTS.md already prescribes for the job queue — renewed by the heartbeat and
   **released on shutdown**. The claim lives in the daemon startup path shared by
   `serve` **and** `run daemon`, or a terminal daemon still races. `repo_locks`
   is NOT reused: it is keyed `(repo_id, branch)` for a different concern.

4. **A failing daemon releases the lease and stays observable.** If
   `RunDaemon.execute()` rejects while HTTP is live, the host logs the error,
   releases the lease, stops the heartbeat, and keeps serving reads. Releasing is
   load-bearing: expiry-only would block any replacement for a full staleness
   window while nothing is running. Readiness then reports `daemon: stopped`, so
   "resumed but nothing can run it" is visible through the check that already
   exists (`CHECK_ORDER` includes `daemon`, `DAEMON_STATUSES` is
   `running | stopped | multiple`).

5. **Run control belongs to EPIC 023, not here.** 023 ships
   `PUT | DELETE /api/initiative/:id/suspension` (both `204`, `paused` stays
   readable on `GET /api/initiative/:id`) and claims `pause initiative` /
   `resume initiative`. Its decision 2 explicitly supersedes this file's earlier
   plan to extend `initiative.patch` with a `paused` field, on the ground that
   _"that row is 021's rename row, and one row cannot serve rename and pause
   without logic inside `run`"_ — approved by Ulrich after an adversarial review
   and gated by a one-entry `PUT_ROWS` allowlist.

   That directive is binding and 023 runs first, so **025 adds no run-control
   route and no `UpdateInitiative` use case.** Three things are dropped from
   earlier drafts of this epic: extending `initiative.patch`, the
   `UpdateInitiative` unit-of-work, and the PATCH body-semantics table. 025's
   Proof drives 023's suspension rows instead.

   What remains true and load-bearing: `EnqueueReadyTasks` consults `paused`, so
   whoever flips it, the daemon obeys at enqueue time (Decision 9). 023 supplies
   the switch; 025 is what makes something listen to it.

6. **`GET /api/database` is the only new row.** `200` + `ETag`, body
   `{ schemaVersion, expectedSchemaVersion, pendingMigrations }`, claiming the
   `db status` leaf.

   **Correction, twice revised.** `DbStatus` (`src/app/db/get-db-status.ts:4-9`)
   has only `{ dbPath, schemaVersion, journalMode, tables }`, so the first wording
   (`expected` / `pending`) named fields that do not exist. The second attempt
   proposed adding `expectedSchemaVersion()` and `pendingMigrations()` to the
   `StatusStore` port — **also wrong, and over-built**:

   - `expectedSchemaVersion` ALREADY exists. `src/composition.ts:763` computes it
     as `MIGRATIONS[MIGRATIONS.length - 1]!.version` and injects it into
     `CheckProject` as a plain number. Reuse that, do not invent a second source.
   - `pendingMigrations` needs no lookup at all. `validateSequence`
     (`src/storage/sqlite/migrate.ts:54-63`) _enforces_ versions to be exactly
     `1..n` contiguous, so `pending = expectedSchemaVersion − schemaVersion`
     is exact by construction.

   So the port is untouched: `GetDbStatus` takes the number as a second
   constructor argument, mirroring the `CheckProject` wiring. `dbPath`,
   `journalMode` and `tables` are deliberately NOT on the wire.

   **`db status` also gains `--json`.** It is the only read leaf without one, and
   its absence is why the Proof had to scrape a `schema:` line out of formatted
   text. A CLI/HTTP parity assertion that parses prose is a weak assertion. The
   flag follows the established shape (`src/apps/cli/list-tasks.ts:23-27`):
   `if (args["json"]) return { exitCode: 0, stdout: [JSON.stringify(status)], stderr: [] }`.
   The default text output is byte-for-byte unchanged, so
   `src/apps/cli/db.test.ts` stays green.
   It is NOT redundant with the readiness `database` check: `evalDatabase`
   compares `schemaVersion` to `expectedSchemaVersion`, but `check project`
   requires a project id, so at bootstrap — no projects yet — it cannot be
   called. `database` is a new reviewed `PATH_SEGMENTS` entry. `ROUTES.length`
   **+1**.

7. **Pause is enqueue-time only.** `EnqueueReadyTasks` consults `paused` when it
   enqueues; a task already claimed and running is **not** interrupted and runs
   to completion. "Pause" means "start no more work in this initiative".
   Interrupting an in-flight run is `abandon task` (EPIC 013) — a different
   control with a different guarantee. Resume latency is one poll interval.
   Empirically confirmed against `run daemon` while authoring this epic.

8. **No new event types.** `EVENT_TYPES` has no `initiative.paused` and 025 adds
   none: the `events.type` CHECK is enforced by a full table rebuild (already
   done eleven times, `events_new` … `events_new11`), and a twelfth rebuild for
   a type with no consumer is unjustified. Run control is not the event feed's
   job.

9. **Leaf accounting.** Claimed: `db status` only, by `database.get`.
   `pause initiative` / `resume initiative` are claimed by **023**, not here
   (Decision 5). Not claimed: `run daemon` — covered by composition, since `serve`
   now runs it and `serve` is already excluded from the coverage set.
   `retirement.md` gains three categories: _operator-only / never retired_
   (`serve`, `commands`, `db migrate`, `login provider --method browser`),
   _covered by composition_ (`run daemon`, `setup project`), _deferred but
   feasible_ (`login provider --method device_code`). The "uncovered set is
   non-empty" assertion at `src/apps/http/cli-coverage.test.ts:53-63` still holds
   after 025.

10. **Out of scope, decided here so it is not re-litigated.** `setup project`
    stays CLI-only: its writes are ordinary 021 rows and its value is the
    interview, which is a client concern. `login provider --method browser` can
    never work behind the API — it needs a browser on the operator's machine.
    `db migrate` is operator-only; it mutates schema under a live server.
    `login provider --method device_code` is feasible headless and is deferred on
    scope, not refused.

11. **The `If-Match` atomicity work is NOT in this epic.** It is
    `.agent/plan/stories/021-http-planning-writes/10-if-match-atomicity.md`, a
    021 follow-up. Measured: ten concurrent PATCHes on one initiative with one
    validator gave `200,412×9` — there is no lost update today. The invariant
    holds only because every PATCH path is synchronous, and nothing enforces
    that. Land S10 before the ai-provider-writes epic adds async PATCH work —
    its `POST /api/ai-provider/:id/probe` is the first planned row whose write
    path performs real I/O.

12. **Route and coverage counters are DELTAS, not absolutes.** At authoring time
    `ROUTES.length` is **52** (`src/apps/http/routes.test.ts:299-300`) and the
    uncovered-leaf count is **26** (`src/apps/http/cli-coverage.test.ts:143-150`).
    Epics 022–025 are planned but unbuilt, and each moves both numbers (022's own
    text says `ROUTES` goes 52 → 54). So this epic's stories specify
    **`+1` row** and **`−1` uncovered leaf** against whatever the assertions
    hold when 025 runs, and record today's values only as the authoring baseline.
    An implementer who finds a different starting number applies the delta; that
    is arithmetic, not a design decision.

## Verification Gate

Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).

Hermetic coverage required beyond the Proofs:

- **The lease** — a unit test drives two claims against one store and asserts
  exactly one wins; a released lease is immediately claimable; an expired lease
  is claimable; a renewed lease is not.
- **The host** — daemon on by default, off under `--no-daemon`; the heartbeat
  starts inside the `try` and stops in the `finally`; SIGINT and SIGTERM are
  idempotent; a rejected `RunDaemon.execute()` releases the lease and leaves the
  server serving.
- **`GET /api/database`** — view field list, `PATH_SEGMENTS` entry,
  `ROUTES.length` +1.

Proof (both scripts are authored and were run against the current tree, 2026-07-30):

```bash
scripts/e2e/http-execution-proof.sh
scripts/e2e/http-daemon-ownership-proof.sh
```

They must print `025 ok: …` and `025 ownership ok: …`.

`http-execution-proof.sh` — phases **A** fixture through the real CLI plus
`serve --port 0` · **B** readiness reports `daemon: running` · **C** the daemon
demonstrably scans while the paused initiative stays idle · **D** `If-Match`
absent `428`, stale `412`, unknown id `404` · **D2** the Decision 7 body table ·
**E** resume over HTTP, `gate a` reaches flight · **F** pause DURING flight —
`gate a` completes, `after a` is held back · **G** resume, `after a` completes,
`gate b` takes flight · **H** `GET /api/database` matches the CLI · **I** SIGTERM
drains `gate b`, no surviving descendant, no running job, heartbeat goes stale.

`http-daemon-ownership-proof.sh` — **A** fixture and one `serve` · **B** it owns
the lease and executes · **C** a SECOND `serve` serves reads but runs no daemon,
and readiness never reports `multiple` · **D** the first releases on shutdown and
the second takes over without waiting for expiry · **E** a daemon failed via
`KANTHORD_DAEMON_FAIL_AT=1` keeps serving reads, reports `stopped`, and frees the
lease for a replacement.

**Observed expected failure** (required by AGENTS.md, recorded here):

```
A ok: fixture built, serve listening on 49340
--- B: serve HOSTS the daemon (readiness reports daemon: running)
FAILED: daemon check — expected 'running', got 'stopped'
```

Exit `1`, both scripts, at phase B — plain `serve` starts no daemon today. Phase
A asserts only capabilities that already exist, so a phase-A pass proves the
fixture is sound and the first failure is the missing capability.

**Determinism** — no bare `sleep` guards a behavioural claim. The probe
initiative is a CHAIN, so exactly one probe task is ready at a time and each
probe completion witnesses a FRESH enqueue+dispatch cycle; every negative
assertion follows such a witness. A task is held in flight by a BLOCKING `bash`
turn in the `KANTHORD_FAKE_AGENT` script (`scripts/e2e/make-025-execution-graph.sh`),
not by a gate in the provider mock: the agent makes one provider call per turn,
so a provider-level gate latches, and `jobs.status='running'` proves only that a
job was claimed. The whole fixture's logic was validated end to end against the
existing `run daemon` before this epic was written, so every phase predicate is
known to hold. Assertions read the program surface; direct SQLite appears only in
the two post-shutdown invariants, where no server is left to ask.

## Stories

- **S1 — the daemon lease.** Migration for the lease row, port, SQLite adapter
  with the atomic `UPDATE … WHERE (unowned OR expired) RETURNING` claim, renew
  and release. Unit tests for contention, release, expiry, renewal.
- **S2 — the execution host.** `serve` runs `RunDaemon` by default with
  `--no-daemon`; lease claim on start, release on stop; heartbeat bracket;
  idempotent SIGINT/SIGTERM with a bounded drain; the same claim wired into
  `run daemon`. The three fixture proofs gain `--no-daemon` in this story.
- **S3 — daemon-failure observability.** The `KANTHORD_DAEMON_FAIL_AT` seam, plus
  release-and-keep-serving on rejection. Its own story and its own test, not a
  clause inside S2.
- **S4 — `GET /api/database`.** Query, view, row, `PATH_SEGMENTS`,
  `ROUTES.length` +1, `db status --json`, wiring.
- **S5 — retirement and coverage bookkeeping.** The three `retirement.md`
  categories and the Target 025 rewrite. Retires nothing — the retirement plan is
  on hold until after the UI and integration.

## Non-goals

A job API in any form. Any UI. Retiring a CLI leaf. Interrupting an in-flight
task — that is `abandon task`. Pause at project, objective or task scope. A
global stop switch (`PATCH /api/daemon {"paused":true}` remains a one-row future
addition; Decision 4 makes "nothing is executing" visible, which is the part that
could otherwise mislead). Two `serve` processes on one database. Process
supervision — `serve` is still a foreground command. The event feed (022), state
transitions (023), high-impact operations (024), land and publish. The `If-Match`
atomicity hardening, which is 021's story S10.

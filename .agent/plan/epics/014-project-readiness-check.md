# EPIC 014 — Project readiness diagnosis (`check project`)

> The readiness ENGINE behind onboarding, from the dashboard UX debates
> (2026-07-27), reduced to CLI-only at Ulrich's direction and then narrowed again
> by a fourth debate that found the first draft's onboarding claim false: a
> `--id`-taking report cannot onboard a user who has no id. Guided setup is a
> separate epic (`OPEN:` below); this epic ships the honest diagnosis it needs.
>
> Independent of `011-client-discovery-surface.md` and
> `012-explicit-activation-guarded-verdicts.md`.

## Goal

An operator holding a project id can ask what is wrong and get an answer that
never overstates what kanthord knows. `kanthord check project --id <id>
[--json] [--probe-repositories] [--probe-provider]` reports three SEPARATE
verdicts — `configured` (the rows needed exist and reference each other
correctly), `verified` (the live probes that were actually run all passed), and
`operational` (a daemon is alive) — plus `ready`, which is true only when all
three hold. A prerequisite that kanthord has merely recorded reads `unverified`,
never `ok`: an assigned provider with a dead key is the most likely first-run
failure, and reporting it `ok` would make this command a false-green generator.
`next` is a structured action naming the inputs the user must decide, and carries
a runnable command only when every value is already known.

## Verification Gate

Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).
Hermetic coverage required beyond the Proof:

- The report is a pure function in `src/app/project/project-readiness.ts` (a
  query-side module, zero I/O) over injected facts. Every status combination is
  unit-tested with no database, no clock read, and no git.
- **Three verdicts, independently tested.** `configured` ignores probe results;
  `verified` is `true` only when at least one probe ran and all that ran passed,
  and is `null` when none ran (never `true` by vacuous default); `operational`
  is the daemon verdict alone. `ready = configured && verified === true &&
operational`. A stopped daemon with perfect config yields
  `configured:true, operational:false, ready:false`.
- **Status vocabulary is closed and asserted:** `ok` (verified by a probe this
  run), `unverified` (recorded, not probed), `missing`, `paused`, `blocked`,
  `failed`, `unsupported`.
- **Provider resolution matches the daemon exactly**, via the existing
  `ResolveProjectChain` (`src/app/ai-provider/resolve-project-chain.ts`, which
  reads `registry.listAssigned(projectId)` and appends the active global default
  through `resolveProviderChain`, `src/domain/resolve-provider-chain.ts`) — NOT
  `providerChainFor`, which takes an initiative id and so cannot serve a project
  with no initiative yet. The check is `missing` only when the RESOLVED chain is
  empty. A provider reachable only as the global default is `unverified`, not
  `missing`, with a `detail` saying it resolves via the global default and naming
  `assign ai-provider` to make it explicit — because the daemon _would_ run on
  it. A report stricter than the daemon is its own kind of lie, so bypassing the
  default fallback to make an "unassigned" state reportable is prohibited.
- **Repository configured-ness is defined**: a repository is `configured` only
  when its `auth` mode's requirement is met — `https-token` requires a
  `credential` reference that exists AND is of type `credential`; `ambient` and
  `ssh-agent` require none. A dangling or wrong-typed credential reference is
  `blocked`, not `ok`.
- **Initiative runnable-work semantics are defined.** The check is `ok` only when
  at least one initiative is `building`, not paused, and holds at least one task
  that is not `completed`/`discarded`. `paused` when every candidate initiative
  is paused; `blocked` when one exists but has no incomplete task; `missing` when
  none exists. When several qualify, `next` names the **lowest-id** (oldest)
  initiative, so the report is deterministic.
- **Heartbeat correctness.** Written by an interval independent of task
  boundaries, because `RunDaemon`'s loop `await`s `runNext.execute()` to
  completion (`src/app/task/run-daemon.ts:154`) and a long agent run would
  otherwise make a live daemon read `stopped`. One row per daemon instance keyed
  by an instance id (pid + start time), so a second daemon is visible rather than
  overwriting the first. Staleness threshold is a named constant, overridable for
  tests only via `KANTHORD_HEARTBEAT_STALE_MS`, and is a multiple of the
  heartbeat interval — never tied to `pollIntervalMs`. Tested at, just below, and
  just above the boundary; a non-monotonic clock jump backwards must not report a
  negative age. Two live instances are reported, and the report says so.
- **Probes are opt-in and side-effect free.** `--probe-repositories` runs
  `git ls-remote` per repository and asserts the configured branch is present in
  the output — a remote that answers but lacks the branch is `failed`, not `ok`.
  It never clones and never writes to the repository's `--path`. Probe output is
  redacted through the existing credential-redaction path before it reaches a
  report or a log. Each probe has a bounded timeout; a timeout is `failed`, never
  a hang. `--probe-provider` calls the existing provider test path and is
  documented as **billable**; it is never implied by `--probe-repositories`.
- **Notification is reported, not hidden**: status `unsupported`, non-blocking,
  with `detail` pointing at `list event --follow`, because no `Notifier` port or
  slack/telegram adapter exists in `src`.
- Exit code `0` only when `ready` is true.

Proof: `scripts/e2e/project-readiness-proof.sh` — deterministic, no model, no
network beyond a local `file://` remote. Run from the repo root:

```bash
scripts/e2e/project-readiness-proof.sh
```

It must print `014 ok: …`.

## Stories

1. **`ProjectReadiness` — the pure report.** `src/app/project/project-readiness.ts`,
   zero I/O, taking observed facts and returning `{configured, verified,
operational, ready, checks[], next}`. Owns the closed status vocabulary, the
   check order, the repository auth rules, the initiative runnable-work rule, and
   the deterministic lowest-id tie-break.

2. **Structured `next`.** `next` is `{check, action, requiresInput[], command?}`.
   `command` is present only when every value is known — so `resume initiative
--id <realId>` carries one, while configuring a repository does not, because
   name / remote URL / branch / auth / path are user decisions the report cannot
   invent. A dashboard consumes the structure; it never parses shell.

3. **Daemon heartbeat.** A `daemon_heartbeats` table keyed by instance id
   (pid + start time), written on an interval independent of task execution, with
   a migration. Read path derives `running` / `stopped` / `multiple` from age
   against `HEARTBEAT_STALE_MS`.

4. **Repository access probe.** A read-only `git ls-remote` behind a capability
   port (faked in tests), with branch presence, bounded timeout, and redaction.

5. **Provider probe (opt-in, billable).** `--probe-provider` reuses the existing
   `test ai-provider` path; no new model code. Absent the flag the provider is
   `unverified`.

6. **`check project` CLI leaf.** Registered in `src/apps/cli/commands/check.ts`
   beside `check graph`, with `Usage` + `Example` help the architecture test
   requires. Compact text table; `--json` is the stable contract.

## Decisions

- **`unverified` is a first-class status.** Recorded ≠ working. This is the
  single most important decision in the epic: the earlier draft would have
  reported `ready:true` for a project whose provider key was dead.
- **`verified` is `null` when no probe ran**, never `true`. A verdict nobody
  tested must not read as passing.
- **A stopped daemon does not make a project mis-configured, but it does make it
  not `ready`.** Three fields remove the contradiction the earlier draft had, where
  `ready:true` coexisted with "nothing will run".
- **Provider liveness is opt-in and billable-by-name.** Folding it into a default
  run would make a diagnostic command cost money; omitting it entirely would let
  the most common first-run failure read as fine. An explicit flag is the only
  honest option.
- **This epic is diagnosis, not onboarding.** A command taking `--id` cannot help
  a user with no id. `OPEN:` a guided `setup project` state machine — which
  discovers or creates the project, gathers the auth/provider/graph decisions,
  and can run `--non-interactive` — is a separate epic, pending Ulrich's
  decision. It would consume this epic's readiness function rather than
  re-deriving it.
- **`check project`, not `project onboard`.** EPIC 009.4 already claims
  `project onboard` for an agent-driven capacity session.

## Non-goals

- **No guided or interactive setup**, and no auto-fix: the report never creates,
  assigns, or resumes anything. See the `OPEN:` above.
- **No project discovery or creation** — `--id` is required. `list project` is
  EPIC 011.
- **No notification delivery or test-send** — requires the notifier capability,
  which does not exist in `src`.
- **No provider call unless `--probe-provider` is passed.**
- **No graph authoring, no new resource types, no resource schema changes.**
- **No daemon supervision.** The heartbeat observes; it does not start, stop, or
  enforce a single-daemon lease.

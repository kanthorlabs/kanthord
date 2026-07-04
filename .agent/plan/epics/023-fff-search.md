# 023 fff Search Behind the Thin Internal Interface

## Outcome

Daemon-owned code search: the **thin internal search interface** with the pinned
`fff` engine behind it — path + content queries with frecency, one index per repo
slot living in the daemon (not in agents), warm across session respawns, started
at slot registration and stopped at deregistration. The interface is the seam;
fff is an implementation detail a future engine could replace (PRD §6.4 —
pre-1.0 dependency wrapped deliberately).

## Decision Anchors

- phases.md Phase 2B Deliverable 3 — fff search in the daemon, pinned version,
  behind the thin internal search interface.
- PRD §6.4 — the index lives in the daemon, not agents; respawned sessions get a
  warm index for free; pin versions and wrap behind a thin internal interface.
- PRD assumption #5 — non-git paths are rejected at repo registration (kanthord's
  rule; fff itself is git-independent — the correction note in the PRD).
- Epic 020 SU2 findings — the fff embedding surface (start/stop, query, watcher,
  non-git behavior).

## Stories

- `001-search-interface-and-engine.md` — the `Search` interface (path query,
  content query, results with frecency ordering) with the fff-backed
  implementation **and a hermetic fake** (fakes are permanent doubles); engine
  errors surface typed.
- `002-index-lifecycle.md` — index per repo slot: started at registration,
  stopped at deregistration, survives session teardown/respawn (a query after a
  respawn hits the same warm index — no per-session rebuild), watcher picks up
  file changes.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites. Interface
  and lifecycle tests run against the **fake** engine (hermetic); the
  **real-binding integration suite is a required gate item** — this Epic cannot
  close on the fake alone (debate finding: the deliverable is fff in the
  daemon, and fake-only verification would be false confidence). Its placement
  (inside `npm test` if the SU2 findings confirm offline + stable startup,
  else `test/live/` maintainer-run) is decided by the findings and recorded in
  the suite header; either way its pass is required to close the Epic, and the
  Epic is **not executable before SU2 resolves** (stated, not implied).
- The integration suite asserts `engineVersion()` equals the pinned version
  (debate finding — the pin verified where the engine runs, not only in the
  lockfile).
- A content query through the interface returns matching files ordered by the
  engine; a path query typo-matches per the engine's behavior (real-engine
  suite).
- Queries are **bounded**: every query carries a result cap and a timeout;
  over-cap results truncate with a marker; a timed-out query is a typed error —
  no unbounded content scan reaches an agent (debate finding — a daemon-owned
  service exposed to agents needs resource limits).
- Agent-facing search results are filtered through the ring-1 **role read
  policy**: a role-read-denied path never appears in results (composed with
  Epic 015 — debate finding: `pure` classification alone does not scope
  content).
- The index is slot-owned: two sessions on the same slot query the same index
  instance; a session respawn (the Epic 006 coordinator's respawn — the term is
  pinned) does not restart the index (instance identity / no-restart asserted
  via the lifecycle seam); a deregistration racing an in-flight query lets the
  query finish or fail typed — never a crash (debate finding).
- Deregistering the slot stops the watcher and releases the index; a query
  after deregistration is a typed error.
- Boot fail-soft: a registered slot whose path is missing, no longer a git
  repo, or whose engine fails to start marks the slot **degraded** + escalates;
  the daemon boots anyway (debate finding — one bad slot must not kill the
  daemon).
- fff's version is pinned exactly (lockfile assertion in the maintainer gate;
  here: the interface exposes an `engineVersion()` surfaced in the daemon-ops
  status for drift visibility).
- Agents reach search **only** through a session tool backed by this interface
  (the tool appears in the Epic 015 allowlist as a pure/classified tool; no
  direct fff access from agent code — module-boundary assertion).

## Dependencies

- **Epic 020 SU2** (fff dep + embedding findings), **Epic 016** (repo slots —
  the index attaches to the slot lifecycle), **Epic 015** (the search tool's
  manifest classification).

## Non-Goals

- No knowledge-base/ACL search, no identity-map integration (PRD §6.5 — later).
- No index persistence tuning, no multi-repo federated queries — one index per
  slot, queried per slot.
- No replacement engines — the interface exists so replacement is *possible*,
  not to build a second engine now (PRD §10 "start with two" does not apply to
  infra seams).

## Findings Out

- none. If the real fff binding behaves off the SU2 findings, the correction is
  a decision record + findings update (standard 2B protocol).

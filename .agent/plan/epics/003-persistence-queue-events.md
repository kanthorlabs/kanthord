# EPIC 003 — Persistence, queue, and event feed on SQLite

## Goal

The single `node:sqlite` database becomes real infrastructure behind ports:
a migrations runner, one repository per aggregate (Project, Initiative, Task),
the atomic job queue (`UPDATE … RETURNING` claim), and the append-only events
table with cursor reads — the storage half of pull-based notifications. All
behavior is proven by adapter tests on temp databases; concurrency claims are
proven with two real connections, not mocks.

## Verification Gate

Gates:  `npm run typecheck && npm test`
Proof:

```bash
export KANTHORD_DB="$(mktemp -d)/kanthord.db"
node src/main.ts db migrate   # prints each applied migration. Exit 0.
node src/main.ts db migrate   # prints "up to date". Exit 0.
node src/main.ts db status    # prints schema version, journal_mode=wal,
                              # and a row count per table. Exit 0.
```

## Stories

- **Migrations runner.** Ordered SQL migrations in-repo, applied
  transactionally with a schema-version table; `db migrate` + `db status`
  CLI commands replace the skeleton's single-table stamp.
- **Schema.** Tables for projects, resources, initiatives, objectives, tasks,
  task-dependencies, jobs, events — ULID primary keys, foreign keys on, WAL on
  every connection.
- **Aggregate repositories.** `storage/port.ts` repo interfaces (one per
  aggregate, per `AGENTS.md` — not per entity) + SQLite implementations;
  round-trip tests on temp DB files.
- **Job queue adapter.** `queue/port.ts` + SQLite implementation: enqueue
  (idempotent — re-enqueueing a queued job is a no-op), and the atomic claim
  via `UPDATE … SET status='running' … RETURNING`. Test: two **worker
  threads or child processes** (not two connections on one event loop —
  `node:sqlite` is synchronous, so that would only interleave; debate
  finding) claim against the same DB file — exactly one wins, no
  double-claim. The `SQLITE_BUSY`/`busy_timeout` policy is decided and
  documented explicitly in this story, not assumed.
- **Event feed adapter.** `events/port.ts` + SQLite implementation: append
  event, read with `after <ulid>` cursor ordering; test proves a poller sees
  every event exactly once across multiple polls.
- **Graph persistence wiring.** The use cases from EPIC 002's fixtures gain a
  persisted path: store a checked graph, load it back, recompute readiness —
  proving domain ↔ storage round-trips through the ports.

## Non-goals

- No worker loop consuming the queue (EPIC 005) — this epic stores and claims;
  nothing executes.
- No CLI surface for managing the graph beyond `db *` (EPIC 004).
- No retention/cleanup policies for events or jobs.

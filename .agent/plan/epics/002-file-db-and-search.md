# 002 File-Based DB & Search Interface

## Outcome
Create a file-based store with atomic, single-writer, versioned reads/writes and
a swappable full-scan search interface. This is the persistence foundation every
later subsystem builds on.

## Decision Anchors
- D1: no SQL; build our own file DB.
- N1: atomicity and concurrency.
- N2: query/index without SQL.
- B8 / §8: every persisted file carries `version`.
- §5: storage layout.
- §Daemon Modules: `storage/`.

## Stories
- `.agent/plan/stories/002-file-db-and-search/001-versioned-file-store-and-search.md` - versioned markdown/json/jsonl store, locks, atomic writes, append safety, and full-scan search.

## Verification Gate
- `npm run typecheck` exits 0.
- `npm test` exits 0.
- File-store primitive tests pass both native and inside the Podman `.data/` mount.

## Dependencies
- Epic 001.
- `.agent/milestone/01-infrastructure/02-development-setup.md` for the container `.data/` mount.

## Non-Goals
- No SQL, SQLite, ORM, external search engine, or vector search.
- No migration logic beyond preserving `version`; migrations are Epic 014.
- No OS-crash or power-loss fsync durability guarantee in v1.

## Findings Out
- `.agent/plan/findings/02-filedb-atomicity.md`

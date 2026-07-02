# 001 Foundations — Clock & Storage Conventions

## Outcome

The **storage & time substrate** the whole Phase-1 frame stands on, as one
reviewable outcome: an **injectable clock** seam with a deterministic fake, a
**format layer** that reads and writes the fixed storage formats
(markdown+frontmatter, jsonl, yaml), and a **SQLite runtime store** opened in WAL
mode with a busy timeout plus a migration-runner seam. Every artifact is a typed
interface with an in-memory or fake implementation. After this Epic, all later
Epics parse plan files, append journals, load registries, and read/write the
disposable SQLite index through these seams instead of touching the platform
directly.

**Scope of the two day-one seams (phases.md):** this Epic owns the **clock** seam.
The **broker** seam — the other day-one injectable per phases.md — is owned by
Epic 005 (Broker skeleton), because its shape is defined by the async verb
lifecycle, not by storage. This Epic does not cover it; the title is scoped to
clock + storage deliberately (debate finding, do not re-broaden).

**No LLM / no network** is a design property of every module here (all I/O is
local filesystem + local SQLite); it is **enforced as a gate** by the test runner
in Epic 010, not asserted as a per-Task AC in this Epic.

## Decision Anchors

- PRD §7.7 — clock is an injectable seam **from day one**; fakes are permanent
  test doubles, never deleted.
- PRD §7.1.1 §2 (format rules table) — plan nodes = markdown+frontmatter;
  journals/events = jsonl (append-only); registries = yaml; compiled plan =
  SQLite rows (derived, disposable).
- PRD §6.1 — SQLite is local/derived/disposable; WAL mode + `busy_timeout`
  because daemon threads and the broker both touch it; rebuildable from markdown.
- phases.md Phase 1 Requirements — storage conventions fixed now; clock injectable
  from day one; no network anywhere in Phase 1.
- PROFILE.md — Node 24 / TS, ESM, `node:test` + `node:assert/strict`, DI seam via
  constructor/factory params typed by a small consumer-defined interface.

## Stories

- `001-injectable-clock.md` — a `Clock` interface with a deterministic fake that
  starts at a fixed instant, advances only when told, and fires due timers in order.
- `002-frontmatter-markdown.md` — parse a plan file into typed frontmatter + named
  body sections, and serialize a frontmatter object back, round-trip stable.
- `003-jsonl-event-log.md` — append-only jsonl writer/reader for journals and
  events; one JSON object per line, survives concurrent appends by the single writer.
- `004-yaml-registry-loader.md` — load a yaml registry file into a typed object;
  malformed yaml is a typed error naming the file.
- `005-sqlite-runtime-store.md` — open a SQLite database in WAL mode with a
  `busy_timeout`, apply the versioned schema, and expose a typed query seam.

## Verification Gate

- `npm run typecheck` exits 0.
- `npm test` exits 0 with the Epic's `node:test` suites present and green.
- The fake `Clock` drives at least one timer-ordering test with zero real
  wall-clock waiting (no `setTimeout` against the real event loop in the assertion).
- A frontmatter round-trip test proves parse→serialize→parse is stable for the
  PRD's task-file frontmatter shape (nested maps, arrays of maps, inline objects).
- Opening the SQLite store reports `journal_mode=wal` and a non-zero
  `busy_timeout` from a live `PRAGMA` read.

## Dependencies

- **Epic 000 — Milestone Setup (BLOCKS this Epic).** Specifically **SU1** (`yaml`
  runtime dep — required because PRD frontmatter/registries use nested maps, arrays of
  maps, inline objects; a hand-rolled subset would be a silent dialect) and **SU2**
  (SQLite access-path spike + findings). Stories `002`/`004`/`005` cannot run until
  SU1/SU2 are verified green — otherwise their first RED test fails on module
  resolution / an unresolved runtime surface, not on the intended behavior. These live
  in Epic 000 (not a `### Task` here) because the TDD lane cannot edit `package.json`.
- No prior TDD Epic (000 is the maintainer setup gate; this is the first `/work` epic).

## Non-Goals

- No markdown *rendering* — only frontmatter + section extraction for the machine
  layer. Body prose is passed through untouched.
- No full YAML authoring/emitting — loading and typed access only; `002`'s
  `serializeFrontmatter` is a generic frontmatter round-trip, not compiler sign-off
  logic (Epic 002 owns when/what to write).
- **No domain tables and no compiled-plan projection in this Epic.** It ships the
  SQLite connection, WAL/busy_timeout config, and a generic migration-runner seam
  plus its `schema_version` *metadata* only. Epics 002/004/005 add their own
  migrations and tables; the markdown→SQLite projection contract is Epic 003.
- No S3 sync, no fff, no real broker/agent — later phases.

## Findings Out

- `.agent/plan/feedback/001-foundations-seams-and-storage/sqlite-access.md` —
  produced by **Epic 000 SU2** (maintainer spike gate, not a TDD Task): the chosen
  SQLite library (`node:sqlite` or the `better-sqlite3` fallback), any required runtime
  flag, the concrete API calls, and observed WAL/busy_timeout behavior. Consumed by
  Epics 002/003/004/009 and by this Epic's Story `005`.

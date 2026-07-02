# 003 Markdown Store & SQLite Projection Contract

## Outcome

The single-writer markdown store — feature directories holding the
frontmatter/STATE/JOURNAL triples plus RUNBOOK — and the **rebuild-from-markdown**
path behind a **documented, versioned projection contract**: given the markdown
files, kanthord reconstructs the *markdown-derived subset* of the SQLite index into
a shadow store, and that shadow equals the projection of the live store when
runtime-only fields (leases, poll cursors, `op_id → request_id`) are ignored.
Markdown is truth; SQLite is disposable and rebuildable (PRD §6.1). No LLM, no
network, no S3 — sync is a later phase.

## Decision Anchors

- PRD §6.1 — markdown = truth (synced); SQLite = derived/runtime (local,
  disposable, never synced); the queue rebuilds from frontmatter statuses; the
  markdown→SQLite projection is a **documented, versioned contract**; the rebuild
  reuses the writer's parser (logged blind spot).
- PRD §6.1 — single-writer invariant: the daemon is the only writer to the markdown
  store; JOURNAL append-only, STATE small + single-writer.
- PRD §6.2 — three-layer node docs: frontmatter (machine), STATE.md (bounded,
  rewritten), JOURNAL (append-only); features and tasks each have the triple.
- phases.md Phase 1 Deliverable 4 + gate — "Rebuilding SQLite from markdown yields
  the same markdown-derived projection (asserted per the documented projection
  contract)."

## Stories

- `001-feature-directory-store.md` — read/write a feature directory (epic/story/task
  frontmatter, `*.state.md`, `*.journal.jsonl`, `RUNBOOK.md`) through a single-writer
  store seam.
- `002-projection-contract.md` — the versioned projection spec: enumerate which
  SQLite fields are markdown-derived vs runtime-only, as code + a written contract
  doc, with a contract version.
- `003-rebuild-and-equivalence.md` — rebuild the markdown-derived subset from the
  files into a shadow store and assert it equals the live store's projection
  (ignoring runtime-only fields).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites.
- Reading a written feature directory back yields the same triples + RUNBOOK
  content (round-trip through the store seam).
- Given a compiled golden feature, `rebuildFromMarkdown` produces a shadow store
  whose markdown-derived projection is **field-by-field equal** to the live store's
  projection; a deliberately mutated live runtime-only field (a lease) does **not**
  cause a divergence (it is excluded by the contract).
- The projection contract carries an explicit version constant asserted in a test.

## Dependencies

- **Epic 001** (SQLite store + migration seam, plan-file parser, jsonl log).
- **Epic 002** (the compiler is the markdown→compiled-plan half of the projection;
  the rebuild re-runs `compile` on the markdown and reads the compiled-plan tables /
  schema section documented in Epic 002).

## Non-Goals

- No `kanthord verify` operator command, no warn/repairable/fatal **severity
  levels**, no startup/post-crash hooks — those are Phase 2A/3 (PRD §6.1). This Epic
  ships the projection contract + rebuild path they build on, and a plain
  field-equality diff only.
- No S3 sync (Phase 2B), no multi-writer (out of MVP) (PRD §6.1).
- No operation-ledger projection — the ledger is created by Epic 005. The v1
  contract **explicitly excludes** it (documented as a future section, not a
  reserved-and-asserted slot — an unvalidated slot creates false confidence); Epic
  005 **bumps** the contract version when it adds ledger rows. Phase-1 rebuild covers
  the compiled plan + node status only.
- The independent-projection ideal (a second parser) is **not** built — the rebuild
  reuses the writer's parser; the shared-bug blind spot is logged, per PRD §6.1.

## Findings Out

- none as a TDD-task output. The projection contract itself (`002`) is the durable
  reference for Epic 005 (ledger slot) and Phase 2A `kanthord verify`; it lives in
  `src/` as code + a doc comment, not under `.agent/plan/**` (not engineer-writable).

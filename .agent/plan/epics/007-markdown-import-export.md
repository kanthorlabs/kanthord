# EPIC 007 — Markdown import/export of the work graph

> **DRAFT — blocked on EPIC 006.** Do not dispatch through `/work`. This epic
> invents no domain rules; it reuses the task-mutation, field-locking, graph
> validation, and CLI surfaces that EPIC 004–006 establish. Author the detailed
> Story/Task files only once EPIC 006 has shipped and those surfaces are stable
> (debate B6, 2026-07-16). Design debated 2026-07-16 (opencode/gpt-5.6,
> six blockers merged) — see the decision notes at the end.

## Goal

A human + Claude Code can author an Initiative → Objective → Task graph as
friendly markdown files, `import` them into the SQLite database, and `export`
an existing initiative back to markdown for review and re-editing. The markdown
is a **projection** (export) and a **proposal** (import), never a peer store:
the database stays the single source of truth for execution, exactly like the
EPIC 006 `import resource` path. The format decomposes 1:1 into the existing
`newTask` fields (`title`, `instructions`, `ac`, `agent`, `dependencies`,
`context`) and feeds the existing `renderTaskPrompt` — **no new prompt path and
no new domain field**. This is the friendly front-door that lets a graph
authored with Claude Code be executed by the pi agents from EPIC 006.

## Verification Gate

Gates:  `npm run typecheck && npm test`
Proof:  (fresh EPIC 004/006-style setup; the markdown edits below are scripted
        so the block is copy-paste-runnable, no manual editor step.)

```bash
export KANTHORD_DB="$(mktemp -d)/kanthord.db"
export OUT="$(mktemp -d)/oauth"
node src/main.ts db migrate

PROJECT=$(node src/main.ts create project --name demo)
INITIATIVE=$(node src/main.ts create initiative --project "$PROJECT" --name oauth)
OBJECTIVE=$(node src/main.ts create objective --initiative "$INITIATIVE" --name backend)
TASK_API=$(node src/main.ts create task --objective "$OBJECTIVE" --title "implement api" \
  --instructions "Implement POST /oauth/token" --ac "returns 200 for valid creds" --agent generic@1)
node src/main.ts create task --objective "$OBJECTIVE" --title "deploy" \
  --instructions "Deploy the backend" --ac "health check green" --depends-on "$TASK_API"

# EXPORT: initiative -> a tree of markdown files (one file per task).
node src/main.ts export initiative "$INITIATIVE" --out "$OUT"
find "$OUT" -type f | sort
# lists: initiative.md, objectives/backend/objective.md,
#        objectives/backend/implement-api.md, objectives/backend/deploy.md,
#        INDEX.md, .kanthord-export.json. Exit 0.

# EDIT an existing task file (scripted), then re-import: UPSERT by id, no dup.
API_FILE="$OUT/objectives/backend/implement-api.md"
printf '\n- [ ] rejects bad creds with 401\n' >> "$API_FILE"
node src/main.ts import graph "$OUT"
# stderr: "0 created, 1 updated, 1 unchanged" style summary. Exit 0.
# a successful import rewrites .kanthord-export.json with the fresh revision,
# so the next re-import of this dir is not falsely stale.
node src/main.ts get task --id "$TASK_API"
# task count unchanged (still 2 tasks total); ac now has BOTH criteria.
test "$(node src/main.ts list task --initiative "$INITIATIVE" --json | node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).length))')" = "2"

# AUTHOR a brand-new task by hand (no id) in the same objective, then import.
cat > "$OUT/objectives/backend/write-tests.md" <<'MD'
---
kind: task
ref: write-tests
title: write tests
objective: backend
agent: generic@1
depends-on: [implement-api]
---

# Instructions

Add unit tests for the token endpoint.

# Acceptance Criteria

- [ ] tests cover valid and invalid credentials
MD
node src/main.ts import graph "$OUT"
node src/main.ts list task --initiative "$INITIATIVE"
# now shows 3 tasks; "write tests" blocked (waiting: implement api). Exit 0.

# NO DELETE BY OMISSION: remove a task file, dry-run import reports drift.
rm "$OUT/objectives/backend/deploy.md"
node src/main.ts import graph "$OUT" --dry-run
# prints a diff incl. "missing (present in DB, absent from files): deploy";
# exit 0, nothing changed.
node src/main.ts list task --initiative "$INITIATIVE"
# "deploy" is STILL present (omission never deletes). Exit 0.

# STALE-EXPORT CONFLICT: tamper the revision token, re-import -> named error.
node -e 'const f=process.env.OUT+"/.kanthord-export.json";const j=require(f);\
  j.revision="stale";require("fs").writeFileSync(f,JSON.stringify(j))'
node src/main.ts import graph "$OUT"; echo "exit=$?"
# exit=1 with a named StaleExportError line; graph left unchanged, no stack trace.
```

## Stories

- **Format spec + parser.** A committed spec doc plus a parser built on a
  CommonMark AST (not regex heading-sniffing — debate B3): frontmatter → node
  metadata (a task's frontmatter carries `title` — REQUIRED, since the filename
  is a lossy slug and `newTask` needs it — plus `id`/`ref`/`objective`/`agent`/
  `depends-on`/`context`), the H1 `# Instructions` section → `task.instructions`, the
  `# Acceptance Criteria` list → `task.ac[]` (one `- [ ]` item each). One task
  per file means the whole body belongs to that task — no reserved-heading
  grammar needed; prose may use any heading level. Parser lives in the CLI/app
  adapter (apps parse input); the use case receives structured entries — same
  boundary as EPIC 006 `import resource`.
- **Export use case + CLI.** `export initiative <id> --out <dir>` writes the
  one-file-per-task tree (`initiative.md`, `objectives/<slug>/objective.md`,
  `objectives/<slug>/<task-slug>.md`), a generated read-only `INDEX.md`
  whole-graph view, and `.kanthord-export.json` (revision token + id↔ref map).
  Filenames are human slugs; **identity is the frontmatter `id`, never the
  filename**. A query-side read (CQRS-lite), it never mutates.
- **Import use case (proposal, transactional).** `import graph <dir>` parses
  the tree into structured entries and applies them in ONE UnitOfWork
  transaction, reusing the EPIC 006 story-09 pattern and its index+name error
  shape. Upsert: an entry with an `id` **matches by `id` only**; an entry
  without an `id` is created and assigned a ULID. All-or-nothing; any invalid
  entry aborts the whole import with a named error carrying the file path.
- **Identity model (debate B4).** Three distinct fields: `id` (DB ULID,
  generated/validated by kanthord), `ref` (file-local dependency label, unique
  only within the imported package, used only for new nodes), `title` (free
  display text). `depends-on` accepts a `ref` (for a not-yet-imported sibling)
  or a ULID (once assigned); refs resolve across the whole package, and an
  unresolved ref is a named error via the EPIC 002 `validateGraph` unknown-dep
  path. Export prefers ULIDs for `depends-on` so refs survive arbitrary edits.
  Identity is **never** derived from `name`/`title`.
- **Drift report + dry-run (debate B2).** `import graph --dry-run` prints a
  diff (created / updated / unchanged / **missing** / conflicts) and changes
  nothing. Omission never deletes: a DB node absent from the imported files is
  reported as `missing`, never removed. (Guarded `--reconcile` deletion of
  pending-only nodes is a non-goal here — deferred to a later epic.)
- **Stale-export conflict guard (debate B5).** Re-import checks the
  `.kanthord-export.json` revision against the DB; a mismatch (the DB moved on
  since export) is a named `StaleExportError`, exit 1, graph unchanged — so an
  old export can never silently overwrite newer instructions on a `pending`
  task. A **successful import rewrites `.kanthord-export.json`** with the
  post-import revision, so re-importing the same directory is never falsely
  stale — only a real out-of-band DB change or a tampered token trips the guard
  (the Proof's final step tampers the token deliberately).
- **Field-locking on import (debate B1/B5).** Import of an edited authoring
  field (instructions/ac/agent/dependencies/context) for a `running`,
  `completed`, `awaiting_confirmation`, or `discarded` task is **rejected**
  using the EPIC 002 `DependenciesLockedError` family — the domain state
  machine is the conflict guard, not a text merge. Runtime fields (status,
  results, events) never appear as editable input.
- **Golden round-trip test.** A hermetic test proves `export → import → export`
  is byte-stable and that a hand-authored file (no `id`) imports to a
  well-formed graph — the format's regression anchor.

## Non-goals

- **Not a second source of truth, not live config.** DB stays authoritative for
  execution; the file is a projection + proposal, mirroring EPIC 006's
  `import resource` stance.
- **No new domain field and no new prompt path.** The format must decompose
  into the existing `newTask` fields and feed `renderTaskPrompt`. Any authoring
  need for a field the domain lacks is a separate domain change, debated on its
  own — the format must not smuggle one in.
- **No delete-by-omission.** Omitted nodes are reported, never deleted;
  `--reconcile` deletion is a later epic.
- **No git-style 3-way merge.** Conflicts are surfaced (stale-export, locked
  field, unresolved ref) and rejected, not auto-merged.
- **No multi-file-per-objective or single-file-per-initiative layout.** One
  file per task is the locked default (per-objective bundling reconsidered only
  if real usage shows many tiny tasks — debate).
- **No push/pull to a remote or a watch/auto-sync daemon.** Explicit `import` /
  `export` commands only.

## Decision notes (debated 2026-07-16, opencode/gpt-5.6)

- **One file per task**, not per-initiative or per-objective: smallest git
  conflict surface, task = unit of review, kills the reserved-heading parsing
  hazard, and matches the repo's own `.agent/plan/stories/` layout.
- **Import = proposal, export = projection** — the phrase "sync" was dropped to
  keep the DB-authority rule intact.
- Six merged blockers: B1 conflict surface, B2 silent orphan drift → drift
  report, B3 brittle body parse → CommonMark AST, B4 unstable identity → id/ref/
  title split, B5 stale-export → revision token, B6 prematurity → this stays a
  DRAFT until EPIC 006 ships.

## Open blockers to resolve before story authoring (do NOT expand until these are settled)

Raised during a second debate (2026-07-17, opencode/gpt-5.6) when a draft story
list was attempted early. Each MUST be decided before `/work` gets Story/Task
files — authoring on top of an unsettled answer bakes in a guess.

- `B1 - prematurity - Do not expand stories until EPIC 006 has shipped and its
  surfaces are re-verified.` Every task's `Requires` points at an EPIC 004/005/006
  surface (repo methods, task columns, event types, CLI table, UnitOfWork). Audit
  the *actual* mutation / transaction / event / CLI surfaces first, then author.
- `B2 - authoring-mutations-are-a-separate-domain-decision - Whether the domain
  gains guarded pending-only setters (setInstructions / setAc / setAgent, mirroring
  setDependencies) is a domain lifecycle+audit decision, not an import detail.`
  Decide it in EPIC 006 or a standalone domain amendment BEFORE 007 expansion.
  Alternative to weigh: import is create-only for authoring fields (no domain
  change; simpler; re-import cannot edit an existing task's spec).
- `B3 - complete the mutation model - If update-import is in scope, it must cover
  EVERY locked field (title, instructions, ac, agent, dependencies, context) plus
  initiative/objective name updates.` A partial set makes the projection unfaithful.
- `B4 - fix the revision protocol concretely - Choose ONE and specify it fully:
  a per-initiative counter bumped inside every graph-mutation transaction, OR a
  canonical content hash with fixed field set + ordering.` `max(updatedAt)` is
  rejected (misses same-timestamp writes and dependency/context-table changes).
  A successful import must rewrite `.kanthord-export.json` with the fresh value.
  Likely needs a schema migration (append to the ordered list when 007 ships —
  same lane caveat as EPIC 004 S05).
- `B5 - define the import target + modes - Split create-graph vs apply-proposal
  explicitly.` `initiative.md` with no `id` → create-graph under a pre-existing
  `project` (ULID; import NEVER creates a project); with an `id` → apply-proposal
  to that initiative; an `id` from a different initiative → `CrossInitiativeError`.
  State behavior for unknown objective/task ids in an "existing" package.
- `B6 - decide ref namespacing - `ref` is package-scoped, not file-local (cross-file
  `depends-on` must resolve).` Fix: two namespaces (objective refs, task refs), each
  unique within the package; a ULID-looking value = an existing node, else a ref;
  duplicate ref in a namespace → named error.
- `B7 - carry source provenance - Parsed entries need an adapter-supplied
  `sourcePath` so import errors can cite the offending file` — the transport DTO,
  not the domain, holds it.
- `B8 - keep the codec in the driving adapter - Parsing/serialization live in the
  CLI adapter; use cases take/return a transport-neutral GraphPackage DTO and NEVER
  import the codec` (AGENTS.md import-direction rule; a `src/graph-md/` capability
  that a use case imports is wrong).
- `B9 - assert byte-stable round-trip, not just semantic - Canonical serialization
  (fixed frontmatter key order, LF, `- [ ] ` checklist, trailing newline); the
  regression anchor is `serialize(parse(bytes)) === bytes` and a stable
  export→import→export`, not `deepEquals`.
- `B10 - prove rollback on real SQLite - At least one integration test must fail
  LATE (after early writes) and assert full rollback` — fakes cannot prove atomicity
  of the one-UnitOfWork claim.
- `B11 - cover the structural edge cases - objectives with no tasks, initiative with
  no objectives, renamed files, renamed/duplicate refs, moved task files, changed
  objective ownership, omitted objective files, title changes` — each needs a
  defined behavior + test before authoring.
- `S1 - prefer vertical-slice e2e assertions - Each slice carries its own failing
  end-to-end assertion; a final task only consolidates the runnable Proof command`
  (better than a single consolidation-only smoke story, though that matches current
  repo precedent).

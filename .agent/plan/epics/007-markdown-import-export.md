# EPIC 007 — Markdown import/export of the work graph

> **GAP-CLOSING PASS DONE — 2026-07-18.** EPIC 006 shipped (@e062b40, `npm run
verify` green); the design (B1–B18) is ratified; the consolidation /debate's
> ~14 gaps are resolved and folded into the Goal / Verification Gate / Stories /
> Non-goals below (6 needed an Ulrich ruling — see `## Debate resolutions`; the
> rest were spec-work — see `## Consolidation debate`). The Proof now runs a
> real `--create` and asserts with `test`/`grep` under `set -euo pipefail`;
> export returns a `GraphPackage` (CLI writes it); CAS is a repository port op;
> the hook covers every mutation path; apply preflight-classifies, validates the
> merged graph, and rewrites created files with ids. This epic invents ONE small
> domain rule (B12 single-line) + `applyTaskSpec`/`reparentTask` and otherwise
> reuses EPIC 002–006 surfaces. FIVE /debate rounds + Ulrich rulings are folded
> in; the manifest splits `files` (delete eligibility) from `nodes` (CAS
> snapshot), and create is made idempotent by a durable `(packageId, kind, ref)
→ (id, creationSha)` row. Design has converged — residual debate findings are
> story-implementation granularity, to be pinned per Story/Task at expansion.
>
> **Load-bearing invariants (from the rulings):** DB is the sole authority;
> export = projection, import = proposal. On-disk file/dir layout is COSMETIC
> — identity is the frontmatter `id`, parentage is the frontmatter parent
> REFERENCE (B18). Concurrency is a per-row `sha256` optimistic-lock token
> (B4); spec mutation is pending-only (B2/B3); `context` (resource bindings)
> is OUT of scope (B3, Ulrich 2026-07-18).
>
> **Executor rename owned by EPIC 008 (Ulrich, 2026-07-18).** The task field is
> being renamed `Task.agent → Task.executor` (CLI `--executor`,
> `ExecutorCatalog`); this epic's format currently shows `agent:` / `--agent`.
> Do NOT independently rename it here — **EPIC 008 owns the `agent → executor`
> rename across this import/export flow** (frontmatter key, CLI flag, Proof) as
> part of its executor-rename migration. This epic still owns its own `sha256`
> migration (one of its first stories); 008 owns the executor-rename migration.

## Goal

A human + Claude Code can author an Initiative → Objective → Task graph as
friendly markdown files, `import` them into the SQLite database, and `export`
an existing initiative back to markdown for review and re-editing. The markdown
is a **projection** (export) and a **proposal** (import), never a peer store:
the database stays the single source of truth for execution, exactly like the
EPIC 006 `import resource` path. The format decomposes 1:1 into the existing
task **spec** fields (`title`, `instructions`, `ac`, `agent`, `verification`,
`dependencies`) and feeds the existing `renderTaskPrompt` — **no new prompt
path and no new prompt field**. Resource `context` (credential / ai_provider /
repository / filesystem bindings) is runtime configuration and is deliberately
NOT part of import/export (B3). This is the friendly front-door that lets a
graph authored with Claude Code be executed by the pi agents from EPIC 006.

## Verification Gate

Gates: `npm run verify`
Proof: (`set -euo pipefail` makes every step assert — a failed command aborts
the block. Real `test`/`grep` assertions replace prose comments; expected
FAILURES are checked with `if ! …; then` so exit 1 does not mask them.)

```bash
set -euo pipefail
export KANTHORD_DB="$(mktemp -d)/kanthord.db"
node src/main.ts db migrate
PROJECT=$(node src/main.ts create project --name demo)
jlen(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).length))'; }

# ---------- CREATE MODE (B2/B5/B6): author a graph as markdown, import --create.
SRC="$(mktemp -d)/oauth"; mkdir -p "$SRC/backend" "$SRC/frontend"
printf -- '---\nkind: initiative\nref: oauth\nname: oauth\n---\n' > "$SRC/oauth.md"
printf -- '---\nkind: objective\nref: backend\ninitiative: oauth\nname: backend\n---\n' > "$SRC/backend/backend.md"
printf -- '---\nkind: objective\nref: frontend\ninitiative: oauth\nname: frontend\n---\n' > "$SRC/frontend/frontend.md"
cat > "$SRC/backend/implement-api.md" <<'MD'
---
kind: task
ref: implement-api
objective: backend
title: implement api
agent: generic@1
---
# Instructions
Implement POST /oauth/token
# Acceptance Criteria
- [ ] returns 200 for valid creds
MD
cat > "$SRC/backend/deploy.md" <<'MD'
---
kind: task
ref: deploy
objective: backend
title: deploy
agent: generic@1
depends-on: [implement-api]
---
# Instructions
Deploy the backend
# Acceptance Criteria
- [ ] health check green
MD
node src/main.ts import graph "$SRC" --create --project "$PROJECT"
INITIATIVE=$(node src/main.ts list initiative --project "$PROJECT" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s)[0].id))')
test "$(node src/main.ts list initiative --project "$PROJECT" --json | jlen)" = "1"     # exactly 1 initiative
test "$(node src/main.ts list objective  --initiative "$INITIATIVE" --json | jlen)" = "2"  # backend + frontend
test "$(node src/main.ts list task       --initiative "$INITIATIVE" --json | jlen)" = "2"  # implement-api + deploy
grep -qE '^id: [0-9A-HJKMNP-TV-Z]{26}$' "$SRC/backend/implement-api.md"  # B1: --create REWROTE the SRC file in place with its assigned ULID

# ---------- EXPORT (pending-only, B13) + ID HANDOFF (B1) ----------
OUT="$(mktemp -d)/export"
node src/main.ts export initiative "$INITIATIVE" --out "$OUT"
PKG="$OUT/oauth"
test -f "$PKG/oauth.md" && test -f "$PKG/backend/implement-api.md" && test -f "$PKG/.kanthord-export.json"
# a created file now carries its assigned ULID (uppercase Crockford) in frontmatter:
grep -qE '^id: [0-9A-HJKMNP-TV-Z]{26}$' "$PKG/backend/implement-api.md"
TASK_API=$(grep -E '^id: ' "$PKG/backend/implement-api.md" | awk '{print $2}')

# ---------- APPLY: edit a task, CAS update, ASSERT the change landed ----------
printf -- '- [ ] rejects bad creds with 401\n' >> "$PKG/backend/implement-api.md"
APPLY_OUT="$(mktemp)"
node src/main.ts import graph "$PKG" --apply --initiative "$INITIATIVE" > "$APPLY_OUT" 2>&1
grep -qE '(^|[^0-9])1 updated' "$APPLY_OUT"
grep -qE '(^|[^0-9])4 unchanged' "$APPLY_OUT"   # exactly: initiative + 2 objectives + deploy — summary covers ALL node types (B14/TS1)
test "$(node src/main.ts list task --initiative "$INITIATIVE" --json | jlen)" = "2"   # no dup
node src/main.ts get task --id "$TASK_API" --json | grep -q 'rejects bad creds with 401'  # new ac
node src/main.ts get task --id "$TASK_API" --json | grep -q 'returns 200 for valid creds' # old ac kept

# ---------- ID-LESS CREATE during --apply, then re-apply proves NO DUP (B1) ----------
# The PKG is an EXPORT, so existing nodes are ULID-based (ruling 2026-07-18:
# export = ULID-as-ref). A NEW hand-added node uses its OWN slug ref
# (create-new = slug-ref) but references EXISTING nodes by their ULIDs.
BACKEND=$(node src/main.ts list objective --initiative "$INITIATIVE" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).find(o=>o.name==="backend").id))')
cat > "$PKG/backend/write-tests.md" <<MD
---
kind: task
ref: write-tests
objective: $BACKEND
title: write tests
agent: generic@1
depends-on: [$TASK_API]
---
# Instructions
Add unit tests for the token endpoint.
# Acceptance Criteria
- [ ] covers valid and invalid credentials
MD
node src/main.ts import graph "$PKG" --apply --initiative "$INITIATIVE" 2>&1 | grep -qE '(^|[^0-9])1 created'
grep -qE '^id: [0-9A-HJKMNP-TV-Z]{26}$' "$PKG/backend/write-tests.md"   # apply REWROTE it with an id (handoff)
node src/main.ts import graph "$PKG" --apply --initiative "$INITIATIVE" 2>&1 | grep -qE '(^|[^0-9])0 created'  # re-apply: NO duplicate
test "$(node src/main.ts list task --initiative "$INITIATIVE" --json | jlen)" = "3"    # implement-api, deploy, write-tests

# ---------- REPARENT via frontmatter (B18/B14), same initiative ----------
FRONTEND=$(node src/main.ts list objective --initiative "$INITIATIVE" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).find(o=>o.name==="frontend").id))')
perl -0pi -e "s/^objective: .*/objective: $FRONTEND/m" "$PKG/backend/deploy.md"   # editing the frontmatter parent ULID reparents (B18); moving the file would not
node src/main.ts import graph "$PKG" --apply --initiative "$INITIATIVE" 2>&1 | grep -qE '(^|[^0-9])1 updated'
node src/main.ts list task --initiative "$INITIATIVE" --objective "$FRONTEND" --json | grep -q '"title":"deploy"'

# ---------- GUARDED DELETE-MISSING (S2/RB1/RB2): review the plan, then confirm ----------
rm "$PKG/backend/deploy.md"
node src/main.ts import graph "$PKG" --apply --initiative "$INITIATIVE" --dry-run 2>&1 | grep -qiE 'missing.*deploy'
test "$(node src/main.ts list task --initiative "$INITIATIVE" --json | jlen)" = "3"   # dry-run changed nothing
# --delete-missing WITHOUT confirmation: prints the deletion PLAN, deletes NOTHING (review step).
# stdin from /dev/null so the non-interactive path is tested even when pasted into a TTY (no y/N prompt).
node src/main.ts import graph "$PKG" --apply --initiative "$INITIATIVE" --delete-missing < /dev/null 2>&1 | grep -qiE 'would delete|delete plan'
test "$(node src/main.ts list task --initiative "$INITIATIVE" --json | jlen)" = "3"   # still nothing deleted
# --confirm-delete: removes the (pending, baseline-matching) deploy task in the apply UnitOfWork
node src/main.ts import graph "$PKG" --apply --initiative "$INITIATIVE" --delete-missing --confirm-delete 2>&1 | grep -qiE '(^|[^0-9])1 deleted'
test "$(node src/main.ts list task --initiative "$INITIATIVE" --json | jlen)" = "2"   # deploy removed; implement-api + write-tests remain

# ---------- CONFLICT via sha256 CAS (B4): drift the DB, re-apply the stale PKG ----------
CONFLICT_OUT="$(mktemp)"
OUT2="$(mktemp -d)/export2"
node src/main.ts export initiative "$INITIATIVE" --out "$OUT2"
printf -- '- [ ] also rejects an expired token\n' >> "$OUT2/oauth/backend/implement-api.md"
node src/main.ts import graph "$OUT2/oauth" --apply --initiative "$INITIATIVE" 2>&1 | grep -qE '(^|[^0-9])1 updated'   # bumps implement-api's DB sha
# PKG's stored baseline for implement-api is now stale. The conflict is caught in
# PREFLIGHT (before any write), so the apply exits 1 having mutated NOTHING (this
# proves conflict REJECTION; post-mutation rollback is proven by the hermetic
# real-SQLite late-failure test in the Stories, which fakes cannot cover).
if node src/main.ts import graph "$PKG" --apply --initiative "$INITIATIVE" > "$CONFLICT_OUT" 2>&1; then
  echo "PROOF FAILED: stale apply should have exited non-zero"; exit 1
fi
grep -qiE 'implement-api|implement api' "$CONFLICT_OUT"
grep -qiE 'drift' "$CONFLICT_OUT"
grep -q "$PKG/backend/implement-api.md" "$CONFLICT_OUT"   # sourcePath cited (B7/B15)
node src/main.ts get task --id "$TASK_API" --json | grep -q 'also rejects an expired token'  # DB unchanged by the rejected apply
echo "PROOF OK"
```

## Stories

(Bullets = capabilities; the S1 vertical-slice plan reslices them into
Story/Task files under `.agent/plan/stories/007-markdown-import-export/`.
Every referenced ruling B2–B18 is in the decision-log sections below.)

- **Domain: single-line rule + `applyTaskSpec` + `reparentTask` + requiredness
  (B2/B9/B11/B12/B17).** New rule: `title`, each `ac` item, each `verification`
  item are **single-line, non-empty** (`instructions` stays multi-line) —
  enforced in `newTask` and a new **pending-only** `applyTaskSpec(task, spec)`
  (PATCH: absent = unchanged, present = replace, empty = clear only where the
  domain allows) throwing `TaskSpecLockedError` (mirrors `DependenciesLockedError`;
  rejects every non-`pending` status incl. `failed`). **`reparentTask(task,
objectiveId)`** is a separate pending-only domain op (B9 — reparent must not
  bypass the lifecycle rule). **Requiredness (B11):** required CREATE fields =
  title + instructions + ac; absent `agent` defaults to `generic@1`; an absent
  `# Verification` section = unset, an **empty** one = explicit clear. Updates
  the existing `create-task` tests the single-line rule breaks (B17).
- **Per-row `sha256` token + hook on EVERY mutation path (B4/B6/B12/B13).**
  Migration 6 adds `sha256 TEXT NOT NULL` to `initiatives`/`objectives`/`tasks`
  (greenfield, no backfill). ONE shared canonicalizer over a **normative field
  list + byte encoding** (B12): task = `title|instructions|ac|agent|verification|
dependencies(SET)|objectiveId|status`, objective/initiative = `name|parentRef`;
  fixed key order, ordered lists vs canonicalized dep sets, defined `undefined`
  encoding + separators. An **application write-hook** stamps the token on
  **every** repo mutation — `save`/`saveAll`/**`setDependencies`**/`reparentTask`
  /status transitions (B6 — a missed path is the same fail-unsafe bug that
  killed triggers); a test asserts each path bumps the token. NOT DB triggers.
- **Format spec + parser → `GraphPackage` DTO (B3/B6/B7/B18).** Committed spec
  doc + a CommonMark-AST parser **in the CLI adapter** (B8). Frontmatter (fixed
  key order) → identity + parent ref; `# Instructions`/`# Acceptance Criteria`
  (`- [ ]`)/`# Verification` (`sh` fence). Layout cosmetic (B18); typed refs —
  case-sensitive uppercase ULID vs lowercase `^[a-z0-9][a-z0-9-]{0,63}$` (B6).
  Returns the transport-neutral **`GraphPackage`** with per-node `sourcePath`
  (B7); the use case never imports the codec.
- **Export use case + CLI (B4/B5/B13/B16/B18).** The **use case returns a
  `GraphPackage`** (pending tasks only — B13); the **CLI adapter serializes +
  writes** the cosmetic tree + read-only `INDEX.md` + `.kanthord-export.json`
  `{ initiativeId, packageId, formatVersion, digestAlgorithm, nodes:{id:sha256}, files:[id…],
refToId:{objectives:{ref:id},tasks:{ref:id}} }` (B5 — the use case never touches the filesystem/codec).
  `nodes` is a **full snapshot** of initiative + objectives + tasks (TS1) for
  CAS/drift; **`files`** lists exactly the ids written as files — the SEPARATE
  file-membership set that delete-eligibility uses (TB1), so a node that never
  had a file is never a delete candidate; **`refToId`** is **kind-scoped**
  (objective vs task namespaces are separate — B6, so a flat map cannot collide)
  and mirrors the DB idempotency rows (TB2, round-4 fix). Exported refs (B4): each
  node's frontmatter carries its `id`; `depends-on`/parent use **ULIDs**;
  package-local `ref`s are (re)generated from slugs and de-duplicated with a
  short-id suffix, and are stable within one package only. Per-node sha is
  **copied from the DB row**, never recomputed. Query-side, never mutates.
- **Import — create mode (B5/B6/B10).** `import graph <dir> --create --project
<id>` rejects any persisted `id`, resolves refs, runs `validateGraph`, and
  reuses `StoreGraph` to build the graph in one UnitOfWork, assigning ULIDs.
  Import NEVER creates a project. On success, **rewrites the created files with
  their assigned ids** (B1 handoff, temp-file + atomic rename).
- **Import — apply mode + CAS via a port (B1/B4/B7/B8/B9/B10/B13/B14/RB4/RB5/RB6).**
  `--apply --initiative <id>` requires the package initiative id to match and
  verifies the ownership chain. **CAS is an explicit repository conditional-write
  port** (B8/RB4) covering every op — `compareAndApply` (task spec, incl.
  dependency replacement), conditional **rename** (initiative/objective; Objective
  ops live on `InitiativeRepository`, which has no sibling), conditional
  **reparent**, conditional **delete** — each `(id, expectedSha[, payload]) →
{applied|conflict, freshSha}`; the use case issues no raw SQL. **One
  `BEGIN IMMEDIATE` UnitOfWork** (RB5): a **full preflight-classify** reads every
  package node's current sha + **live status** BEFORE any write (so the scan
  never sees its own writes, B7; labels `locked` vs `drifted`); only **mutated**
  nodes are CAS-checked (B13). **Merged-graph validation (B10):** `validateGraph`
  runs over the package MERGED with omitted DB nodes. Classification + summary
  cover **all node types** (B14). Any conflict → rollback → itemized report
  (exit 1). **Create idempotency is guaranteed by SQLite, not the filesystem**
  (TB2 + round-5): the create transaction records an idempotency row keyed by a
  durable **`packageId`** (a ULID minted at `--create`, stored in the manifest —
  so two _different_ packages reusing a ref never collide) — `(packageId, kind,
ref) → (id, creationSha)`, `UNIQUE(packageId, kind, ref)`, `FK→node ON DELETE
CASCADE` (deleting a node drops its mapping, so a later id-less node may reuse
  the ref), reached via an **explicit repository port op** (lookup/reserve), all
  committed atomically WITH the create. A re-apply consults it before creating;
  a matched retry **CAS-checks against the stored `creationSha`** (a mapped node
  that drifted since creation is a conflict, never a blind update). No dependency
  on any post-commit write. On
  success: rewrite created files with ids + **full re-snapshot** manifest (RB3)
  with `files` + a kind-scoped `refToId` mirror (TB1/B2). A post-commit rewrite
  failure (RB6) still emits a non-retryable "re-export" error, but correctness
  no longer relies on it — the DB idempotency row already prevents duplication.
- **Drift report, dry-run + confirmed delete (B5/S2/RB1/RB2).** `--dry-run` runs
  the same classifier without applying (created/updated/unchanged/**missing**/
  drifted/locked). Omission never auto-deletes; `missing` distinguishes a
  **removed pending file** from a **non-pending node not exported** (expected).
  **`--delete-missing`** is gated by REVIEW + CONFIRMATION: it prints the
  deletion **plan**, and executes only on **explicit confirmation** — the
  `--confirm-delete` flag OR a positive `y/N` on a TTY; non-interactive without
  the flag deletes nothing (TB4, one contract). Eligible = a node in the manifest
  **`files`** set (it had a file — TB1) whose file is now absent, whose DB sha
  still matches, and is a **pending task**; a missing **objective** is deleted
  only if it ends up **empty**, and its delete likewise requires manifest
  membership + expected objective sha + an atomic emptiness check (TB5); the
  initiative never. A **drifted** delete-candidate is **skipped-with-warning**
  (reported, not deleted, does NOT abort the spec apply — TB3). A node never in
  `files` (created after export/elsewhere) is never a candidate. Ineligible
  cases reported `missing (not deletable: <reason>)`. CAS scope for the spec apply is package-present nodes
  only, so an omitted node's drift never blocks a non-delete apply (S2).
- **Named errors + provenance (B7/B15).** Distinct, richly-contextual errors
  (each carries `sourcePath` + node id/ref + expected-vs-actual):
  `CrossInitiativeError`, `UnknownNodeError`, `TaskSpecLockedError`, duplicate-ref,
  and the reused `validateGraph` family (unresolved-dep / self-dep / cycle).
- **Golden round-trip + rollback + context-preservation (B9/B10/B16/S1).**
  Hermetic tests: (1) codec idempotence `serialize(parse(x)) === x` on canonical
  bytes; (2) a hand-authored non-canonical file imports to the correct graph
  (SEMANTIC equality); (3) a real-SQLite test that fails LATE and asserts full
  rollback; (4) **context preservation (S1)** — an apply that changes spec +
  dependencies leaves `task_context` bindings byte-for-byte untouched.
- **Boundary cases — DEFINED (S4/RB7).** Each has a locked behavior + test:
  omitted objective file → reported `missing` (deletable only per the
  empty-objective rule), **not an error**; empty objective (no tasks) → valid,
  round-trips; empty initiative (no objectives) → valid, exports just the
  initiative file; a task whose `objective:` ref resolves to a **persisted
  objective absent from the package** → allowed (valid DB parent); a ref
  resolving to **neither package nor DB** → `UnknownNodeError`; a **duplicate
  ref** → named error citing both files; **unknown agent** → `UnknownAgentError`;
  a frontmatter value matching **neither ULID nor ref grammar** → named parse
  error citing the file.

## Non-goals

- **Not a second source of truth, not live config.** DB stays authoritative for
  execution; the file is a projection + proposal, mirroring EPIC 006's
  `import resource` stance. On-disk layout is cosmetic (B18).
- **No new prompt field or prompt path.** The format decomposes into the
  existing task **spec** fields and feeds `renderTaskPrompt`. 007 does add a
  small domain surface (the B12 single-line rule, `applyTaskSpec`, and the
  `sha256` column) — but no new _prompt_ field. Any authoring need for a prompt
  field the domain lacks is a separate, separately-debated change.
- **`context` (resource bindings) is out of scope.** Credential / ai_provider /
  repository / filesystem bindings are runtime config, never exported/imported/
  hashed (B3). "Add a resource to a live task" is EPIC 009's runtime feature.
- **No delete-by-OMISSION; deletion is opt-in + guarded.** Omission never
  deletes — a missing node is reported, and only the explicit `--delete-missing`
  flag removes it, **pending-only** (never a running/completed task). Unguarded
  or non-pending deletion stays out of scope.
- **No git-style 3-way merge.** Conflicts (drifted / locked / unresolved ref /
  cross-initiative) are surfaced and rejected for the human to resolve, not
  auto-merged.
- **No cross-initiative moves or dependencies via import.** A package is one
  initiative (B5); `depends-on` resolves same-initiative only (B6); a foreign
  parent/dep ref is a named error. File/directory moves never reparent anything
  (B18) — only the frontmatter parent ref does.
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

## Landed vs pending EPIC 006 surfaces (checked 2026-07-17)

Landed in the working tree (mid-EPIC 006 — re-verify at expansion, B1):

- Task fields `agent` / `instructions` / `ac` / `verification?` +
  `InvalidTaskFieldError` (`src/domain/task.ts`); migration 5 (task columns,
  `awaiting_confirmation` + `discarded` statuses, `task_results`, new event
  types).
- `AgentCatalog.has` create-time gate — an unknown ref is a one-line
  `error: unknown agent: <ref>` (`UnknownAgentError`,
  `src/agent-runner/port.ts`).
- CLI: `create task` requires `--instructions` + `--ac` (repeatable), accepts
  `--agent` (default `generic@1`), repeatable `--verification` and
  `--depends-on`; `get task --id`; `--json` on get/list/events.
- Divergence found (feeds B1/B2): domain `newTask` keeps the new fields
  OPTIONAL (`undefined` allowed so pre-006 callers compile; explicit empty
  values throw) — requiredness is enforced at the CLI boundary only. 007's
  import path must enforce requiredness itself, or the B2 domain decision
  must settle where enforcement lives.

Still pending in EPIC 006 (007 consumes these — never author against the
draft): `import resource` YAML (S09 — the transactional import pattern 007
mirrors), escalation use cases + `approve`/`reject` CLI (S07 — the
field-locking lifecycle states), `renderTaskPrompt` + PiAgentRunner (S05),
TaskResult persistence surfaces (S06).

### B1 re-audit (2026-07-18 — EPIC 006 SHIPPED @ e062b40, `npm run verify` green)

All the "still pending" surfaces above have LANDED and are verified. Concrete
anchors + divergences the ruling rewrite must honor:

- `ImportResources` use case (`src/app/resource/import-resources.ts`) + CLI
  `import resource` (`src/apps/cli/import.ts`, router.ts). Runs in ONE
  `UnitOfWork.transaction(fn)` (`src/storage/port.ts`, `SqliteUnitOfWork` =
  `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`, nested = error). Error shape:
  `ImportValidationError(index /*1-based*/, entryName)`. 007 mirrors this.
- Escalation: `ApproveTask` / `RejectTask` (`src/app/task/*.ts`) + `approve
task` / `reject task` CLI. `reject` takes `--resolution retry|discard`.
- `renderTaskPrompt(task)` (`src/agent-runner/task-prompt.ts`) renders title/
  instructions/ac/verification. `PiAgentRunner` (`src/agent-runner/pi.ts`).
- Repos: `SqliteTaskRepository` (`save`/`saveAll`/`saveTaskContext`/
  `saveTaskResult`), `SqliteInitiativeRepository` (`save`/`saveObjective` —
  **Objective has no own repo**). B4 sha256 write-hook attaches here.
- Migrations top out at **version 5** (`epic-006-task-spec-and-results`); 007's
  slot is **6** (B4 confirmed).
- **No sha256 / digest / row-version column exists anywhere** — B4 clean slate
  confirmed.

DIVERGENCES from the ratified rulings (fold into the body rewrite):

1. **`context` is OUT OF SCOPE for 007 (Ulrich, 2026-07-18).** `task_context`
   is not prose — it is the task's RESOURCE BINDINGS (`(task_id, type,
resource_id)`, type ∈ credential/ai_provider/repository/filesystem),
   configured at RUNTIME inside the system. There is nothing to author for it
   outside the program, so 007 exports/imports the **task spec only**
   (title/instructions/ac/agent/verification/dependencies). Consequences:
   context is removed from B3's writable allowlist; the B4 sha256 hash covers
   **2 tables** (`tasks` spec cols + `task_dependencies`, plus status), NOT
   `task_context`; the write-hook fires on `save`/`saveAll`/`setDependencies`,
   NOT on `saveTaskContext`; the earlier "D1 second write path" idea is
   DROPPED. A context change never blocks a spec import (import does not touch
   context). Any "add a resource to a live task" need is EPIC 009's runtime
   binding feature, not markdown import.
2. **`failed` is a 6th status** (`pending|running|completed|failed|
awaiting_confirmation|discarded`). The lock is `status !== "pending"`
   (mirrors existing `assertDependenciesEditable`), so `failed` is covered —
   list-wording fix only.
3. **Domain leaves new spec fields OPTIONAL** (`newTask` allows `undefined`;
   requiredness is CLI-only). B12's single-line/non-empty rule is the domain
   change that closes this — added to `newTask` + `applyTaskSpec`.
4. `TaskSpecLockedError` is net-new (only `DependenciesLockedError` exists to
   mirror). `getTaskResult`/`saveTaskResult` are on the concrete
   `SqliteTaskRepository`, not the `TaskRepository` port.

## Blocker log (ALL RESOLVED + ratified 2026-07-18 — rationale trail)

Raised during a second debate (2026-07-17, opencode/gpt-5.6) when a draft story
list was attempted early. Each MUST be decided before `/work` gets Story/Task
files — authoring on top of an unsettled answer bakes in a guess.

**Resolution status (2026-07-17 — RATIFIED by Ulrich):** B2, B3, B4, B5, B6,
B12 are debate-resolved AND ratified by Ulrich (2026-07-17) — see
`## Ruling-resolution round` at the end of this file. B4 and B6 were amended
during ratification (B4: per-row sha256 CAS + migration 6, app write-hook;
B6: case-sensitive ULID/ref disambiguation). The draft body above is NOT yet
rewritten to match the rulings — that mechanical rewrite is the first
expansion step, gated on B1 (EPIC 006 shipping). B1, B7–B11, S1 are execution
directives applied at expansion, not open forks.

- `B1 - prematurity - Do not expand stories until EPIC 006 has shipped and its
surfaces are re-verified.` Every task's `Requires` points at an EPIC 004/005/006
  surface (repo methods, task columns, event types, CLI table, UnitOfWork). Audit
  the _actual_ mutation / transaction / event / CLI surfaces first, then author.
  First concrete audit hit (2026-07-17): domain-vs-CLI requiredness divergence —
  see the landed-surfaces section above.
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
  same lane caveat as EPIC 004 S05; the next free slot after EPIC 006's
  migration 5 is 6, but the number is assigned only when an epic actually
  starts — coordinate ordering with 008's workflow ledger and 009's binding
  tables).
- `B5 - define the import target + modes - Split create-graph vs apply-proposal
explicitly.` `initiative.md` with no `id` → create-graph under a pre-existing
  `project` (ULID; import NEVER creates a project); with an `id` → apply-proposal
  to that initiative; an `id` from a different initiative → `CrossInitiativeError`.
  State behavior for unknown objective/task ids in an "existing" package.
- `B6 - decide ref namespacing - `ref`is package-scoped, not file-local (cross-file`depends-on` must resolve).` Fix: two namespaces (objective refs, task refs), each
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
(fixed frontmatter key order, LF, `- [ ] `checklist, trailing newline); the
regression anchor is`serialize(parse(bytes)) === bytes` and a stable
export→import→export`, not `deepEquals`.
- `B10 - prove rollback on real SQLite - At least one integration test must fail
LATE (after early writes) and assert full rollback` — fakes cannot prove atomicity
  of the one-UnitOfWork claim.
- `B11 - cover the structural edge cases - objectives with no tasks, initiative with
no objectives, renamed files, renamed/duplicate refs, moved task files, changed
objective ownership, omitted objective files, title changes` — each needs a
  defined behavior + test before authoring.
- `B12 - verification-field-coverage - D6 (2026-07-17) added Task.verification
AFTER this draft; the format must carry it or the projection is unfaithful
(B3's own completeness rule).` The Goal field list is updated; the concrete
  representation (frontmatter list vs a `# Verification` body section, one
  command per item) is decided together with B3's mutation model.
- `S1 - prefer vertical-slice e2e assertions - Each slice carries its own failing
end-to-end assertion; a final task only consolidates the runnable Proof command`
  (better than a single consolidation-only smoke story, though that matches current
  repo precedent).

## Ruling-resolution round (2026-07-17, /debate via opencode/gpt-5.6 — RATIFIED by Ulrich 2026-07-17)

Two debates (≤3 items each: B2/B3/B5, then B4/B6/B12), all RATIFIED by Ulrich
on 2026-07-17. B4 and B6 carry Ulrich amendments (marked inline). The draft
body above still gets its mechanical rewrite as the first expansion step,
gated on B1 (EPIC 006 shipping).

- `B2 - resolved - guarded patch mutation - Pending-only domain mutation
ships (create-only import rejected: the export→edit→re-import loop IS the
epic). Shape: applyTaskSpec(task, spec) with PATCH semantics — absent field
= unchanged; explicit empty = clear ONLY where the domain allows
(verification clears; instructions/ac can never be empty); present =
replace. New TaskSpecLockedError (DependenciesLockedError family).
Dependency edits route through graph-level validation (unknown/self/cycle),
never the task mutator alone. Status is re-checked INSIDE the import
transaction (a worker can claim between parse and apply).`
- `B3 - resolved (AMENDED 2026-07-18 by Ulrich: context out of scope) -
writable allowlist, not projection parity - Import writes an explicit
versioned allowlist: task title/instructions/ac/agent/verification/
dependencies — ALL pending-only (title feeds the rendered prompt, so it is
spec, not decoration). CONTEXT IS EXCLUDED: task_context holds runtime
resource bindings, configured inside the system, with nothing to author
outside it — 007 imports/exports the task SPEC only. initiative/objective
names follow the same pending-only discipline (rename only while nothing
beneath has started — the audit-history concern beat display-label
convenience). Reparenting via the frontmatter parent REFERENCE is now
ALLOWED, pending-only (AMENDED 2026-07-18 by Ulrich — see B18): a task whose
frontmatter `objective:` points at a different objective OF THE SAME
INITIATIVE is moved; pointing at a foreign initiative stays CrossInitiativeError
(B5 keeps a package = one initiative). File/directory MOVES are cosmetic and
never reparent anything. dependencies compare + export as a
canonicalized set; ac/verification stay ordered lists. Runtime fields and
resource bindings are never importable input.`
- `B5 - resolved - explicit CLI modes - Mode is never inferred from
frontmatter id presence (a deleted id line must not silently create a
duplicate graph): import graph --create --project <id> XOR --apply
--initiative <id>; the document id VALIDATES the requested operation, never
selects it. Create mode rejects any persisted id in the package. Apply
mode requires the package initiative id to match, verifies the full
ownership chain (initiative→objective→task→dependency endpoints), creates
id-less nodes via refs, rejects unknown ids (UnknownNodeError) and foreign
ids (CrossInitiativeError). "missing" in the drift report is informational
only. Dry-run pins the same per-node sha256 baselines as apply and runs the
same CAS full-scan conflict classifier (B4), labeling new nodes by ref,
never provisional ULIDs.`
- `B4 - resolved (AMENDED 2026-07-17 by Ulrich) - per-row sha256 CAS token,
app-maintained - Supersedes the earlier "single whole-package baseDigest,
no migration" outcome. The counter stays REJECTED (bump-on-every-path is
convention, not enforcement; a missed bump fails unsafe). New model:
(a) A per-row sha256 column on initiatives, objectives, tasks
    (migration 6 — this OVERTURNS the earlier "no migration" note).
    sha256 is a DB-internal version token: the hash of the node's
    canonical aggregate INCLUDING status, so a pending->running change
    bumps the token (hence NO separate status predicate is needed in the
    CAS WHERE). For a Task the hashed aggregate spans TWO tables — the
    tasks spec columns + task_dependencies (task_context is EXCLUDED —
    resource bindings are out of 007's scope, Ulrich 2026-07-18).
(b) The token is maintained by an APPLICATION write hook in the
    repository/UnitOfWork, NOT by DB triggers (S1, Ulrich 2026-07-17).
    Reason: the hashed Task aggregate spans 2 tables; a tasks-row trigger
    does not fire on task_dependencies changes, so a correct trigger
    design needs a multi-trigger web reaching back to the parent,
    which fails UNSAFE if any trigger is missing/wrong (stale token ->
    CAS matches -> silent override). The repo already assembles the whole
    aggregate on every write, so it computes ONE canonical string and
    stamps sha256 in the same transaction — one place, fails safe. May
    reuse a registered db.function("sha256", …) UDF invoked explicitly
    (UPDATE … SET sha256 = sha256(?)) or node:crypto; equivalent.
(c) .kanthord-export.json = { initiativeId, formatVersion,
    digestAlgorithm: "sha256", nodes: { <id>: <sha256> } } — a per-node
    map, not one whole-package digest. The exporter COPIES each row's
    current sha256 into the manifest; it NEVER recomputes the hash (so the
    token is produced in exactly one place — the repo hook — killing any
    two-canonicalizer divergence).
(d) Import-to-update (--apply): per node, optimistic CAS
    UPDATE … SET …, sha256=<new> WHERE id=? AND sha256=<import-sha256>
    RETURNING sha256. A 0-row result means the row drifted since export
    (spec OR status changed). ANY 0-row update aborts: run a full scan
    comparing manifest shas vs current DB shas + live values to CLASSIFY
    each conflict (drifted / locked / missing / new), roll back the whole
    UnitOfWork, print an itemized conflict report, exit 1. The user
    decides (re-export to refresh the baseline, drop the edit, or wait) —
    never auto-merged.
(e) No conflicts -> apply all in one transaction, rewrite the manifest
    with the fresh per-node shas. Idempotent: unchanged content ->
    unchanged sha -> CAS matches -> "N unchanged". Format changes bump
    formatVersion (explicit, rare re-export). Manifest-write failure
    AFTER commit: warn; the stale manifest then fails SAFE next time
    (StaleExportError; re-export is the fix).`
- `B6 - resolved (AMENDED 2026-07-17 by Ulrich: case-sensitive
disambiguation) - typed refs, strict grammar - Two package-scoped
namespaces (objective refs, task refs); a duplicate ref names both files.
depends-on resolves ONLY to Tasks of the SAME initiative (cross-initiative
dependencies stay CLI-only). ULID grammar locked: 26 uppercase Crockford
chars (no I/L/O/U), matched CASE-SENSITIVELY ^[0-9A-HJKMNP-TV-Z]{26}$ — NOT
case-insensitive (the earlier "normalized to uppercase" wording is
withdrawn: it let a 26-char lowercase Crockford-valid string satisfy BOTH
grammars). ULID-shaped but unknown in the DB = error, never demoted to a
ref. Refs match lowercase-only ^[a-z0-9][a-z0-9-]{0,63}$. Because the
exporter emits ULIDs uppercase and refs are lowercase, the two sets are
provably DISJOINT by case — the shape decides ULID-vs-ref with no DB
lookup, so B6's "a ref can never be ULID-shaped" now actually holds.
Resolved dependencies run the normal domain checks (self-dep, cycles).
Documented tradeoff: exports carry ULIDs, so a package is a DB-tied
snapshot; porting = strip ids + --create.`
- `B12 - resolved - fenced sh block + single-line domain rule; JSON fence
rejected - "# Verification" holds ONE fenced sh block, one command per
line, adaptive fence length (longer backtick run when content contains
one). The debate's lossless objection (string[] items may embed newlines)
is answered in the DOMAIN, not the format: NEW rule — title, each ac item,
and each verification item are single-line strings (newTask +
applyTaskSpec validate; instructions stays multi-line prose); multi-line
logic belongs in a committed script the command calls. Empty fence =
explicit clear (patch semantics); empty-string commands are already
illegal, so no ambiguity remains. Fallback on record if Ulrich rejects the
domain rule: a canonical JSON array in a json fence (lossless but hostile
to hand-authoring).`

Worth noting (raised, not merged): collapsing CrossInitiativeError /
UnknownNodeError into one generic invalid-reference error — the
information-disclosure rationale is moot in a single-user local tool, and
two names are more actionable.

## Expansion decisions (2026-07-18, Ulrich — pre-authoring)

Settled with Ulrich just before the body rewrite, so story authoring does not
guess:

- `B13 - resolved - no backfill; greenfield - There is no real data yet, so
migration 6 simply ADDS the sha256 column to initiatives/objectives/tasks.
No in-migration backfill mechanism is built; the app write-hook stamps
sha256 on every save, and a fresh DB has no pre-existing rows to fill.`
- `B14 - resolved (AMENDED 2026-07-18 by Ulrich: hash the parent ref too) -
Domain shapes: Initiative { id, projectId, name }, Objective { id,
initiativeId, name } (paused is RUNTIME state via setPaused, not on the
entity — excluded like task status). Migration 6 adds sha256 to both tables.
Each node's hash covers its NAME and its PARENT REFERENCE (objective:
initiativeId; initiative: projectId; and task: objectiveId per B4), so a
reparent is a real change the CAS detects — this is why the whole row, not
just name, is hashed. Importable via frontmatter: name (all levels) and the
parent ref for a TASK (move to another objective of the same initiative,
pending-only). Objective parent (initiativeId) is fixed by the package's
single-initiative scope (B5); initiative projectId never moves (out of
scope). The rename/move-lock (B3 "only while nothing beneath has started")
is a SEPARATE graph check at apply time: reject if ANY descendant task has
left pending.`
- `B18 - resolved - frontmatter is authoritative; on-disk layout is cosmetic
(Ulrich 2026-07-18) - The export directory/file tree is only a convenient
on-disk representation: an initiative is a directory + a markdown file
carrying its name; an objective likewise (nested); a task is a single file
carrying its name. On IMPORT, file and directory names/locations are IGNORED
for identity and relationships. Identity = frontmatter id; parentage =
frontmatter parent REFERENCE (objective: on a task, initiative: on an
objective). Moving a file or renaming a directory means NOTHING; to reparent,
the user edits the frontmatter parent reference. Consequence: the B11 edge
cases "moved task files / renamed files / changed objective ownership" all
resolve by this one rule — layout is never consulted for meaning.`
- `B15 - resolved - keep both errors + rich debug context - CrossInitiativeError
and UnknownNodeError stay DISTINCT (two names are more actionable; the
info-disclosure worry is moot in a single-user tool). Furthermore EVERY
named import error carries detailed context for later debugging: sourcePath
(B7), the offending node id/ref, and expected-vs-actual where relevant.`
- `B16 - resolved - two independent canonical forms - (1) the MARKDOWN form
(byte-stable .md files, B9's export->import->export anchor, human-readable)
and (2) the SHA256 form (a deterministic hash of the DB ROW FIELDS —
title/instructions/ac/agent/verification/dependencies/status) are SEPARATE.
The sha hashes fields, never the .md bytes; the exporter COPIES the row's
sha into the manifest, never hashes the file. The byte-stable round-trip
test asserts on the .md content files ONLY; INDEX.md (generated read-only
view) and .kanthord-export.json (machine state, shas move with the DB) are
EXCLUDED from that assertion. CLARIFIED (Ulrich 2026-07-18): byte-stability
is a narrow CODEC property — serialize(parse(x)) === x holds only for x that
is ALREADY the exporter's canonical output. The normal flow is
export -> EDIT -> import, where the edited file DELIBERATELY differs; a
hand-edited / non-canonical file is CANONICALIZED on import, so a later
re-export reflects the canonical form, not the user's exact keystrokes. The
concurrency check never compares file bytes to anything — it compares the DB
row sha to the manifest baseline sha (both DB-side). So the golden test has
TWO distinct assertions: (1) codec idempotence on canonical bytes, and
(2) a hand-authored non-canonical file imports to the correct graph
(SEMANTIC equality, not byte equality).`
- `B17 - resolved - B12 single-line rule gets its own story/task - Adding the
single-line + non-empty rule (title, each ac item, each verification item)
to newTask is a domain change that may break existing create-task tests —
NOT purely additive. It gets a dedicated story/task in the expansion to
update newTask + the affected existing tests, sequenced before applyTaskSpec
depends on it.`

## Consolidation debate (2026-07-18, /debate opencode/gpt-5.6 — gaps to close before expansion)

A /debate on the consolidated four-section spec found ~14 execution-critical
gaps. Verdict: the high-level decisions (DB authority, spec-only import,
same-initiative reparenting) are sound, but the epic is NOT ready to expand —
it can duplicate created tasks, cannot yet express CAS through a hexagonal
port, and its Proof verifies neither create-mode nor rollback. Findings below;
the ones marked (RULING) need an Ulrich decision, the rest are spec work.

Data integrity / identity:

- `B1 - action:YES (RULING) - idless-node-identity - After --apply creates a
ref-only node, its file still has no id; the manifest maps only id->sha256,
so the NEXT apply can create a DUPLICATE. Decide the id handoff: (a) apply
rewrites created files with their assigned ids, or (b) a durable ref->id
map in the manifest. Also define recovery when the DB commit succeeds but
the file/manifest rewrite fails.`
- `S3 - action:YES - filesystem-failure-contract - Write markdown + manifest
via temp file + atomic rename; define exit status + recovery when the DB
commits but package rewrite fails (esp. after assigning ids). Ties to B1.`

CAS / concurrency / ports (hexagonal):

- `B6 - action:YES - cas-hook-not-one-hook - The sha256 story lists save /
saveAll but OMITS setDependencies, though dependency edits must refresh the
task token (the same missed-write-path risk that killed the counter). List +
encapsulate EVERY mutation path behind repo methods; test each bumps the
token.`
- `B7 - action:YES - cas-scan-sees-own-writes - Apply-early-writes then
late-0-row-CAS then full-scan means the scan observes the txn's OWN early
writes + new rows and can misclassify them as drift. Fix: full PREFLIGHT
under BEGIN IMMEDIATE (classify before mutating), or savepoint rollback
before classification, or explicitly separate planned-local writes from
external drift.`
- `B8 - action:YES - cas-port-contract-undefined - "UPDATE ... WHERE sha256=?"
names no owning port method; a use case cannot issue SQL and plain save()
cannot express a CAS result. Add explicit repository-port conditional-write
operations + result types (incl. dependency replacement, returned fresh
token).`
- `B13 - action:YES - locked-vs-drifted needs a LIVE status read - Folding
status into the token detects change but does NOT by itself distinguish
locked from drifted, and a task exported while ALREADY non-pending has a
matching token — so hash-match alone is not a lifecycle guard. The importer
must LOAD + check live status == pending inside the txn before mutating, and
the classifier reads live status to label locked vs drifted.`

Domain modeling:

- `B9 - action:YES - reparenting-bypasses-domain - applyTaskSpec does not cover
objectiveId, yet reparent is a pending-only command mutation; changing the
record directly bypasses the lifecycle rule. Add a domain op (reparentTask or
a graph-domain op) with the same pending check.`
- `B10 - action:YES - merged-graph-validation - Omission is allowed, so apply
may receive only PART of the initiative; dependency/cycle validation must run
on the package MERGED with omitted DB nodes. validateGraph on package files
alone can miss cycles/unresolved refs involving persisted omitted tasks.`
- `B11 - action:YES - requiredness-still-ambiguous - The single-line rule does
not make fields required. Define: required CREATE fields, apply PATCH
behavior, the default for absent agent, and whether an empty verification
section differs from an absent one.`
- `B12 - action:YES (RULING) - one normative hash field-list + encoding - B14
puts task objectiveId in the hash but B16's canonical field list omits it;
and the exact canonical byte encoding (undefined, ordered lists, dependency
SETS, separators) is unspecified. Pin ONE normative field list + encoding
for the token.`

Export layering + refs:

- `B4 - action:YES - exported-ref-resolution-undefined - The Proof uses
objective: backend and depends-on: [implement-api] (refs), but the export
story never says exported nodes RECEIVE refs or how refs are generated/kept
unique — cosmetic slugs cannot silently become semantic refs (conflicts with
B6's "export prefers ULIDs for depends-on"). Specify exported frontmatter:
refs vs ids, generation, uniqueness, stability.`
- `B5 - action:YES - export-layering-violation - B8 puts serialization in the
CLI adapter, but the export story says the USE CASE "writes" the tree — that
couples the use case to fs + codec. The use case should RETURN a GraphPackage;
the CLI adapter serializes + writes it.`

Proof (the wiring proof itself is weak):

- `B2 - action:YES - proof-omits-create-mode - The Proof never runs
import graph --create --project; create-mode wiring (a headline Story) is
unproven. Add a real --create run.`
- `B3 - action:YES - proof-is-mostly-comments - The Proof asserts almost
nothing (updated ac, blocked status, reparent, missing output, conflict
text, rollback are all COMMENTS); command; echo "exit=$?" makes the shell
succeed regardless of the expected failure. Replace comments with test
assertions + captured stdout/stderr; assert the final graph after the failed
apply.`
- `B14 - action:YES (RULING) - apply-summary-scope - The manifest covers
initiative+objectives+tasks but Proof summaries count only tasks
("1 updated, 1 unchanged" despite 5 nodes). Decide whether classification +
summaries cover ALL nodes or only tasks.`

Tests + boundary cases:

- `S1 - action:YES - context-preservation-test - "context out of scope" is
coherent only if apply NEVER clears/replaces task_context; add a real-SQLite
test that changes spec + dependencies while preserving bindings exactly.`
- `S2 - action:YES (RULING) - manifest-baseline-policy - Define whether omitted
nodes stay in the rewritten manifest and whether drift on an omitted node
blocks an unrelated apply ("missing is informational" implies NO — make the
per-node CAS wording match).`
- `S4 - action:YES - format-boundary-cases - Define behavior for: omitted
objective files, a task referencing a persisted objective absent from the
package, duplicate refs, unknown agent, empty initiative, empty objective,
and a frontmatter value matching NEITHER ULID nor ref grammar.`

### Debate resolutions (Ulrich, 2026-07-18)

- `B1 - resolved - id handoff = (a) - A successful --apply REWRITES each newly
created file with its assigned ULID in frontmatter (via temp file + atomic
rename, S3), so a re-apply matches by id and never duplicates. Define the
exit status + recovery if the DB commits but the file/manifest rewrite fails
(S3 filesystem contract).`
- `B12 - resolved - normative hash - The task hash INCLUDES objectiveId (a
reparent must be detectable). Pin ONE normative field list + canonical byte
encoding for the token (undefined handling, ordered lists, dependency SETS,
separators) as part of the format-spec story.`
- `B14 - resolved - all nodes - Classification + the apply summary cover ALL
node types (initiative/objectives/tasks), for a faithful report — not tasks
only.`
- `S2 - resolved - missing + guarded delete; omitted never blocks - CAS checks
ONLY the nodes present in (and mutated by) the package, so an omitted node's
drift NEVER blocks an apply. Missing nodes are reported; a NEW explicit,
guarded --delete-missing option removes them, PENDING-ONLY (never a running/
completed task), never automatic — this pulls the previously-deferred
--reconcile delete INTO 007 scope (update the non-goal). On success the
manifest re-snapshots all nodes.`
- `B13 - resolved - export only PENDING tasks - Export writes only pending
tasks, so every baseline is pending and a task that left pending by apply
time is always a CAS miss -> locked. Status STAYS in the hash (no reversal).
CAS only the nodes being MUTATED, so a background status change on an
unedited task never blocks. Consequence: export is a pending-work VIEW;
non-pending tasks show as "missing (non-pending, expected)" on re-import and
are distinguished in the drift report from a removed pending file; the
classifier reads live status to label locked vs drifted.`

## Confirming debate (round 2, 2026-07-18, /debate opencode/gpt-5.6 — NOT READY)

The gap-closing pass closed the original 14 as design statements, but the
confirming debate found a new cluster — most of it from the freshly-added
`--delete-missing`. Verdict: NOT READY TO AUTHOR until these are settled.

Design (mostly delete-missing fallout):

- `RB1 - action:YES - delete-missing-vs-CAS - --delete-missing mutates OMITTED
nodes, but the CAS policy excludes omitted nodes from checking. A blind delete
can erase a node with concurrent spec changes, or delete a task created after
export (no baseline). FIX: conditional delete must require manifest
membership + expected sha + live pending status; omitted drift stays
non-blocking only when deletion is NOT requested.`
- `RB2 - action:YES (RULING) - delete-missing-scope - Only tasks have pending
status; behavior for a missing OBJECTIVE is undefined (delete only tasks /
delete empty objectives / cascade pending tasks / reject). The initiative
itself is never deletable by an apply targeting it. Settle before authoring.`
- `RB3 - action:YES (RULING) - manifest re-snapshot policy - "re-snapshot all
nodes" (ruling) vs "fresh shas, package-present scope" (stories) is unclear:
does the manifest retain omitted pending tasks / non-pending tasks that have
no file? This drives missing-detection + safe deletion. Pin it.`
- `RB4 - action:YES - CAS port covers all node ops - compareAndApply(id,
expectedSha, spec) is task-shaped, but apply also renames initiative/objective
(no Objective repo — lives on InitiativeRepository) and deletes. Name the
conditional rename/reparent/delete port ops + result shapes.`
- `RB5 - action:YES - pick ONE preflight txn - "savepoint / BEGIN IMMEDIATE" is
two mechanisms; nested UnitOfWork is unsupported. Choose: ONE BEGIN IMMEDIATE,
full preflight-classify BEFORE any write, then mutate in the same txn.`
- `RB6 - action:YES - filesystem recovery - Atomic rename protects one file, not
a multi-file package rewrite. A partial rewrite after committed creates leaves
id-less files -> retry duplicates. Define a fail-safe: non-retryable error +
mandatory re-export, and partial-replacement behavior.`
- `RB7 - action:YES - boundary cases must be DEFINED not listed - S4 promises
"defined behavior" but the epic only lists the cases. Define at least: missing
objective, empty objective, empty initiative, task referencing a persisted
objective absent from the package.`

Proof (assertions weaker than claimed):

- `RS1 - action:YES - prove id-handoff - Assert SRC files got ids rewritten
after --create, AND exercise an id-less create during --apply (the actual
duplicate-prevention path). Currently unproven.`
- `RS2 - action:YES - prove all-node summary - Assert initiative/objective/task
classification + unchanged counts, not just a "1 updated" substring.`
- `RS3 - action:YES - tighten create assertion - grep 'created' matches any
line; assert exact 1 initiative / 2 objectives / 2 tasks via JSON state.`
- `RS4 - action:YES - rollback overclaim - The stale apply is rejected in
PREFLIGHT (before writes), so it proves conflict-rejection, not rollback-
after-mutation; the real-SQLite late-failure test proves rollback. Fix the
comment.`
- `RS5 - action:YES - mktemp the scratch file - /tmp/conflict.out is a fixed
path; use one under mktemp -d.`

### Round-2 resolutions (Ulrich, 2026-07-18)

- `RB1+RB2 - resolved - --delete-missing stays, with REVIEW + CONFIRMATION -
Ulrich keeps guarded delete IN 007 but it never happens without explicit
human confirmation. Eligibility for deletion: a MISSING node (in DB, absent
from files) that is (a) present in the manifest baseline, (b) DB sha STILL ==
baseline sha (a drifted missing node is a conflict, not deletable), AND (c) a
TASK in pending status. A node created after export (no baseline) is NEVER
deletable. A missing OBJECTIVE is deletable only if it ends up EMPTY (all its
tasks deleted / it had none); a non-empty objective is kept. The INITIATIVE
is never deleted. Flow: --delete-missing computes + PRINTS the deletion plan
(review); execution requires CONFIRMATION — interactive y/N on a TTY, or
--confirm-delete non-interactively; deletions then run inside the apply
UnitOfWork. Ineligible missing nodes are reported "missing (not deletable:
<reason>)".`
- `RB3 - resolved - full re-snapshot - On a successful apply the manifest is
rewritten as a FULL snapshot of every current DB node of the initiative
(objectives + tasks, pending AND non-pending), so missing-detection and
eligibility are always computed against a fresh, complete baseline.`
- `RB4 - resolved - conditional-write port covers all node ops - The repository
conditional-write port carries: compareAndApply (task spec), conditional
rename (initiative/objective — Objective ops live on InitiativeRepository, no
own repo), conditional reparent, conditional delete. Each takes
(id, expectedSha[, payload]) and returns {applied|conflict, freshSha}.`
- `RB5 - resolved - ONE BEGIN IMMEDIATE - No savepoints/nested txns. One
UnitOfWork (BEGIN IMMEDIATE): full preflight-classify (read current shas +
live status for every package node) BEFORE any write; if clean, mutate; any
conflict -> rollback. The scan therefore never observes its own writes.`
- `RB6 - resolved - filesystem recovery is fail-safe - After commit, rewrite
created files with their ids (best-effort). If that rewrite (or the manifest
rewrite) fails, emit a NON-RETRYABLE error telling the user to re-export: the
DB is committed + correct, only the on-disk package is stale, and re-export
regenerates it. A blind re-apply can never duplicate because the next apply
re-classifies against the committed DB.`
- `RB7 - resolved - boundary behavior DEFINED - Omitted objective file =
reported missing (deletable only per the empty-objective rule), not an error.
Empty objective (no tasks) = valid, round-trips. Empty initiative (no
objectives) = valid, exports just the initiative file. A task whose objective
ref resolves to a persisted objective NOT in the package = allowed (valid DB
parent); a ref resolving to neither package nor DB = UnknownNodeError.`
- `RS1-RS5 - resolved - Proof hardened - id-handoff proven (assert SRC rewritten
after --create + an id-less create during --apply); exact node counts asserted
via JSON; the rollback comment corrected (preflight rejection, with the real
rollback proven by the late-failure integration test); scratch file under
mktemp.`

## Confirming debate (round 3, 2026-07-18 — NOT READY: 2 real + 4 narrow)

Round 3 confirmed create-mode, id-handoff (both paths), no-dup, delete
review/confirm, and conflict-rejection are genuinely proven. Remaining:

- `TB1 - action:YES (RULING) - full-resnapshot vs never-delete-new-node CONTRADICT -
RB3 (full re-snapshot = every DB node becomes a manifest member) breaks RB1
("a node created after export is NEVER deletable"): after any successful apply,
a newly-created task is a manifest member with a matching sha, so a later
--delete-missing could delete it. FIX: the manifest must track FILE-MEMBERSHIP
(which ids were written as files) SEPARATELY from the full sha-snapshot;
deletion eligibility requires file-membership, not sha-membership. A node that
never had a file in the package is "not in this package", never "missing".`
- `TB2 - action:YES - failed id-rewrite can still duplicate - Naming the error
"non-retryable" does not PREVENT a retry. FIX: (a) apply is idempotent by
(initiative, ref) via a DURABLE ref->id map persisted to the manifest right
after commit and consulted before any create; (b) if the post-commit file/
manifest rewrite fails, drop a stale SENTINEL in the package dir and REFUSE a
subsequent apply until re-export — so a blind re-apply cannot duplicate.`
- `TB3 - action:YES - drifted delete candidate outcome - A missing node whose DB
sha drifted from baseline is SKIPPED-with-warning (reported, not deleted) and
does NOT abort the spec apply (delete is opt-in/advisory), distinct from a
drifted MUTATED node which aborts.`
- `TB4 - action:YES - unify confirmation - "Explicit confirmation" = the
--confirm-delete flag OR a positive y/N answer on a TTY; non-interactive
without the flag = no delete. ONE contract, stated once.`
- `TB5 - action:YES - objective delete CAS - Deleting an emptied objective also
requires manifest membership + expected objective sha + an atomic emptiness
check at delete time (not only its tasks' CAS).`
- `TS1 - action:YES - snapshot scope + summary assertion - The full snapshot is
initiative + objectives + tasks (initiative rename needs its baseline too);
and the apply summary reports counts over ALL node types (the Proof asserts an
unchanged-count, not only "N updated").`

**Round-3 resolved (Ulrich approved 2026-07-18):** TB1 manifest splits `files`
(file-membership → delete eligibility) from `nodes` (full sha-snapshot); TB2
durable `refToId` + stale sentinel makes create idempotent-by-ref and rewrite
failure fail-safe; TB3 drifted delete-candidate skipped-with-warning; TB4 one
confirmation contract (`--confirm-delete` or TTY `y/N`); TB5 objective delete
needs membership + sha + atomic emptiness; TS1 snapshot = initiative+objectives
+tasks and the Proof asserts an unchanged-count. All folded into the Stories +
Proof above.

**Round-4 debate + fixes (2026-07-18):** confirmed TB1/TB3/TB4/TB5 closed and no
path to delete a foreign node or delete unconfirmed. Fixed: (B1) create
idempotency is a DB-durable `(initiative, kind, ref) → id` row committed WITH the
create — not the post-commit sentinel (which shared the failure it guarded);
(B2) `refToId` is kind-scoped (objective/task namespaces can't collide); (B3)
the Proof asserts exactly `4 unchanged`; (B4) the non-interactive delete reads
stdin from `/dev/null` so it can't prompt in a TTY.

**Round-5 debate + fixes (2026-07-18):** confirmed the atomic idempotency row
closes duplication; hardened its remaining details: keyed by a durable
`packageId` (two packages reusing a ref never collide), stores `creationSha`
(a matched retry CAS-checks it, never a blind update), `UNIQUE(packageId, kind,
ref)` + `FK ON DELETE CASCADE`, reached via an explicit repository port op; and
the Proof's count assertions are anchored (`(^|[^0-9])N …`) so `14` can't match
`4`. Remaining debate findings are story-implementation granularity — pinned in
the relevant Story/Task at expansion.

## Expansion — ref-form ruling (Ulrich, 2026-07-18)

Settled during story authoring, resolving the export-bullet-vs-Proof
inconsistency the expansion surfaced:

- `EXPORT = ULID-as-ref` — an exported package (export → re-import) is a DB-tied
  snapshot: every node carries `id: <ULID>` and NO lowercase `ref:` line; parent
  (`objective:`/`initiative:`) and `depends-on` reference the parent's **ULID**.
  Confirms the export bullet's "`depends-on`/parent use ULIDs". Reparent = paste
  the target's ULID into the frontmatter parent (B18). On-disk file/dir names
  stay human-readable slugs (cosmetic, B18).
- `CREATE-NEW = slug-ref` — a hand-authored `--create` package uses lowercase
  slug refs (`ref: <slug>`, no `id:`); `--create` assigns ULIDs + writes `id:`
  back (handoff). A NEW node hand-added to an EXPORTED package uses its own slug
  ref but references existing nodes by their ULIDs (shape-disjoint, B6).
- Consequence: the Proof's reparent + id-less-create steps now substitute
  ULIDs (`$FRONTEND`/`$BACKEND`/`$TASK_API`); the initial `--create` on `$SRC`
  keeps slug refs. Story 04 (export) emits ULIDs; Story 05 (create) emits slugs;
  Story 03 codec's effective-ref rule is `ref` if present else `id`.

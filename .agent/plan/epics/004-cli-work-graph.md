# EPIC 004 — CLI manages the work graph

## Goal

A human can define and inspect real work through the CLI against the real
database: create a project, register resources, build an initiative with
objectives and dependent tasks, and see the graph with correct ready/blocked
states. This is the first full end-to-end proof of the architecture — every
command runs CLI → use case → ports → SQLite — and it is the surface the
daemon (EPIC 005) will execute from.

**Identity contract (binding for this and all later epics, debate finding):**
IDs first. Every `create` command prints the new ULID as its **only stdout**
(human messages go to stderr), so scripts capture ids with plain `$(…)`.
Every reference flag (`--project`, `--objective`, `--depends-on`, …) takes a
ULID. Name-based lookup is a separate convenience command
(`find <aggregate>`), never a second reference system inside other flags.

**Command grammar (locked):** verb-first `<verb> <object> <flags>`, k8s-style,
so each command key maps 1:1 to its use-case class — `create task` →
`CreateTask`, `list task` → `ListTasks`, `find initiative` → `FindInitiative`.
Verbs used: `create`, `rename`, `list`, `get`, `find`, `add`, `remove`.
Pre-existing subsystem commands (`db migrate`, `db status`) keep their form;
EPIC 002's `check graph --path <file>` is already verb-first. All flag names equal
domain field names verbatim (kebab is
the canonical rendering, e.g. `--secret-ref` → `secretRef`); no aliases.

## Verification Gate

Gates:  `npm run typecheck && npm test`
Proof:

```bash
export KANTHORD_DB="$(mktemp -d)/kanthord.db"
node src/main.ts db migrate

PROJECT=$(node src/main.ts create project --name demo)
node src/main.ts create repository --project "$PROJECT" \
  --name backend --organization acme --branch main
INITIATIVE=$(node src/main.ts create initiative --project "$PROJECT" --name oauth)
OBJECTIVE=$(node src/main.ts create objective --initiative "$INITIATIVE" --name backend)
TASK_API=$(node src/main.ts create task --objective "$OBJECTIVE" --title "implement api")
TASK_DEPLOY=$(node src/main.ts create task --objective "$OBJECTIVE" --title "deploy" \
  --depends-on "$TASK_API")

node src/main.ts list task --initiative "$INITIATIVE"
# shows "implement api" as ready and "deploy" as
# blocked (waiting: implement api). Exit 0.

# insert missed prep work and re-arrange the graph after creation:
TASK_PREP=$(node src/main.ts create task --objective "$OBJECTIVE" --title "spike auth")
node src/main.ts add dependency --task "$TASK_API" --depends-on "$TASK_PREP"
node src/main.ts list task --initiative "$INITIATIVE"
# now "spike auth" ready; "implement api" blocked (waiting: spike auth);
# "deploy" still blocked (waiting: implement api). Exit 0.

node src/main.ts add dependency --task "$TASK_PREP" --depends-on "$TASK_DEPLOY"
# would create a cycle: exits non-zero with a named cycle error, graph
# left unchanged, never a stack trace.

node src/main.ts create task --objective "$TASK_API" --title "bad parent"
# unknown/wrong-type reference: exits non-zero with a named error,
# never a stack trace.
```

## Stories

- **Command use cases.** `app/project/`, `app/resource/`, `app/initiative/`,
  `app/objective/`, `app/task/` create/update commands — full domain path,
  one use case per file, verb-first names per `AGENTS.md`.
- **Query use cases.** `list`/`get` queries per aggregate — CQRS-lite: read
  from the repo/SQL directly, skip domain objects, include computed
  ready/blocked state in task listings. `--json` output on every query for
  scripting.
- **Identity contract.** Creates print the ULID as sole stdout; reference
  flags accept ULIDs only and reject unknown or wrong-type ids with a named
  error via a `resolveKind(id)` read port (`undefined` → unknown; found but
  different aggregate → wrong-type); `find <aggregate> --<scope> <id> --name
  <name>` resolves a name to an id within an explicit scope (ambiguity →
  error listing candidates).
- **Typed resource commands.** `create repository|credential|notification|ai-provider|filesystem`
  — all carry `--project --name`, plus the per-type vendor flags from the
  Resource union (repository: `--organization --branch`; credential:
  `--provider --secret-ref`; notification: `--provider --destination`;
  ai-provider: `--provider --model`; filesystem: `--path`). Vendor fields are
  written to the `resources.attributes` JSON (EPIC 003 schema); validation
  errors name the missing flag.
- **Task context bindings.** `create task` accepts resource bindings
  (`--context repository=<resource-id>`, repeatable), persisted in a new
  `task_context` table (migration 3) — **stored, not interpreted**; the
  `TaskContext` resolver stays EPIC 005 and the domain `Task` entity is
  unchanged (no `context` field). `--depends-on` is repeatable.
- **Graph mutation (insert / re-arrange).** `add dependency --task <id>
  --depends-on <id>` and `remove dependency --task <id> --depends-on <id>`
  edit the DAG after creation (rows in EPIC 003's `task_dependencies`) — the
  model has no positions, so re-arranging work is edge editing and inserting
  work is just `create task`. Both reject a mutation that would form a cycle
  or reference an unknown task (`validateGraph`, EPIC 002) and a mutation of a
  non-pending task (`DependenciesLockedError`, EPIC 002), each a named
  non-zero error that leaves the graph unchanged; a successful edit emits
  `task.dependencies_changed` (needs EPIC 003's `events` type CHECK to include
  the 6th event type). Task-level dependencies only.
- **CLI argument layer.** `node:util` `parseArgs`-based command router in
  `apps/cli/` — **verb-first** explicit command table (grep-able, per
  `AGENTS.md`, each key mapping 1:1 to a use-case class), `--help` per command,
  human table output on stderr/`--json` on stdout for queries.
- **Error surface.** Domain errors (unknown reference, illegal transition,
  duplicate name in scope) map to non-zero exits with one clear line — never
  a stack trace for an expected error.
- **End-to-end smoke test.** One hermetic test drives the full Proof sequence
  through the composition root against a temp DB — the wiring lesson encoded
  as a regression test.

## Non-goals

- No execution of tasks (EPIC 005) — `list task` may show everything pending.
- No agent or workflow assignment semantics; fields are stored, not
  interpreted.
- No REST/HTTP app, no interactive TUI — plain commands and exit codes.
- No resource config files — the DB is the resource store; file import is an
  EPIC 006 convenience.

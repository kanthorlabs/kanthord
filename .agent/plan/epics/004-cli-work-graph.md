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
(`<aggregate> find`), never a second reference system inside other flags.

## Verification Gate

Gates:  `npm run typecheck && npm test`
Proof:

```bash
export KANTHORD_DB="$(mktemp -d)/kanthord.db"
node src/main.ts db migrate

PROJECT=$(node src/main.ts project create --name demo)
node src/main.ts resource add repository --project "$PROJECT" \
  --name backend --org acme --repo backend --branch main
INITIATIVE=$(node src/main.ts initiative create --project "$PROJECT" --name oauth)
OBJECTIVE=$(node src/main.ts objective create --initiative "$INITIATIVE" --name backend)
TASK_API=$(node src/main.ts task create --objective "$OBJECTIVE" --title "implement api")
TASK_DEPLOY=$(node src/main.ts task create --objective "$OBJECTIVE" --title "deploy" \
  --depends-on "$TASK_API")

node src/main.ts task list --initiative "$INITIATIVE"
# shows "implement api" as ready and "deploy" as
# blocked (waiting: implement api). Exit 0.

node src/main.ts task create --objective "$TASK_API" --title "bad parent"
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
  error; `<aggregate> find --project <id> --name <name>` resolves a name to
  an id within an explicit scope (ambiguity → error listing candidates).
- **Typed resource commands.** `resource add repository|credential|notification|ai-provider|filesystem`
  with the per-type required flags from the README union (repository:
  `--org --repo --branch`; credential: `--provider --secret-ref`; …) —
  validation errors name the missing flag.
- **Task context bindings.** `task create` accepts resource bindings
  (`--context repository=<resource-id>`), stored as the Task's Context for
  later resolver use (EPIC 005/006). `--depends-on` is repeatable for
  multiple dependencies.
- **CLI argument layer.** `node:util` `parseArgs`-based command router in
  `apps/cli/` — explicit command table (grep-able, per `AGENTS.md`), `--help`
  per command, human table output on stderr/`--json` on stdout for queries.
- **Error surface.** Domain errors (unknown reference, illegal transition,
  duplicate name in scope) map to non-zero exits with one clear line — never
  a stack trace for an expected error.
- **End-to-end smoke test.** One hermetic test drives the full Proof sequence
  through the composition root against a temp DB — the wiring lesson encoded
  as a regression test.

## Non-goals

- No execution of tasks (EPIC 005) — `task list` may show everything pending.
- No agent or workflow assignment semantics; fields are stored, not
  interpreted.
- No REST/HTTP app, no interactive TUI — plain commands and exit codes.
- No resource config files — the DB is the resource store; file import is an
  EPIC 006 convenience.

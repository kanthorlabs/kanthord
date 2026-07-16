# EPIC 002 — Domain core: the work graph

## Goal

The pure domain model of kanthord's work graph exists under `src/domain/` with
zero I/O: entities (Project, Resource union, Initiative → Objective → Task),
task state rules (status transitions plus the pending-only guard for changing
a task's dependencies), dependency-readiness logic over the task DAG, and the
domain events vocabulary. Dependencies are **task-level only** — Initiatives
and Objectives carry no ordering. This is the hexagon's center — the most test-dense epic —
and it ends wired into the skeleton so the new logic runs inside the real
program, not beside it.

## Verification Gate

Gates:  `npm run typecheck && npm test`
Proof:

```bash
node src/main.ts check graph --path examples/demo-graph.yaml
# prints each task with its computed state: `ready` or
# `blocked (waiting: <task>)`. Exit 0.
node src/main.ts check graph --path examples/invalid-cycle.yaml
# rejects the file naming the cycle. Exit non-zero.
node src/main.ts check graph --path examples/invalid-unknown-dep.yaml
# rejects the file naming the unknown dependency reference. Exit non-zero.
```

## Stories

- **Entity base + identity.** `Entity` with ULID ids (via the `ulid` package),
  creation helpers, and ULID ordering used as creation-time ordering.
- **Resource union.** `ResourceType` + the discriminated union (Repository,
  Credential, Notification, AIProvider, Filesystem) with type guards — the
  shape later resolver ports switch on.
- **Work-graph entities.** Project, Initiative, Objective, Task as data +
  state rules only — per `AGENTS.md`, **no `execute()` on entities** (the
  README sketch predates that decision).
- **Task state rules.** `TaskStatus` (pending/running/completed/failed) with
  legal-transition enforcement; illegal transitions are domain errors. A
  task's `dependencies` may be changed only while it is `pending` (the
  insert/re-arrange guard — you cannot retro-order a running/completed task);
  mutating a non-pending task's dependencies is a named domain error.
- **Dependency readiness.** The pure function at the heart of scheduling:
  which tasks are ready (all dependencies completed), which are blocked and on
  what; DAG validation — cycle detection and unknown-dependency references are
  rejected with named errors. The same `validateGraph` is reused to reject a
  dependency edge **added or re-arranged later** (EPIC 004) that would form a
  cycle or point at an unknown task — no separate mutation-cycle function.
- **Domain events.** The `EventType` vocabulary for the task lifecycle
  (created, ready, started, completed, failed, and dependencies-changed for
  insert/re-arrange audit) + event construction; storage and delivery stay out
  (EPIC 003/005).
- **Graph check wiring.** The `check graph --path <file>` CLI command in
  `apps/cli/` parses the YAML file (the `yaml` package) and passes plain parsed
  data to the
  `app/graph/check-graph.ts` use case, which builds the domain graph and
  returns the readiness report. YAML parsing stays in the app adapter —
  `app/` imports only `domain/` and ports (debate finding).
- **Example fixtures.** Committed under `examples/`: `demo-graph.yaml`
  (valid), `invalid-cycle.yaml`, `invalid-unknown-dep.yaml` — the Proof's
  concrete inputs, also reused by tests.

## Non-goals

- No persistence of the graph (EPIC 003) — `check graph` reads a fixture file
  and holds everything in memory.
- No execution, no queue, no agents (EPIC 005/006).
- No Workflow concept (`tdd@1`, `pr@1`) yet — the Task carries the field
  shape only if a story needs it, without semantics.

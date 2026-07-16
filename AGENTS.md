# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

`kanthord` is a long-running daemon (Node 24 / TypeScript) that executes
software-engineering work across multiple repositories on behalf of one
engineer. See `README.md` for the current architecture.

## Goal

The project is done when the engineer can use the kanthord CLI to actually
build a feature of their real working project end to end: define the
initiative/objective/tasks, let agents execute them across the involved
repositories, and pull progress/notifications — with the human stepping in
only where a human is required. Every slice of work should move toward this;
prefer the path that makes the CLI usable on a real feature sooner.

## Architecture

Hexagonal (Ports & Adapters) with light DDD, as a single modular monolith.
One Node process; `node:sqlite` is the only infrastructure (entities, job
queue, and pull-based event feed all live in one database, WAL mode).

### Layout

```
src/
├── domain/            # pure TS: entities, state rules, DAG logic. Zero I/O.
├── app/               # use cases, grouped by aggregate
│   ├── project/
│   ├── resource/
│   ├── initiative/
│   ├── task/          # e.g. create-task.ts, claim-next-task.ts, complete-task.ts
│   └── agent/
├── <capability>/      # one directory per external capability (package-by-feature)
│   │                  # e.g. notifier/, scm/, storage/, agent-runner/
│   ├── port.ts        # the interface the core depends on
│   └── <vendor>.ts    # adapters, e.g. slack.ts, github.ts, sqlite/
├── apps/              # driving adapters; thin, no business logic
│   ├── cli/           # CLI app
│   └── http/          # HTTP server app (REST); grpc/ or ws/ sit beside these later
└── main.ts            # composition root: the only place that wires adapters
```

### Import direction (the load-bearing rule)

- `domain/` imports nothing outside `domain/`.
- `app/` imports `domain/` and `*/port.ts` only — use `import type` for ports.
  Never import an adapter (`slack.ts`, `sqlite/`) from a use case.
- `port.ts` never imports its sibling adapters; adapters import their `port.ts`.
- Only `main.ts` imports concrete adapters, to do the wiring.
- Apps parse input, call a use case, format output — nothing else.

### Ports

- A port is a plain interface owned by the core. No `I` prefix; name it by
  capability, not vendor: `Notifier` (not `ISlackService`). Adapters carry the
  vendor name: `SlackNotifier`, `GithubScm`, `FakeNotifier` (tests).
- Keep ports small — one capability each. No god `Services` interface, no
  service locator / context bag; dependencies arrive by constructor injection.
- Stable dependencies (repos, queue, clock) are injected directly. Anything
  chosen per-task by Resource bindings (which Slack channel, which credential,
  which AI provider) goes through a resolver port, e.g.
  `NotifierResolver.for(resource): Notifier`, implemented in the capability
  directory.

### Use cases

- One use case = one file = one class with one `execute()`. File name is the
  kebab-case of the class: `complete-task.ts` exports `CompleteTask`. Verb-first
  names. Folder = the aggregate it primarily acts on.
- CQRS-lite: **commands** go through domain objects and rules; **queries**
  (list/get) may call the repo or a read-only SQL port directly and skip the
  domain. No separate databases, no event bus.
- Shared logic between use cases moves down into `domain/` functions — never
  use-case-calls-use-case.
- No generic `CrudUseCase<T>` base class; a copied 15-line trivial use case is
  the accepted trade.
- Domain entities are data + state rules only. No `execute()` on `Task` or
  `Agent` entities (the README sketch predates this decision); execution
  happens in use cases via the agent-runner port.

### Wiring

- Explicit construction in `main.ts`, grouped into per-feature factories
  (`buildTaskUseCases(deps)`) when it grows. No DI container.
- Apps register routes/commands in explicit, grep-able tables mapping to
  use cases. No glob-based auto-registration.

### Persistence, queue, notifications

- Single SQLite file via `node:sqlite`, WAL mode.
- Queue is a `jobs` table; workers claim atomically with
  `UPDATE … SET status='running' … RETURNING`.
- Notifications are pull-based: an `events` table, clients poll
  `GET /events?after=<last-ulid>` with a cursor (ULIDs sort by time).
- One repository per aggregate (Project, Initiative, Task) — not per entity.

### Testing

- Domain and use cases test hermetically with fakes implementing ports — no
  network, no real SQLite required (SQLite adapters get their own tests).

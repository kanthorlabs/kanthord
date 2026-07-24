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

## Planning — goal-based epics

Work is planned as **EPICs only**, authored one at a time under
`.agent/plan/epics/<NNN>-<slug>.md`. Stories exist inside the epic as a
bullet list; they are expanded into detailed Story/Task files
(`.agent/plan/stories/<epic-slug>/`) in a planning session **when the epic
starts** — that expansion is what `/work` consumes.

Epic template:

```
# EPIC <NNN> — <name>
## Goal               (one paragraph: what capability exists after this epic)
## Verification Gate  (the epic's runnable output — two parts:)
Gates:  <hermetic commands /work runs — default `npm run verify` (typecheck + test + verify:handoff + lint + db status)>
Proof:  <one real command against the real program, and what it must show>
## Stories            (bullet list, each one output-relevant)
## Non-goals          (what this epic deliberately skips)
```

Binding rules:

- **An epic without a program-level `Proof:` command is not a valid epic.**
  Tests prove the units; the Proof proves the wiring. "Done" = gates green
  **and** the Proof shown working.
- **A `Proof:` is an exact, copy-paste-runnable command block** — concrete
  values, `export`ed env vars, captured ids — never a prose description
  (debate finding: a proof that needs interpretation is not a proof).
- **Integration is not a phase.** The walking skeleton (EPIC 001) wires
  CLI → use case → port → adapter → SQLite end to end first; every later
  epic extends a running program and must keep it runnable.
- An epic that mostly edits lane-forbidden files (toolchain, configs,
  `scripts/`, `package.json`) is a **maintainer epic**: executed directly by
  the human + assistant in normal sessions, not dispatched through `/work`.

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
├── composition.ts     # composition root: the only module that wires adapters
└── main.ts            # process entrypoint: reads argv/env, calls composition + dispatch, does I/O
```

### Import direction (the load-bearing rule)

- `domain/` imports nothing outside `domain/`.
- `app/` imports `domain/` and `*/port.ts` only — use `import type` for ports.
  Never import an adapter (`slack.ts`, `sqlite/`) from a use case.
- `port.ts` never imports its sibling adapters; adapters import their `port.ts`.
- Only the composition root imports concrete adapters, to do the wiring. The
  root is `composition.ts` (the `buildDeps` factory — the single module that
  imports adapters) plus the thin `main.ts` entrypoint that calls it; splitting
  the factory out of `main.ts` lets tests build the real dependency bundle
  without the process entrypoint's side effects.
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

- Explicit construction in the composition root (`composition.ts`'s
  `buildDeps`), grouped into per-feature factories (`buildTaskUseCases(deps)`)
  when it grows. No DI container.
- Apps register routes/commands in explicit, grep-able tables mapping to
  use cases. No glob-based auto-registration.

### Persistence, queue, notifications

- Single SQLite file via `node:sqlite`, WAL mode.
- Queue is a `jobs` table; workers claim atomically with
  `UPDATE … SET status='running' … RETURNING`.
- Notifications are pull-based: an `events` table, clients poll
  `GET /events?after=<last-ulid>` with a cursor (ULIDs sort by time).
- One repository per aggregate (Project, Initiative, Task) — not per entity.

### Delivery contract

A task `completed` + candidate `landed` (007.11) / objective `integrated`
(007.12) means the work is **locally landed** in the bare managed home — it is
not yet on the remote. Delivery to the remote is a separate, explicit
`publish repository` step (007.13): human-gated, fast-forward-only, and never
force-pushes. Each repository target carries its own publication state —
`unpublished` / `published@<remoteOID>` / `diverged` — so a local land is always
distinguishable from a completed remote delivery. The deferred `pr@1` agent
(007.12) will call `publish`; until then, publication is a manual operator step.

### Testing

- Domain and use cases test hermetically with fakes implementing ports — no
  network, no real SQLite required (SQLite adapters get their own tests).

## Others

- A Prettier pre-commit hook (husky + lint-staged) auto-formats staged files on
  every commit; formatting changes to your staged files at commit time are
  expected and correct — do not panic or revert them.

- No backward-compatible needs because we are in local development only

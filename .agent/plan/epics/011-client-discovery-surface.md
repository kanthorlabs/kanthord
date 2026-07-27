# EPIC 011 — Client discovery surface & project activity feed

> Found by two UX debates (2026-07-27) while designing the React dashboard's
> onboarding and daily-overview routines, then split out of a rejected
> single-epic draft by a third debate. These gaps exist because the CLI never
> needed them: a human at a terminal already knows the ids and reads one
> project at a time. A programmatic client has neither advantage.
>
> Siblings: `012-explicit-activation-guarded-verdicts.md` and
> `013-lease-fenced-run-recovery.md`. Story 3 here and 013's story 5 both touch
> the `events` table — see the cross-epic hazard note in each.

## Goal

A client holding **no ids at all** can discover what exists and read one
project's history. After this epic: `list project` enumerates projects;
`list notification` and `list filesystem` complete the resource-listing set
beside the existing credential / repository / ai-provider commands, never
leaking a secret; `list event --project <id>` returns one project's activity as
a **server-side scoped query** with cursor paging that steps correctly past
other projects' events; and `examples/oauth-package` ships as a real,
importable `formatVersion: 3` graph package so a first-time client has
something to import instead of a format that only `check graph` accepts.

## Verification Gate

Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).
Hermetic coverage required beyond the Proof:

- `ListProjects` returns projects in ascending id order; empty store → `[]`.
- The new resource listings go through `toResourceView`, so a listed resource
  never carries a credential `value` (mirrors the existing `list credential`
  assertion in `src/apps/cli/commands/read.test.ts`).
- Event scoping resolves ownership by the **denormalised `projectId` written at
  append time** (see Decisions): an event whose owner entity is later deleted
  still appears in that project's feed, and an event with no project is in no
  project feed.
- Paging: `nextCursor` advances past non-matching events, so a project feed
  never stalls behind a foreign event; the terminal page is empty with a stable
  cursor; no event id is ever returned twice across pages.
- The migration backfills `events.projectId` for existing rows by hierarchy
  join, and rows that cannot be resolved are left NULL rather than guessed.

Proof: `scripts/e2e/client-discovery-proof.sh` — deterministic, no model, no
network, no daemon. Run from the repo root:

```bash
scripts/e2e/client-discovery-proof.sh
```

It must print `011 ok: …`. Phases: **A** `list project` enumerates two projects
with no prior id, in a defined order · **B** `list notification` /
`list filesystem` list, are project-scoped, and no listing carries a secret ·
**C** `examples/oauth-package` imports and its objectives + tasks are readable
back (a real import, not `--dry-run`, run against a COPY because
`import --create` rewrites a package's source files in place with minted ULIDs;
the script then asserts the committed example is still clean) · **D** an
interleaved two-project event
history is served as disjoint, ordered, duplicate-free scoped feeds, each a
subset of the global feed, and paging P1 with `--limit 1` reaches exactly the
full P1 set while stepping over P2's events.

Confirmed RED against the current tree (2026-07-27). Because `set -e` stops the
script at its first failure, each gap was ALSO probed independently: `list
project` → `unknown command 'project'`; `list notification` → `unknown command
'notification'`; `list filesystem` → `unknown command 'filesystem'`;
`list event --project` → `unknown option '--project'`; `examples/oauth-package`
→ missing.

## Stories

1. **`list project`.** A `ListProjects` use case over the existing
   `ProjectRepository.listProjects()` (already on the port; implemented at
   `src/storage/sqlite/sqlite-project-repository.ts:122`, already
   `ORDER BY id ASC`), plus a `list project [--json]` command registered in
   `src/apps/cli/commands/list.ts`. Output shape follows `list initiative`.

2. **`list notification` / `list filesystem`.** Two more builders in
   `src/apps/cli/commands/list/resource.ts` beside the existing credential /
   ai-provider / repository ones. `ListResources` is already generic over
   `ResourceType` (`src/app/resource/list-resources.ts`), so this is
   registration + tests, including the no-secret-leak assertion.

3. **Denormalise `projectId` onto `events`.** A migration adds a nullable
   `events.projectId`, backfills existing rows by hierarchy join
   (`task → objective → initiative → project`, and `repositoryId → project`),
   and leaves unresolvable rows NULL. Every append path sets it from the
   owner the event already carries. This is the load-bearing decision: joins at
   read time break for deleted entities and make cursor paging expensive, and
   an event's project never changes after it is appended.

4. **`list event --project <id>` with correct cursor paging.** `ListEvents`
   gains an optional project filter applied in SQL over the new column. The
   cursor stays the **global ULID** so it remains comparable across scopes;
   `nextCursor` is the last **scanned** row, not the last matching one, so a
   page whose matches are separated by foreign events still advances. Terminal
   page is empty. `--project` composes with the existing `--after`, `--limit`,
   and `--follow`.

5. **`examples/oauth-package` — a real v3 graph package.** The README's OAuth
   story authored as an importable package: initiative + objectives + tasks as
   markdown with frontmatter, `bindings: { source: repository }`, and a
   `.kanthord-export.json` at `formatVersion: 3`. `examples/demo-graph.yaml` is
   NOT touched — it is `check graph` input, a different format with a different
   purpose.

6. **`create task` emits `task.created`.** `task.created` is declared in
   `EVENT_TYPES` and accepted by the `events.type` CHECK but has **no producer
   anywhere in `src/`** — only tests construct it. Proof phase D builds its
   interleaved two-project history from `create task`, so without a producer it
   would compare two empty feeds. This adds the missing append in `CreateTask`.
   It introduces no new event type; it makes a declared one real. `CreateGraph`
   / `import graph` deliberately do NOT emit it (see Non-goals).

## Decisions

- **Event ownership is denormalised at append time, not joined at read time**
  (debate 2026-07-27). A read-time join makes a project feed lose history when
  an entity is deleted, forces the paging cursor to scan joins, and has no
  answer when several owner fields resolve to different projects. A column
  written once at append has one answer forever.
- **The event cursor stays global.** A project-relative cursor would not be
  comparable with the global feed the daemon and `--follow` already use.
- **`nextCursor` is the last scanned row.** Returning the last _matching_ row
  would make a scoped page stall whenever the next matches sit behind foreign
  events.
- **No `repository.landed` event.** The dashboard draft asked for one, but local
  landing is already observable as `initiative.landed` +
  `candidate.transplanted`, and remote delivery as `repository.published`. A
  third name for an existing fact would blur the delivery contract. `OPEN:` if a
  client turns out to need per-repository _local_ delivery state as a queryable
  field rather than replayed events, that is a read-model addition in a later
  epic — not a duplicate event here.

## Non-goals

- **No HTTP API.** This widens the CLI + use-case surface only.
- **No decision-inbox query and no diff query.** Both are real dashboard
  blockers and both are larger than this epic; each gets its own.
- **No notification test-send.** Onboarding wants it; it belongs with the
  notifier work.
- **No graph-authoring capability.** Generating a package from a feature
  description is its own epic; this one only ships an example.
- **No new event types.** This epic only makes existing events queryable.

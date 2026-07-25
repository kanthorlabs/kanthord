# EPIC 007.17 — Follow-up sequencing edges — stories

Epic: `.agent/plan/epics/007.17-follow-up-sequencing-edges.md`
Prereq: EPIC 007.16 (sequence order).

A follow-up initiative or objective can be sequenced after an existing one — at
create time (`--after`), on already-existing nodes (`add initiative-dependency` /
`add objective-dependency`), or from a graph package (`after:` in `initiative.md`
/ `objective.md`) — and the daemon refuses to enqueue work whose prerequisites
have not reached their successful terminal status.

## Dispatch order

1. `01-validate-dag-and-satisfaction.md` — pure domain, no dependants yet.
2. `02-persistence.md` — migration 20 + port/adapter + digest. **Blocks everything
   after it.**
3. `03-readiness-gate.md` and `04-cli-edges-and-refusals.md` — independent of each
   other, both only need 1 + 2. Dispatch in parallel if the lane allows.
4. `05a-graph-codec-after.md` — pure codec (types, parse, serialize). Needs nothing
   from this epic, so it may run any time after 1; keep it before 5b/5c because both
   consume `PkgObjective.after`.
5. `05b-create-path-after.md` — resolve + store + id handoff + export. Needs 2 + 5a.
6. `05c-apply-path-after.md` — apply path + confirm-before-delete. Needs 5b (its
   round-trip test consumes the create path's baseline).
7. `06-observability-and-proof.md` — last. It is the Proof surface and needs all of
   the above.

Coupled chain: **02 → 05b → 05c**. Story 2 puts `after` into the canonical digest
and leaves the graph call sites passing the live/empty set; 5b switches the create
path to the package's resolved set, 5c switches the apply path. Each step is green
on its own, but until 5c lands the digest ignores package `after` content on apply.

**Why `after` is in the digest** (the one design call worth knowing before you
start): `classifyNode` (`apply-graph.ts:77-90`) is a **three-way** comparison —
intended (package) vs baseline (manifest) vs live (DB row). Putting `after` in the
sha keeps all three on one value, so an edge written by
`add objective-dependency` after an export re-stamps the owner's sha and the next
`--apply` reads `drifted` → refuse.

That is what makes the **confirm-before-delete** rule safe (Story 5, 5e-ter).
Edge removal via a file is gated behind `--confirm-delete`, exactly like node
deletion (`import-graph.ts:216-230`). Distinguishing "the author deleted this edge
from the file" from "someone added it to the DB after the export" needs the
baseline — both look identical in a package-vs-live comparison. Without the sha,
the confirmation would be asking the human to approve reverting a change they
never saw. Leaving `sha.ts` alone is cheaper but degrades edges to
last-writer-wins, which is exactly what the sensitive-plan rule forbids.

## Stories

- 1 — extract `validateDag`, add per-level satisfaction predicates + the two typed refusal errors → `01-validate-dag-and-satisfaction.md`
- 2 — migration 20, `SequencingRepository` port + sqlite adapter, `after` in the canonical digest → `02-persistence.md`
- 3 — gate `EnqueueReadyTasks`, `RunNextTask`'s two inline re-scans, and `ApproveTask`'s → `03-readiness-gate.md`
- 4 — `--after` on create, four `add`/`remove` edge verbs, retroactive + scope + cycle refusals → `04-cli-edges-and-refusals.md`
- 5a — `after:` in the codec: parsed types, parse, serialize, canonicalisation → `05a-graph-codec-after.md`
- 5b — `after:` on `--create`: resolve refs, store edges, ULID id handoff, export → `05b-create-path-after.md`
- 5c — `after:` on `--apply`: classification, threaded CAS, confirm-before-delete → `05c-apply-path-after.md`
- 6 — `after:` / `waiting on:` rendering, `e2e-status.sh`, `make-sequencing-graph.sh` + `sequencing-proof.sh` → `06-observability-and-proof.md`

## Facts (needed for implementation)

**Domain**

- `validateGraph` (`src/domain/graph.ts:41-106`) reads only `node.id` and
  `node.dependencies` — never `status`. The extraction is a pure move.
- `readiness` (`src/domain/graph.ts:186-207`) hardcodes `"pending"` (line 194) and
  `"completed"` (line 197). **Do not touch it** — task-level sequencing is a
  Non-goal.
- Statuses live in one file: `INITIATIVE_STATUSES` (`src/domain/initiative.ts:4`)
  = `building | landed | discarded`; `OBJECTIVE_STATUSES` (`:8-14`) =
  `building | awaiting_confirmation | conflict | integrated | discarded`. There is
  **no `src/domain/objective.ts`**. `status` is **optional** on both entities
  (`:21`, `:30`) — always default it with `?? "building"`.
- There is no `isTerminal` helper anywhere; terminality is open-coded in four
  places (`reject-task.ts:228-234`, `:250-255`, `reject-objective.ts:86-89`,
  `retry-objective.ts:169`). Story 1's predicates are the first ones; do not
  refactor those four sites.

**Persistence**

- Highest migration is **19** (`src/storage/sqlite/migrations.ts:461-521`); the
  next is 20 and must be the last array element —
  `validateSequence` (`src/storage/sqlite/migrate.ts:55-63`) enforces dense
  1-based `version` ordering.
- `task_dependencies` (`migrations.ts:50-55`) carries a `position` column; the two
  new tables must **not** (an `after` set is a set).
- `migrations.test.ts` hard-codes version `19` at lines 67, 330, 743-744, 876,
  980, 1059, 1096, plus a 17-table list at 65-86 and a column-list block at 92+.
  All must move to 20 / 19 tables.
- Adding a **required** method to `InitiativeRepository` (`src/storage/port.ts:70-105`)
  breaks five structural fakes (`apply-graph.test.ts:75`, `create-graph.test.ts:37`,
  `export-initiative.test.ts:165`, `objective/create-objective.test.ts:16`,
  `boundary-cases.test.ts:85`). That is why sequencing gets its **own** port.
- `canonicalObjective` = `{name, initiativeId}` and `canonicalInitiative` =
  `{name, projectId}` today (`src/domain/sha.ts:31-44`) — **neither has any edge
  component**. `canonicalTask` (`:8-28`) already `.sort()`s `dependencies`; the
  new `after` field mirrors that exactly.
- `SqliteInitiativeRepository` stamps `sha256` in `save` (`:24-43`),
  `saveObjective` (`:70-93`), `conditionalRenameInitiative` (`:223-243`) and
  `conditionalRenameObjective` (`:250-270`). All four must account for `after`.

**Enqueue / daemon**

- `EnqueueReadyTasks` (`src/app/task/enqueue-ready-tasks.ts`, 57 lines) works
  **every** non-paused initiative concurrently; it takes five positional
  constructor args and uses two local structural interfaces (`:8-14`), not the
  full ports.
- The inline re-scan exists **three times**: twice byte-identical in
  `run-next-task.ts:257-268` and `:333-344`, and once in
  `approve-task.ts:359-371`. All three are gated by Story 3.
- `retry-task.ts:120-123`/`:137-140` and `recover-interrupted-tasks.ts:40-43` are
  **not** re-scans — they enqueue only their own named task. Out of scope.
- `task.ready` is exactly `{ id, type: "task.ready", taskId }` — no payload.
- Wiring: `EnqueueReadyTasks` at `src/composition.ts:373-379`, `RunNextTask` at
  `:409-420` via the `taskStoreWithObjectives` literal at `:391-407`. There is no
  `buildTaskUseCases`.
- `--until-idle` exits the first iteration where `enqueueReady` returned zero ids
  **and** `runNext` returned `idle` (`src/app/task/run-daemon.ts:156-168`). A task
  blocked by an unsatisfied edge therefore reads as idle — the daemon exits and
  leaves it `pending`, which is exactly what the Proof asserts.

**CLI**

- Leaf commands live at `src/apps/cli/commands/<verb>/<noun>.ts` and are registered
  in explicit tables: `commands/add.ts:16`, `commands/remove.ts:16`,
  `commands/create.ts:24-32`, `commands/get.ts:26-27`.
- `src/apps/cli/architecture.test.ts:27-31` hard-codes
  `EXPECTED_LEAF_FILE_COUNT = 55` and `EXPECTED_LEAF_COUNT = 57`; four new leaves
  make them 59 / 61. It also forbids `.action(` / `.option(` in `index.ts` and
  requires every leaf to carry a description, `Usage:` and `Example`.
- Errors reach a non-zero exit through one site: the `instanceof` chain in
  `toResult` (`src/apps/cli/error-map.ts:42-73`). An error not listed there is
  **re-thrown** (line 72) and escapes as a stack trace. `src/app/errors.ts` is the
  single catalogue the CLI imports from.
- `ReferenceResolver` has exactly one method,
  `resolveKind(id): "project"|"resource"|"initiative"|"objective"|"task"|undefined`
  (`src/storage/port.ts:163-167`).
- Repeatable options use the `--bind` collector at `commands/import/graph.ts:19-24`.

**Graph packages**

- `src/apps/cli/graph-md/parse.ts` and `serialize.ts` are **I/O shims only**. All
  parse/serialize logic is in `src/app/graph/graph-codec.ts` — `buildInitiative`
  (`:152-170`), `buildObjective` (`:172-192`), `buildTask` (`:194-…`, deps at
  `:212-219`), `serializeInitiative` (`:362-377`), `serializeObjective`
  (`:379-395`), `serializeTask` (`:397-441`).
- `serializeTask` emits `dependencies: [a, b]` as a single sorted flow sequence,
  **omitted when empty** (`:407-410`). `after` copies this exactly.
- `serializeNode` (`:450-460`) discriminates node kinds structurally by
  `"objectiveRef" in node` then `"initiativeRef" in node` — adding `after` to both
  initiative and objective is safe.
- `format.ts:16-39`'s key-order constants are documentation-only; `graph-codec.ts`
  hardcodes the order. Update both anyway.
- Apply classification is one function, `classifyNode`
  (`src/app/graph/apply-graph.ts:77-90`): `liveSha !== baselineSha` → `drifted`
  first, then `intendedSha === baselineSha` → `unchanged`. So a digest that
  ignores `after` makes an `after` edit `unchanged` (silently dropped), and a
  digest that includes it **unsorted** makes a reorder `updated` (a spurious
  rewrite). Sorting at parse time is what makes a reorder a true no-op.
- The `updated` branch applies initiative/objective changes via
  `conditionalRenameInitiative` (`apply-graph.ts:513-522`) and
  `conditionalRenameObjective` (`:528-540`). Objectives are **never created** in
  apply mode.
- **Two sequential CAS writes on one row are fine — thread the first call's
  `freshSha` into the second.** `apply-graph.ts:496-501` already does it:
  `conditionalReparent(cls.id, casResult.freshSha, …)`, commented "the row's sha
  changed after the update". This is why Story 5 adds a narrow
  `conditionalSet*After` beside the rename methods instead of reshaping them.
- `.kanthord-export.json` shape is `ExportManifest`
  (`src/app/graph/graph-package.ts:37-50`); written for `--create` at
  `src/apps/cli/import-graph.ts:457-489`. `objectiveIds` is package declaration
  order, not sorted.
- Per-node apply output strings are built at `import-graph.ts:183-200`
  (`unchanged: <label> (<path>)`, `drifted: …`, `would update: …`), summary at
  `:204-214`.

**E2E scripts**

- `generic@1` requires repository + ai_provider + credential context. A no-model
  proof therefore needs a dummy credential + ai-provider
  (`scripts/e2e/discard-proof.sh:44-50`) and all three `--bind` flags.
- `.fake-agent.json` is read **only** via `KANTHORD_FAKE_AGENT=<path>`
  (`src/main.ts:31-45`). Nothing reads the filename by convention. Schema is
  `FakeTurn[]` or `Record<title, FakeTurn[]>`
  (`src/agent-runner/fake-session.ts:25-37`); the array **must end with a text
  turn** or the agent loop never stops.
- `create repository` needs the bare origin seeded with one commit on the
  configured branch first (`discard-proof.sh:31-39`).
- `grep -c` exits 1 on zero matches, which aborts a `set -e` script — use
  `test "$(… | grep -c … || true)" -eq 0` (`discard-proof.sh:76-78`).
- No shellcheck, no eslint, no prettier, and no test covers `scripts/e2e/*.sh`.
  CI runs `npm run typecheck` only (`.github/workflows/ci.yaml`).
- Style template for a new package generator: `scripts/e2e/make-discard-graph.sh`.
  Style template for a new proof: `scripts/e2e/discard-proof.sh`.

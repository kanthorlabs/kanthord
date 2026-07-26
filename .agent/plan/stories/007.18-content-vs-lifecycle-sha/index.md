# EPIC 007.18 — Separate content drift from lifecycle progress — stories

Epic: `.agent/plan/epics/007.18-content-vs-lifecycle-sha.md`
Prereq: EPIC 007.17 (sequence order).

A task's `sha256` covers its declarative content only, so a task that merely ran no
longer classifies `drifted`; the lifecycle protection status-in-sha was providing
moves into an explicit CAS status predicate with a typed failure reason.

## Dispatch order

1 → 2 → 3 → 4 → 5, strictly sequential.

- **Story 1 merges what were originally two epic bullets** (the epic now carries
  them as its single bullet 1). They cannot ship apart: after the hash change
  alone `npm run verify` is green while no lifecycle guard exists at all,
  and an `--apply` against a running task overwrites its instructions. A "coupled
  pair" note is not a mechanism, so they are one story.
- **2 must follow 1** (it freezes the new canonical form).
- **4 must follow 1** (it formats 1's typed CAS reason).
- **5 is last** — it is the Verification Gate and only passes once 1–4 are in.

## Stories

- 1 — drop `status` from `canonicalTask` (6 call sites) **and** add the atomic
  `(sha, status)` predicate to `compareAndApply` + `conditionalDeleteTask` with a
  `"sha" | "status"` conflict reason →
  `01-content-hash-and-status-predicate.md`
- 2 — migration **20** re-stamps `tasks.sha256` always and
  `graph_import_map.creation_sha` only where content never drifted →
  `02-migration-20-restamp-sha-stores.md`
- 3 — bump `GRAPH_FORMAT_VERSION` to 3; `ApplyGraph` throws `StaleManifestError`
  on a pre-007.18 manifest, mapped to a one-line re-export remedy →
  `03-reject-stale-manifests.md`
- 4 — typed `casReason` → `refused: task <id> is no longer pending (status: …)`
  vs `refused: task <id> changed outside this package` →
  `04-distinguishable-conflict-reporting.md`
- 5 — `scripts/e2e/make-sha-graph.sh` + `scripts/e2e/sha-classification-proof.sh`
  → `05-proof-scripts.md`

## Facts (needed for implementation)

**Line numbers in the EPIC are partly stale.** Verified positions:

- `canonicalTask` — `src/domain/sha.ts:8-28`; `status` is the parameter field at
  `:16` and the hashed key at `:26`. Seven other fields, key order
  `title, instructions, ac, agent, verification, dependencies, objectiveId`.
  `src/storage/sqlite/node-sha.ts:7-12` is a pure re-export shim (storage imports
  it; app imports `domain/sha.ts` directly).
- `canonicalTask` call sites: `create-graph.ts:221-232`, `apply-graph.ts:201-212`,
  `:235-246`, `:453-464` (**not** 443), `:564-575` (**not** 554),
  `sqlite-task-repository.ts:39-50`. The epic's `:147` / `:171` are
  `canonicalInitiative` / `canonicalObjective` — out of scope.
- `classifyNode` — `apply-graph.ts:77-90`, module-private, order
  `drifted (:85) → unchanged (:86) → locked (:88) → updated (:89)`. It returns 4 of
  the 6 `NodeClass` values; `created` (`:260`) and `missing` (`:320`) are assigned
  at the call sites.
- Conflict aggregation is `apply-graph.ts:398-401` (**not** ~390); the write gate is
  `:415`; conflicted nodes keep their old baseline at `:664-676` (**not** ~657) plus
  the CLI merge at `import-graph.ts:241-245`. `:651-658` is the late-CAS rollback
  return.
- **The on-disk manifest is authoritative for every node with an `id`**
  (`apply-graph.ts:143`, `:166`, `:195` → `manifest?.nodes[id]`, parsed at
  `graph-codec.ts:289-293`). `graph_import_map.creation_sha` is the baseline only on
  the id-less branch (`:221-252`). This answers the epic's open question: a DB-only
  re-stamp does not cover the common path, so Story 3 is required.
- **The preflight status does not reach the write phase.** `ApplyClassification`
  (`:38-46`) has no status field; `liveStatus` is a preflight local (`:198`, `:234`)
  consumed by `classifyNode` and discarded. `apply-graph.ts:444` re-reads the row
  inside the UoW's `BEGIN IMMEDIATE`, where the value can never have changed — so a
  re-read makes the guard a provable no-op and the value must ride on the
  classification.
- **Every `creation_sha` was minted at status `"pending"`** — `create-graph.ts:230`
  passes `task.status` from a fresh `newTask`, and `apply-graph.ts:573` hardcodes
  `"pending"`. That is what lets migration 20 tell status-only drift from real
  content drift.
- **Migration numbering.** Highest registered version is 19
  (`migrations.ts:462`); the next is **20**. `migrate.ts:56-62` `validateSequence`
  throws unless versions are contiguous `1..n` by array index. Migrations are
  object literals in the single `MIGRATIONS` array (`migrations.ts:9-523`); the
  `Migration` interface is `migrate.ts:8-21`
  (`{ version, name, up(db: DatabaseSync), disableForeignKeys? }`), and the runner
  wraps `up` in its own `BEGIN`/`COMMIT` (`migrate.ts:72-85`).
- **No migration has ever looped in JS** — all 19 are a single `db.exec(\`SQL\`)`,
and none imports domain code. Closest data-step precedents: `migrations.ts:172-177`(SQL`UPDATE`backfill) and`:400-404` (`CASE` transform during a rebuild).
  Story 2 introduces the JS-loop pattern deliberately.
- `graph_import_map` — `migrations.ts:152-161`. Columns
  `package_id, kind, ref, objective_id, task_id, creation_sha`;
  `kind IN ('objective','task')` with
  `CHECK ((objective_id IS NOT NULL) <> (task_id IS NOT NULL))`. Task rows are
  `WHERE task_id IS NOT NULL`; initiatives have no rows. There is no stable id
  column, so a per-row update keys on `rowid`. Only adapter:
  `sqlite-graph-import-map.ts` (`reserve` `:24-30`, `lookup` `:38-44`); the
  `GraphImportMap` port (`port.ts:211-237`) has no update/iterate method, so the
  migration writes SQL directly.
- **`changes` idiom.** `src/storage/sqlite/` reads `changes` **nowhere** today; the
  one precedent is `src/queue/sqlite.ts:15-20` — `const result = stmt.run(...)`
  then `result.changes > 0`. node:sqlite types it `number | bigint`, so compare
  with `>`, never `=== 0`.
- **Why `conditionalDeleteTask` reads before it deletes.** Only
  `graph_import_map.task_id` has `ON DELETE CASCADE` (`migrations.ts:157`);
  `task_dependencies`, `events`, `jobs`, `task_context`, `task_results` are plain
  FK references, which is why `sqlite-task-repository.ts:419-426` deletes them by
  hand. A guarded `DELETE FROM tasks` therefore cannot run first, and
  `sqlite-task-repository.test.ts:1444` requires the row survive a conflict.
  `node:sqlite` is synchronous and the caller holds `BEGIN IMMEDIATE`
  (`apply-graph.ts:438`), so read-then-delete has no interleaving window.
- **17 fake `TaskRepository` implementations** exist, all inside `*.test.ts`; ten
  are byte-identical always-applied boilerplate. Full table in Story 1 B7. No
  production fake exists. `CasResult` stays untouched — it is shared with the four
  `InitiativeRepository` CAS ops and with `conditionalReparent`.
- No CAS method may open a transaction: `sqlite-unit-of-work.ts:16` throws
  `"nested transaction not supported"`, and `apply-graph.ts:438` already holds one.
- **Manifest.** `ExportManifest` — `graph-package.ts:37-50`, `formatVersion:
number`, parsed as an unchecked `JSON.parse(...) as ExportManifest`
  (`graph-codec.ts:291`) with **no** existing version check anywhere. Producers
  disagree today: `export-initiative.ts:42` hardcodes `1`;
  `import-graph.ts:470-471` writes `GRAPH_FORMAT_VERSION` (= 2, `format.ts:10`)
  only when bindings are present, else `1`. Story 3 unifies them.
  `graph-codec.ts:287` defaults `pkg.formatVersion` to `1` for a **manifest-less**
  package, so the gate must test `manifest.formatVersion`, never `pkg.formatVersion`.
- **There is no error boundary on the `import graph` path.** `main.ts:48` is
  `await program.parseAsync(process.argv)` with no `.catch()`; `runImportGraph` and
  `commands/import/graph.ts:55-92` have no `try`/`catch`. So `UnknownNodeError`,
  `CrossInitiativeError` and `DriftConflictError` — all three already imported by
  `error-map.ts` — currently escape as unhandled rejections on this path. Story 3
  adds the boundary in `runApply` using the `{ ...toResult(err), stdout: [] }` idiom
  from `apps/cli/get.ts:29` and `apps/cli/find.ts:22`.
- 28 test-fixture sites hardcode a manifest `formatVersion`. 27 must move to `3`
  (10 in `apply-graph.test.ts`, 8 in `boundary-cases.test.ts`, 2 each in
  `context-preservation.integration.test.ts` / `create-graph.test.ts` /
  `apps/cli/export.test.ts`, 1 each in `apps/cli/import-graph.test.ts` /
  `apps/cli/index.test.ts` / `apps/cli/commands/special.test.ts`); the 28th
  (`apps/cli/graph-md/parse.test.ts:328`) is parser-only and moves only if the
  suite fails on it. Story 3 lists every line.
- **`export initiative` takes a positional id**, not `--id`:
  `kanthord export initiative <id> --out <dir>`
  (`commands/export/initiative.ts:12-20`).
- CLI output strings: classification lines are
  `` `${className}: ${label}` `` + optional `` ` (${dir}/${sourcePath})` ``
  (`import-graph.ts:185-200`), where `label = cls.name ?? cls.id ?? cls.ref`;
  `created`/`updated` print as `would create:` / `would update:` on dry-run **or**
  any non-applied run. Refusals are `import-graph.ts:294-299`. `get task --id`
  prints `id: `, `title: `, `status: `, `agent: ` (`apps/cli/task.ts:304-309`).
  `list task --initiative --json` emits the raw `TaskRow[]` including `id` and
  `title` (`app/task/list-tasks.ts:6-13`).
- **Test convention.** `node:test` + `node:assert/strict`, flat top-level
  `test(...)`, `.ts` in relative imports. Real-sqlite tests use
  `mkdtempSync(join(tmpdir(), "<prefix>-"))` + `openDatabase` +
  `migrate(db, MIGRATIONS)` (`sqlite-task-repository.test.ts:20-26`), torn down in
  `after`/`finally`. The migration-at-N-1 pattern is `MIGRATIONS.slice(0, N-1)`
  (`migrations.test.ts:494`).
- Three locked assertions hardcode version 19: `migrations.test.ts:65` (test name),
  `:67`, `:981`.
- **`fake@1` requires no bindings and reaches `completed`.**
  `EXECUTOR_BINDING_SPECS` (`binding-resolver.ts:15-24`) lists only `generic@1` and
  `tdd@1`, both requiring `repository` + `ai_provider` + `credential`;
  `pi.ts:401-405` fails a run with no `ai_provider` context. `FakeRunner`
  (`agent-runner/fake.ts:4-34`) honours `--fail <id>` /
  `--fail-transient <id:count>` (`commands/run/daemon.ts:12-23`) and produces no
  landing candidate. Precedent: `scripts/e2e/make-fake-retry-graph.sh`.
  `.fake-agent.json` / `KANTHORD_FAKE_AGENT` is the **pi**-loop seam
  (`main.ts:35-43`) and is irrelevant to `fake@1`.
- A `failed` dependency does not cascade — discard is an explicit command (007.16)
  — so a dependent of a failed task stays `pending` indefinitely.
- `scripts/e2e/` conventions: `#!/usr/bin/env bash`, `set -euo pipefail` as the last
  header line, `OUT="${1:?usage: …}"`, `mkdir -p "$OUT"`, quoted `<<'EOF'`
  heredocs, 75-dash separators, **no `echo`** in generators (proof scripts print one
  terminal success line), mode 755. No shell linter runs anywhere.
- Task frontmatter: only `kind:` is load-bearing at parse time
  (`graph-codec.ts:279-329`); the `# Verification` fence language must be exactly
  `sh` (`:117-146`); `# Instructions` / `# Acceptance Criteria` / `# Verification`
  match on lowercased heading text (`:54-77`). There is no `status:` field in task
  frontmatter.

## Known coverage gaps (accepted, recorded)

- The proof script cannot reach the **id-less map-hit** branch
  (`apply-graph.ts:221-252`), the one path where `creation_sha` is the baseline:
  `--create` stamps `id:` back into the files, so every re-apply takes the manifest
  branch. Story 2's last test covers that branch as a unit instead.
- `fake@1` means the proof does not exercise the `generic@1` pipeline in which the
  bug was originally measured (no landing, no repository). Deliberate: the epic's
  claim is about classification, and a `generic@1` proof would need three resources
  plus the landing/approve loop.
- Proof step 3 (a pending task's edit still applies) passes on today's code too —
  it is a regression guard, not evidence of the fix.

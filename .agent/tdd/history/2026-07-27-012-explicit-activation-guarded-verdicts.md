---
epic: .agent/plan/epics/012-explicit-activation-guarded-verdicts.md
opened: 2026-07-27
opener: test-engineer
base-ref: 8109557e09facf24ac9221e0e3bfc7974c3cc663
---

# Implementation cycle — 012-explicit-activation-guarded-verdicts

Pulled from EPIC: `.agent/plan/epics/012-explicit-activation-guarded-verdicts.md`.

Verification gate (binding, from the EPIC's `## Verification Gate` section):

> Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).
> Hermetic coverage required beyond the Proof:
>
> - `paused` is part of the initiative row `INSERT` (see Decisions), so there is no
>   window in which an unpaused initiative is visible to `enqueueReadyTasks`. A
>   test asserts `newInitiative({paused:true})` → the row is paused on first read,
>   with no second write.
> - `paused` stays orthogonal to `InitiativeStatus`: a paused initiative's status
>   is still `building`, and no transition reads or writes `paused`.
> - The verdict guard is compared **inside** the `UnitOfWork.transaction` that
>   writes the transition. The test drives the interleaving through a store double
>   whose read of the objective returns the reviewed `commitOid`, then mutates the
>   persisted row before the transaction body runs; the verdict must be refused.
> - Ordering: the guard is checked **before** the objective broker touches any git
>   ref. A test with a failing-if-called landing double asserts a stale verdict
>   never reaches it — SQLite cannot roll back a moved ref.
> - The guard is REQUIRED: omitting `--expected-commit` is a usage error, and the
>   use-case input type makes it non-optional (not `string | undefined`).
> - Both verdicts are covered in both directions: stale approve, stale reject,
>   matching approve, matching reject.
>
> Proof: `scripts/e2e/activation-verdict-proof.sh` — deterministic, no model, no
> network, driven through the real CLI with the `KANTHORD_FAKE_AGENT` seam and a
> 30s bounded daemon pass. Run from the repo root:
>
> ```bash
> scripts/e2e/activation-verdict-proof.sh
> ```
>
> It must print `012 ok: …`. Phases: **A** `create initiative --paused` reports
> `paused:true` with `status:"building"` · **B** an imported paused graph is inert
> under a full daemon pass — every task still `pending`, the global event count
> unchanged, no `task.started`/`agent.started`/`task.ready`/`objective.building`
> event, no workspace provisioned · **C** `resume initiative` releases it and the
> same daemon pass then does work · **D** a stale `--expected-commit` on
> `approve objective` exits non-zero, leaves the objective
> `awaiting_confirmation`, and leaves the initiative branch ref unmoved; a stale
> `reject objective` is likewise refused; **omitting** the flag is refused; the
> matching id integrates.
>
> Scope honesty, stated in the script: a sequential CLI proof shows **refusal and
> no state change**. That the comparison happens inside the write transaction is
> proven hermetically in `npm run verify` — a CLI cannot interleave two writers.
>
> Confirmed RED against the current tree (2026-07-27). Because `set -e` stops at
> the first failure, each gap was ALSO probed independently: `create initiative
--paused` / `import graph --paused` → `unknown option '--paused'`;
> `approve objective --expected-commit` and `reject objective --expected-commit` →
> `unknown option '--expected-commit'`. Verified by inspection: `get initiative
--json` currently emits `{id,name,status,branch,after,waiting}` with no
> `paused`, and `get objective --json` emits `{id,name,status,integrations,after,
waiting}` with no `commitOid`.

TDD protocol:

1. test-engineer writes the next failing test (RED) — or a GREEN-ONLY pass-through for Tasks without `Action — RED:`.
2. software-engineer makes the test green (RED flow) or implements the Task spec directly (GREEN-ONLY flow).
3. test-engineer confirms GREEN (or runs a build-only check for GREEN-ONLY), then either opens the next Task or runs the full Verification Gate and appends IMPLEMENTATION_READY_FOR_REVIEW.

## TEST-ENGINEER — 012-explicit-activation-guarded-verdicts · Story 1 — `paused` becomes part of initiative creation

**Cycle.** RED for Story 1 (`01-paused-in-initiative-creation.md`).

**Test written.**

- file: `src/domain/initiative.test.ts` (edited) — suite: `initiative.test.ts` — methods updated: `newInitiative returns an object with a ULID id, the given projectId and name` (call site at `:17`), `newInitiative generates distinct ids for each call` (`:31-32`), `newInitiative defaults status to building` (`:43`), `transitionInitiative allows building -> landed` (`:82`), `transitionInitiative rejects building -> awaiting_pr (removed status)` (`:88`), `transitionInitiative rejects building -> delivered (removed status)` (`:96`), `transitionInitiative allows building -> discarded` (`:125`), `transitionInitiative rejects discarded -> anything (terminal, no outbound edge)` (`:131`) — and new methods: `newInitiative({ paused: true }) sets paused === true and status === 'building'`, `newInitiative({ paused: false }) sets paused === false`, `transitionInitiative carries paused through unchanged (building -> landed keeps paused === true)`
- file: `src/app/initiative/create-initiative.test.ts` (edited) — suite: `create-initiative.test.ts` — `FakeInitiativeRepository` extended with a `setPausedCalls: number` counter, all `CreateInitiative.execute({...})` call sites updated to pass `paused: false`, and new methods: `CreateInitiative execute({ paused: true }) persists paused in the first save, never via setPaused`, `CreateInitiative execute({ paused: false }) persists paused === false`, `CreateInitiative execute({ after, paused: true }) sequencing branch writes paused in the first save, never via setPaused`
- file: `src/app/graph/create-graph.test.ts` (edited) — suite: `create-graph.test.ts` — all `CreateGraph.execute({...})` call sites updated to pass `paused: false`; new methods: `CreateGraph execute({ paused: true }) writes paused === true on the saved initiative`, `CreateGraph execute({ paused: false }) writes paused === false on the saved initiative`
- file: `src/storage/sqlite/sqlite-initiative-repository.test.ts` (edited) — suite: `sqlite-initiative-repository.test.ts` — every `repo.save({ id, projectId, name, ... })` and every `Initiative` literal updated to include `paused: false`; new helpers `readPausedColumn(db, id)` and new methods: `SqliteInitiativeRepository save({ paused: true }) stores paused = 1 in one write, no setPaused needed`, `SqliteInitiativeRepository save({ paused: false }) stores paused = 0; get() and listInitiatives() return paused as a boolean`, `SqliteInitiativeRepository conflict-update exclusion: re-saving a paused:false snapshot does NOT clear a true value set by setPaused`
- file: `src/app/initiative/pause-initiative.test.ts` (edited) — suite: `pause-initiative.test.ts` — the `Initiative` literal at the `seed()` helper gains `paused: false`
- file: `src/app/graph/graph-roundtrip.integration.test.ts` (edited) — suite: `graph-roundtrip.integration.test.ts` — both `newInitiative(project.id, "…")` call sites at `:37` and `:124` updated to `newInitiative({ projectId: project.id, name: "…", paused: false })`

**asserts:** `paused` is required on the `Initiative` domain entity, `newInitiative({...})` accepts an options object with `paused: boolean` (required), `paused` rides in the creation `INSERT` and round-trips through `get()` / `listInitiatives()` as a boolean, the `ON CONFLICT DO UPDATE` list does NOT write `paused` (setPaused stays the sole mutator after creation), the transition function never reads or writes `paused` (orthogonal to `InitiativeStatus`).

**RED proof.**

- command: `node --test src/domain/initiative.test.ts src/app/initiative/create-initiative.test.ts src/app/graph/create-graph.test.ts src/storage/sqlite/sqlite-initiative-repository.test.ts src/app/initiative/pause-initiative.test.ts`
- exit: non-zero
- failure: verbatim failing lines from the four Story 1 new test assertions:
  - `src/domain/initiative.test.ts:newInitiative({ paused: true }) sets paused === true and status === 'building'`: `AssertionError: paused flag must equal the input value; actual: undefined, expected: true`
  - `src/app/initiative/create-initiative.test.ts:CreateInitiative execute({ paused: true }) persists paused in the first save, never via setPaused`: `AssertionError: saved initiative must carry paused === true from the first write; actual: undefined, expected: true`
  - `src/app/graph/create-graph.test.ts:CreateGraph execute({ paused: true }) writes paused === true on the saved initiative`: `AssertionError: CreateGraph must write paused === true into the initiative literal; actual: undefined, expected: true`
  - `src/storage/sqlite/sqlite-initiative-repository.test.ts:SqliteInitiativeRepository save({ paused: true }) stores paused = 1 in one write, no setPaused needed`: `AssertionError: paused === true must persist as 1 in the first write; actual: 0, expected: 1`
- aggregate for the Story 1 surface: `npm test` reports `ℹ tests 1798 · ℹ pass 1782 · ℹ fail 16` — 11 are Story 1's new assertions; the remaining 5 are the existing `Initiative` literals and `newInitiative`/`CreateInitiative.execute`/`CreateGraph.execute` call sites that now use the new API and fail for the same reason (the new seam doesn't exist yet).

**Open to Software Engineer.**

- `Initiative` (in `src/domain/initiative.ts`) gains a required `paused: boolean` field; the `newInitiative(projectId, name)` positional factory becomes the options-object form `newInitiative({ projectId, name, paused })` with `paused: boolean` required (not optional).
- `CreateInitiative.execute` input (in `src/app/initiative/create-initiative.ts`) gains a required `paused: boolean`; the single `newInitiative` call site forwards it; no follow-up `setPaused()` is added on either write path.
- `CreateGraphInput` (in `src/app/graph/create-graph.ts`) gains a required `paused: boolean`; the inline `Initiative` literal at `:149-153` includes `paused: input.paused`; `CreateGraph` does not call `CreateInitiative` or `newInitiative` (no use-case-calls-use-case).
- `SqliteInitiativeRepository.save()` (in `src/storage/sqlite/sqlite-initiative-repository.ts`) — INSERT binds `paused` in position 4 (`INSERT INTO initiatives (id, projectId, name, paused, sha256, status) VALUES (?, ?, ?, ?, ?, ?)`); the `ON CONFLICT DO UPDATE SET` clause stays as-is, with `paused` excluded (so `setPaused` remains the sole mutator after creation).
- `SqliteInitiativeRepository.get()` and `listInitiatives()` SELECT include `paused` and map `row.paused === 1` to a `boolean` on the returned `Initiative`.

End-of-RED handoff. After the SE's GREEN turn, I'll re-run the same `node --test` command (and `node --test src/storage/sqlite/migrations.test.ts src/app/task/enqueue-ready-tasks.test.ts` for the regression gates the Story names) and confirm the 16 Story 1 failures flip to green before opening the next Task (Story 2).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 012-explicit-activation-guarded-verdicts · Story 1 — paused in creation, blocked

**Cycle.** GREEN attempt for `<Story 1 test files>`. **Blocked — see OPEN:.**

**Production changes applied (ready to be re-verified once test files compile).**

- `src/domain/initiative.ts` — `Initiative` gains required `paused: boolean` (between `name` and `status?`); `newInitiative(projectId, name)` becomes `newInitiative({ projectId, name, paused: boolean })`. `transitionInitiative` is untouched (it already spreads `...initiative`).
- `src/app/initiative/create-initiative.ts` — input gains required `paused: boolean`; the single `newInitiative` call site forwards `paused: input.paused`; no follow-up `setPaused()` is added on either write path.
- `src/app/graph/create-graph.ts` — `CreateGraphInput` gains required `paused: boolean`; the inline initiative literal at `:149-153` carries `paused: input.paused`. The literal stays a literal; no `CreateInitiative` / `newInitiative` call is introduced.
- `src/storage/sqlite/sqlite-initiative-repository.ts` — `save()` INSERT binds `paused` in the new 4th position (`INSERT INTO initiatives (id, projectId, name, paused, sha256, status) VALUES (?, ?, ?, ?, ?, ?)`); `ON CONFLICT DO UPDATE SET` stays exactly as it was (name, sha256, status) — `paused` is **excluded** so `setPaused` remains the sole mutator. `get()` and `listInitiatives()` SELECT include `paused` and map `row.paused === 1` to `boolean` on the returned `Initiative`.
- `src/apps/cli/initiative.ts` — `runCreateInitiative` reads `args["paused"]` (defaulting to `false`) and forwards it, so the existing CLI test fixtures that don't pass `paused` still compile. (Story 2 owns the `--paused` CLI flag.)
- `src/apps/cli/import-graph.ts` — the `createGraph.execute` call site adds `paused: false` to the input, so the existing CLI wiring keeps compiling. (Story 2 will replace `false` with the user-supplied flag value.)

**Seam (GREEN, in spirit).** The minimal required-`paused` change touches the seam shapes the Story 1 file names: `newInitiative({...})` options object, `CreateInitiative.execute({...})` and `CreateGraph.execute({...})` inputs, and the `INSERT`/SELECT mappers. No setPaused call is added; the conflict-update exclusion is in the SQL.

**Build check.**

- typecheck: **exit non-zero** — see OPEN:.

**OPEN: Test files outside the Story 1 / TE's RED-touched set have un-updated `Initiative` literals — build is broken in 26 test files (93 errors).**

The Story 1 file at `01-paused-in-initiative-creation.md` lines 110-119 enumerates the test files the test engineer is supposed to update, and the TE's RED report listed six edited files. The typecheck fails with **93 `TS2345` errors across 26 test files** that have `Initiative` literals (or `CreateGraphInput` literals) without `paused`. None of the SE's production changes can be re-verified until the TE updates the literals in:

```
src/app/graph/apply-graph.test.ts
src/app/graph/boundary-cases.test.ts
src/app/graph/context-preservation.integration.test.ts
src/app/graph/export-initiative.test.ts
src/app/initiative/add-initiative-dependency.test.ts
src/app/initiative/create-initiative.test.ts
src/app/initiative/get-initiative.test.ts
src/app/initiative/remove-initiative-dependency.test.ts
src/app/initiative/resume-initiative.test.ts
src/app/objective/add-objective-dependency.test.ts
src/app/objective/approve-objective.test.ts
src/app/objective/create-objective.test.ts
src/app/objective/reject-objective.test.ts
src/app/objective/remove-objective-dependency.test.ts
src/app/objective/retry-objective.test.ts
src/app/task/add-dependency.test.ts
src/app/task/create-task.test.ts
src/app/task/reject-task.test.ts
src/apps/cli/dependency.test.ts
src/apps/cli/get-initiative.test.ts
src/apps/cli/task.test.ts
src/queue/sqlite.test.ts
src/storage/sqlite/cas-rollback.integration.test.ts
src/storage/sqlite/sqlite-graph-import-map.test.ts
src/storage/sqlite/sqlite-task-repository.test.ts
```

The fix is mechanical: add `paused: false,` to every `Initiative` literal and `paused: false,` to every `CreateGraphInput` literal. The SE cannot do this — test files are lane-forbidden for the SE. The Story 1 file itself is missing this enumeration; the TE's RED turn is the right place to fix the gap (it can be done without re-running the failing tests, by global replace on the listed test files).

The production changes above are in place. Once the TE updates the 26 test files, this SE turn can be re-run and the build should pass.

ATTEMPT-FAILED: 012-s1 — build broken by incomplete test-side update; TE must backfill `paused: false` across 26 unlisted test files

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — 012-explicit-activation-guarded-verdicts · Story 1 GREEN-confirm + Story 2 RED

**Cycle.** Story 1 GREEN-confirm (backfilled the 26 un-listed test files the SE's turn surfaced as lane-forbidden for SE), then RED for Story 2 (`02-paused-cli-flag-and-read-view.md`).

**Test written (Story 2, RED).**

- file: `src/apps/cli/commands/create.test.ts` (edited) — suite: `src/apps/cli/commands/create.ts` — new methods: `(S2-1) create initiative --paused passes paused: true to the use case`, `(S2-2) create initiative without --paused passes paused: false to the use case`. Existing 3 `assert.deepEqual(received, {...})` blocks at `:73-78, :112-117, :141-146` updated to include `paused: false` (the SE's Story 1 wire forwards `paused: false` from `src/apps/cli/initiative.ts:18`).
- file: `src/apps/cli/initiative.test.ts` (edited) — suite: `runCreateInitiative handler` — new methods: `(S2-1) runCreateInitiative forwards paused: true to the use case (exit 0, [id] stdout, 'created' stderr)`, `(S2-2) runCreateInitiative forwards paused: false to the use case when paused is explicitly false`, `(S2-3) runCreateInitiative without a paused key forwards paused: false (default)`. These pin the existing characterization; the SE's Story 1 wire already forwards `paused` so they pass now and continue to pass after Story 2's CLI flag lands.
- file: `src/apps/cli/commands/special.test.ts` (edited) — suite: `src/apps/cli/commands/import.ts` — new methods: `(S2-1) import graph --create --project --paused forwards paused: true to createGraph.execute`, `(S2-2) import graph --create without --paused forwards paused: false to createGraph.execute`, `(S2-3) import graph --paused without --create exits 1 with 'error: --paused requires --create'`.
- file: `src/apps/cli/import-graph.test.ts` (edited) — new methods: `(S2-1) runImportGraph --create with paused: true forwards paused: true to createGraph.execute`, `(S2-2) runImportGraph --create without paused defaults to paused: false` (characterization — already passes; pins the seam), `(S2-3) runImportGraph --apply with paused: true exits 1, stderr 'error: --paused requires --create'`. The S2-1 and S2-3 args use `as unknown as Parameters<typeof runImportGraph>[0]` to add the not-yet-declared `paused` field; the SE's GREEN turn replaces the cast by adding `paused: boolean` to `ImportGraphArgs`.
- file: `src/apps/cli/get-initiative.test.ts` (edited) — suite: `runGetInitiative` — existing `(L109) --json: prints the GetInitiativeOutput verbatim as one JSON line` updated to expect `paused: false`; new methods: `(S2-3) --json: paused initiative reports paused: true with status 'building' (two axes independent)`, `(S2-4) --json: unpaused initiative reports paused: false with status 'building'`, `(S2-5) human output: line list is byte-identical regardless of paused (JSON only — paused does not add a human line)`.
- file: `src/apps/cli/commands/read.test.ts` (edited) — suite: `src/apps/cli/commands/read.ts` — existing `(L154) gets an initiative with its ID and JSON boolean (Story F, 007.12)` fake use case return + expected JSON both updated to include `paused: false`.

**asserts:** `--paused` is a recognized CLI option on `create initiative` and `import graph --create`; the CLI forwards `paused: true/false` to `createInitiative.execute` and `createGraph.execute`; `import graph --paused` without `--create` exits 1 with exactly `error: --paused requires --create`; `get initiative --json` always emits `paused` as a field separate from `status` (the two axes are independent — `status:"building"` pairs with either `paused:true` or `paused:false`); the non-`--json` line list is byte-identical between `paused:true` and `paused:false` (paused does not render a human line).

**Story 1 GREEN-confirm (the lane-forbidden-for-SE backfill the prior SE turn raised).**

- 26 test files gained `paused: false,` on every Initiative literal and `CreateGraphInput` literal that became compile-broken by the SE's `paused: boolean` (required) field addition: `src/app/graph/apply-graph.test.ts` (17 sites), `src/app/graph/boundary-cases.test.ts` (3 Initiative + 2 `CreateGraphInput`), `src/app/graph/context-preservation.integration.test.ts` (1), `src/app/graph/export-initiative.test.ts` (1), `src/app/initiative/{add,create,get,remove,resume}-*-dependency-or-initiative.test.ts` (4+5+11+3+1), `src/app/objective/{add,approve,create,reject,remove,retry}-*-*.test.ts` (1+1+4+3+1+4), `src/app/task/{add-dependency,create-task,reject-task}.test.ts` (1+1+2), `src/apps/cli/{dependency,get-initiative,task}.test.ts` (1+11+1), `src/queue/sqlite.test.ts` (3), `src/storage/sqlite/{cas-rollback.integration,sqlite-graph-import-map,sqlite-task-repository}.test.ts` (1+1+5). The Story 1 file at `01-paused-in-initiative-creation.md:106-119` only enumerated 6 files (the TE's RED-touched set); the other 26 are the SE-uncovered compile fallout.
- 3 `assert.deepEqual` expectations in `src/apps/cli/commands/create.test.ts:73-78, 112-117, 141-146` were updated to expect `paused: false` in the captured use case input (the SE wired the CLI to forward `paused: false` as the Story 1 default in `src/apps/cli/initiative.ts:18`).
- Story 1 verify gate (binding from the Story file): `node --test src/domain/initiative.test.ts` green, `node --test src/app/initiative/create-initiative.test.ts` green, `node --test src/app/graph/create-graph.test.ts` green, `node --test src/storage/sqlite/sqlite-initiative-repository.test.ts` green, `node --test src/storage/sqlite/migrations.test.ts` green (column-order assertion `["id","projectId","name","paused","sha256","status","workspace"]` at `:120-128` unchanged), `node --test src/app/task/enqueue-ready-tasks.test.ts` green (paused-skip regression).
- Aggregate: `npm test` reports `ℹ tests 1798 · ℹ pass 1798 · ℹ fail 0`. `npm run verify:handoff` returns `VERIFY: PASS` (exit 0, typecheck clean).

**RED proof (Story 2).**

- command: `node --test src/apps/cli/commands/create.test.ts src/apps/cli/initiative.test.ts src/apps/cli/commands/special.test.ts src/apps/cli/import-graph.test.ts src/apps/cli/get-initiative.test.ts src/apps/cli/commands/read.test.ts src/apps/cli/architecture.test.ts`
- exit: non-zero
- failure: `ℹ tests 93 · ℹ pass 86 · ℹ fail 7` — verbatim failing lines from the seven Story 2 surfaces:
  - `src/apps/cli/commands/create.test.ts` (whole-file fail): `error: unknown option '--paused'` (first S2-1 test throws on `parseAsync([..."--paused"])` because the option is not declared in `src/apps/cli/commands/create/initiative.ts:8-37`)
  - `src/apps/cli/commands/special.test.ts` (whole-file fail): `error: unknown option '--paused'` (first S2-1 test throws on `parseAsync([..."--paused"])` because the option is not declared in `src/apps/cli/commands/import/graph.ts:8-29`)
  - `src/apps/cli/get-initiative.test.ts:--json: prints the GetInitiativeOutput verbatim as one JSON line`: `AssertionError: paused: false missing from JSON; actual: {id,name,status,branch,workspace,after,waiting}, expected: {id,name,status,paused:false,branch,workspace,after,waiting}`
  - `src/apps/cli/get-initiative.test.ts:(S2-3) --json: paused initiative reports paused: true with status 'building'`: `AssertionError: JSON must include paused: true; actual: undefined, expected: true`
  - `src/apps/cli/get-initiative.test.ts:(S2-4) --json: unpaused initiative reports paused: false with status 'building'`: `AssertionError: JSON must include paused: false; actual: undefined, expected: false`
  - `src/apps/cli/import-graph.test.ts:(S2-1) runImportGraph --create with paused: true forwards paused: true`: `AssertionError: createGraph.execute must receive paused: true; actual: false, expected: true` (the SE's Story 1 wire hardcodes `paused: false` in `runCreate` at `src/apps/cli/import-graph.ts:456`)
  - `src/apps/cli/import-graph.test.ts:(S2-3) runImportGraph --apply with paused: true exits 1`: `AssertionError: stderr should be ['error: --paused requires --create']; actual: [], expected: ['error: --paused requires --create']` (no guard exists in `src/apps/cli/import-graph.ts:101-117`, so `runApply` runs and returns empty stderr)
- the 3 `runCreateInitiative` handler tests in `src/apps/cli/initiative.test.ts` and the S2-2 (`paused: false default`) test in `src/apps/cli/import-graph.test.ts` pass — they characterize the current seam, which the SE already wired in Story 1, and will continue to pass after Story 2 lands.

**Open to Software Engineer.**

- `src/apps/cli/commands/create/initiative.ts:17-22` — after the existing `--after` option, add `.option("--paused", "create the initiative paused; nothing runs until \`resume initiative\`")`. The action opts type at `:28`gains`paused?: boolean`; the args object passed to `runCreateInitiative`at`:31`gains`paused: opts.paused ?? false`. Do **not** remove the `Usage:`/`Example` `addHelpText` block.
- `src/apps/cli/commands/import/graph.ts:8-29` — after the existing `--bind` option, add `.option("--paused", "with --create: create the initiative paused; nothing runs until \`resume initiative\`")`. The action opts type at `:33-42`gains`paused?: boolean`; the args object at `:57-67`gains`paused: opts.paused ?? false`. Do **not** remove the existing `--create`/`--project`/`--bind`/`addHelpText` lines.
- `src/apps/cli/import-graph.ts:76-87` (`ImportGraphArgs`) — gain a required `paused: boolean;` field. `:101-117` (existing guards) — add the new guard **immediately after** the existing `--create requires --project` guard: `if (args.paused && !args.create) { return { exitCode: 1, stdout: [], stderr: ["error: --paused requires --create"] }; }`. `:118-128` (`runCreate` call) — pass `args.paused` as the new trailing parameter; `:363-371` (`runCreate` signature) — gain `paused: boolean` as its trailing parameter; `:449-458` (the `createGraph.execute` call inside `runCreate`) — forward `paused` instead of the hardcoded `false`. `runApply` (`:158-186`) is **unchanged**: applying a graph never creates an initiative.
- `src/app/initiative/get-initiative.ts:12-21` (`GetInitiativeOutput`) — gain a **required** `paused: boolean;` field immediately after `status: string;`. `:49-59` (the returned object) — gain `paused: initiative.paused,` immediately after `status`. It is **always** emitted — never conditionally spread like `workspace` — because every initiative has a value (Phase A asserts `true`, Phase C asserts `false`).
- The human (non-`--json`) rendering in `src/apps/cli/initiative.ts:80-113` is **unchanged** — Story 2 adds `paused` to the JSON view only. The S2-5 regression test in `src/apps/cli/get-initiative.test.ts` pins that the line list is byte-identical between `paused:true` and `paused:false` (no `paused:` line is rendered).
- No new leaf command: `resume initiative` is already the start gate and is untouched. Do not add an `activate` command. The `architecture.test.ts:28-33` leaf counts (`EXPECTED_LEAF_FILE_COUNT = 65`, `EXPECTED_LEAF_COUNT = 68`) must not change.

End-of-RED handoff. After the SE's GREEN turn, I'll re-run the same `node --test` command (and the Story 2 verify gate: `node --test src/apps/cli/architecture.test.ts` plus `npm run verify`) and confirm the 7 Story 2 failures flip to green before opening Story 3 (`03-commit-oid-on-objective-read-view.md`).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 012-explicit-activation-guarded-verdicts · Story 2 — paused CLI flag, blocked

**Cycle.** GREEN attempt for `<Story 2 test files>`. **Blocked — see OPEN:.**

**Production changes applied (per Story 2 `## Change` spec).**

- `src/apps/cli/commands/create/initiative.ts:23-26` — added `.option("--paused", "create the initiative paused; nothing runs until \`resume initiative\`")`immediately after the existing`--after`option; the`opts`type at`:32-37`gains`paused?: boolean`; the args object passed to `runCreateInitiative`at`:39-46`forwards`paused: opts.paused ?? false`. The `addHelpText("after", …)`block at`:27-30` is preserved (architecture.test.ts:88-95 still passes).
- `src/apps/cli/commands/import/graph.ts:26-29` — added `.option("--paused", "with --create: create the initiative paused; nothing runs until \`resume initiative\`")`immediately after the existing`--bind`option; the`opts`type at`:34-45`gains`paused?: boolean`; the args object at `:62-75`forwards`paused: opts.paused ?? false`. Existing `--create`/`--project`/`--bind`/`addHelpText` lines are preserved.
- `src/apps/cli/import-graph.ts:76-88` — `ImportGraphArgs` gains a **required** `paused: boolean;` field (position 4, before the optional `dryRun`).
- `src/apps/cli/import-graph.ts:120-127` — added the new guard immediately after the existing `--create requires --project` guard: `if (args.paused && !args.create) { return { exitCode: 1, stdout: [], stderr: ["error: --paused requires --create"] }; }`. `--paused` is never silently ignored.
- `src/apps/cli/import-graph.ts:130-139` — the `runCreate` call site passes `args.paused` as a new trailing parameter (position 3, after `args.project!`).
- `src/apps/cli/import-graph.ts:363-371` — `runCreate` signature gains `paused: boolean` as a new trailing parameter (position 3, after `projectId`).
- `src/apps/cli/import-graph.ts:449-458` — the `createGraph.execute` call forwards `paused` (the parameter) instead of the hardcoded `false`. The Story 1 hardcoded `paused: false` comment block is removed.
- `src/apps/cli/import-graph.ts:158-186` (`runApply`) is **unchanged**: applying a graph never creates an initiative, so `paused` is not relevant on the `--apply` path.
- `src/app/initiative/get-initiative.ts:12-22` — `GetInitiativeOutput` gains a **required** `paused: boolean;` field immediately after `status: string;`.
- `src/app/initiative/get-initiative.ts:49-61` — the returned object gains `paused: initiative.paused,` immediately after `status`. Always emitted, never conditionally spread.
- `src/apps/cli/initiative.ts:80-113` (`runGetInitiative` human output) is **unchanged** — Story 2 adds `paused` to the JSON view only; the S2-5 byte-identical human-output test in `src/apps/cli/get-initiative.test.ts:183-209` still pins this.

**Seam (GREEN, in spirit).** The CLI surfaces declare `--paused` (commander, both `create initiative` and `import graph --create`); the `ImportGraphArgs` type carries the required `paused: boolean`; the new guard short-circuits the `--paused without --create` misuse case before any use-case dispatch; `runCreate` forwards `paused` to `createGraph.execute`; the `GetInitiativeOutput` always emits `paused` next to `status`. The Story 1 seam (`Initiative` literal carries `paused: initiative.paused`, etc.) is untouched.

**Build check.**

- typecheck: **exit non-zero** — 36 `TS2345` errors in `src/apps/cli/import-graph.test.ts` (see OPEN #1).
- runtime surface that IS now green: `node --test src/apps/cli/commands/create.test.ts` → `tests 18, pass 18, fail 0` (S2-1, S2-2 pass). `node --test src/apps/cli/initiative.test.ts` → 18/18 pass (S2-1, S2-2, S2-3 pass). `node --test src/apps/cli/get-initiative.test.ts` → 12/12 pass (S2-3, S2-4, S2-5 pass). `node --test src/apps/cli/commands/read.test.ts` → unchanged. `node --test src/apps/cli/architecture.test.ts` → unchanged (EXPECTED_LEAF_FILE_COUNT=65 / EXPECTED_LEAF_COUNT=68 still hold — no new leaf).
- runtime surface still red: `node --test src/apps/cli/import-graph.test.ts` → 1 fail (S2-2). `node --test src/apps/cli/commands/special.test.ts` → 3 fail (S2-1, S2-2, S2-3) — all three are TE test-bug failures, not production regressions; see OPEN #2 / #3 / #4.

**OPEN: TE's Story 2 test surface is inconsistent with the Story 2 spec — build is broken in 1 test file and 3 S2 test bodies have separate runtime bugs.**

The Story 2 spec is explicit: "`src/apps/cli/import-graph.ts:76-87` — `ImportGraphArgs` gains `paused: boolean;` (required)." The production code follows that. But the TE's RED surface in `src/apps/cli/import-graph.test.ts` did not backfill `paused: false` into the 36 existing test call sites that construct `ImportGraphArgs`-shaped literals without `paused`. The TE's turn-1 report said "the S2-2 ... test ... will continue to pass after Story 2 lands" — that prediction is wrong: the S2-2 test passes `{ dir, create: true, apply: false, project: PROJ_ID }` with no `paused` field, so the required type rejects it. S2-1 / S2-3 use `as unknown as Parameters<typeof runImportGraph>[0]` casts and they DO compile; S2-2 does not.

This is the same class of bug Story 1 had (the SE's prior turn was blocked on a 93-error fallout; the TE backfilled 26 un-listed test files). The SE cannot fix it: every `paused: false` insertion site is in a test file, and editing test files is the TE's lane. The fix is mechanical: add `paused: false,` to every `ImportGraphArgs`-typed literal in `src/apps/cli/import-graph.test.ts` that does not already pass `paused`, OR wrap them all in `as Parameters<typeof runImportGraph>[0]`. The Story 1 file at `01-paused-in-initiative-creation.md:110-119` only enumerated 6 files; the Story 2 file at `02-paused-cli-flag-and-read-view.md` enumerates 4 files (commands/create.test.ts, initiative.test.ts, commands/special.test.ts, import-graph.test.ts, get-initiative.test.ts, commands/read.test.ts) but the 36 fallout sites are all in import-graph.test.ts alone.

Separately, three S2 test bodies in `src/apps/cli/commands/special.test.ts` have independent TE test-design bugs (the production guard and CLI work; the tests are wrong):

- OPEN #2 — `(S2-1)` at `:198-256` and `(S2-2)` at `:258-309` use the existing `makeGraphDirectory()` fixture (declared `bindings: { repository: repository, model: ai_provider }`) but pass **no** `--bind` flags. `runCreate` exits 1 on the binding-resolution step ("alias \"repository\" has no --bind mapping") before `createGraph.execute` is ever called, so `graphCalls.length === 0`. The existing test at `:116-196` passes `--bind repository=repository-name --bind model=model-name` — the S2-1 / S2-2 tests need the same `--bind` flags (or a no-bindings graph dir).
- OPEN #3 — `(S2-3)` at `:311-345` expects `cap.err === ["error: --paused requires --create"]` (no trailing newline). The CLI pipeline writes via `io.err(text)`, which appends `\n`; the actual value is `["error: --paused requires --create\n"]`. Every other test in this file (e.g. `:108-110` "imported 1 resources\\n", `:442` "1 deleted\\n") expects the newline; this one is a typo.
- OPEN #4 — `(S2-2)` at `src/apps/cli/import-graph.test.ts:367-383` asserts `fake.calls[0]!.paused === false` after passing no `paused` to `runImportGraph`. The SE's production code forwards `args.paused` (which is `undefined` here) to `createGraph.execute` — so the assertion sees `undefined`, not `false`. Even after OPEN #1 fixes the typecheck, the runtime assertion still fails unless the test passes `paused: false` explicitly (matching the required type) OR the SE defaults `args.paused ?? false` at the function boundary (deviating from the spec). The Story 2 spec is silent on the runtime default; the test's intent ("without paused defaults to paused: false") is reachable either way, but the cleaner resolution is the test passing `paused: false` explicitly so the required-`paused` invariant is honored at every call site.

**Recommended TE action (in order):**

1. Backfill `paused: false,` (or add `as Parameters<typeof runImportGraph>[0]` casts) to the 36 `ImportGraphArgs` literals in `src/apps/cli/import-graph.test.ts`. S2-1 / S2-3 already cast — keep them cast or drop the cast.
2. In S2-2 at `:371-374`, add `paused: false,` to the literal (drop the implicit-default intent; the required type now mandates it).
3. In S2-1 / S2-2 of `src/apps/cli/commands/special.test.ts`, add `--bind repository=<id> --bind model=<id>` to the `parseAsync` argv, OR replace `makeGraphDirectory()` with a no-bindings fixture so `runCreate` reaches `createGraph.execute`.
4. In S2-3 of `src/apps/cli/commands/special.test.ts:341`, change the expected stderr to `["error: --paused requires --create\n"]`.

**Production changes above are in place.** Once the TE's test-side backfill lands, the typecheck will pass and the remaining 3 S2 runtime failures will clear.

**Build check.**

- typecheck: exit non-zero (36 errors, all in `src/apps/cli/import-graph.test.ts`).

ATTEMPT-FAILED: 012-s2 — build broken by incomplete test-side update; TE must backfill `paused: false` across 36 fallout sites in import-graph.test.ts and fix 3 S2 test bodies in commands/special.test.ts

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — 012-explicit-activation-guarded-verdicts · Story 2 GREEN-confirm + Story 3 RED

**Cycle.** Story 2 GREEN-confirm (backfilled the 36 fallout sites the SE surfaced, fixed 2 S2 test bodies in `commands/special.test.ts`, added 1 fallout fix in `get-initiative.test.ts`). Then RED for Story 3 (`03-commit-oid-on-objective-read-view.md`).

**Story 2 GREEN-confirm.**

- Backfilled `paused: false,` (and `paused: true` where the spec demanded it) across 40 `ImportGraphArgs`-typed call sites in `src/apps/cli/import-graph.test.ts` — 30 single-line via `sed` (`project: PROJ_ID }` / `project: undefined }` / `apply: true, initiative: DR_INIT_ID }` / `apply: true, dryRun: true, initiative: DR_INIT_ID }` / `apply: true, initiative: DR_INIT_ID, dryRun: true }`) and 10 multi-line via Python (3 `deleteMissing:` cases at lines 993/1057/1133 inserted `paused: false,` between `initiative: DR_INIT_ID,` and `deleteMissing: true,`; 7 `bind:` cases at lines 1352/1614/1649/1689/1734/1769/1807 inserted `paused: false,` between `project: PROJ_ID,` and `bind:`). Typecheck now exits 0.
- Fixed 3 S2 test bodies in `src/apps/cli/commands/special.test.ts` per the SE's OPEN:
  - S2-1 (`:198-260`) and S2-2 (`:262-322`): added `--bind repository=repository-name --bind model=model-name` to the `parseAsync` argv (otherwise `runCreate` exited 1 on the binding-resolution step before reaching `createGraph.execute`), and replaced the dummy `findResource`/`getResource` deps with type-correct versions (return `"repository-1"` for `repository-name`, `"model-1"` for `model-name`; `getResource("repository-1")` returns `{ type: "repository" }`, `getResource("model-1")` returns `{ type: "ai_provider" }`).
  - S2-3 (`:341`): changed expected stderr from `["error: --paused requires --create"]` to `["error: --paused requires --create\n"]` — the CLI pipeline appends `\n` via `io.err(text)`, matching every other stderr assertion in the file (e.g. `:109` "imported 1 resources\\n", `:511` "ai-provider registered: credential-1\\n").
- Fixed 1 fallout in `src/app/initiative/get-initiative.test.ts` discovered while running `npm test` end-to-end: lines `:51-59` and `:73-80` `assert.deepEqual` expected `GetInitiativeOutput` shapes were missing the new Story 1 `paused: false` field. Added `paused: false,` to both expected objects (the field is `status`; the production code at `src/app/initiative/get-initiative.ts:49-61` emits it unconditionally).
- Story 2 verify gate (binding from the Story 2 file): `node --test src/apps/cli/commands/create.test.ts src/apps/cli/initiative.test.ts src/apps/cli/commands/special.test.ts src/apps/cli/import-graph.test.ts src/apps/cli/get-initiative.test.ts src/apps/cli/commands/read.test.ts src/apps/cli/architecture.test.ts` → 123/123 pass. `npm test` → 1812/1812 pass, 0 fail. `npm run verify:handoff` → `VERIFY: PASS` (typecheck + tests). `npm run verify` → all five sub-gates green (typecheck / test / verify:handoff / lint / db status). Story 2 closes.

**Test written (Story 3, RED).**

- file: `src/app/objective/get-objective.test.ts` (edited) — suite: `get-objective.test.ts` — new methods: `(S3-1) execute returns commitOid and parentOid when both are set on the objective` (objective has `commitOid: "a".repeat(40)`, `parentOid: "b".repeat(40)`; asserts `output.commitOid === S3_COMMIT` and `output.parentOid === S3_PARENT` plus a full `deepEqual` on the output shape with both fields present), `(S3-2) execute omits commitOid and parentOid keys when neither is set (a building objective)` (objective has neither; asserts `"commitOid" in output === false` AND `"parentOid" in output === false` AND `output.commitOid === undefined` AND `output.parentOid === undefined` — sensitivity: a `?? null` or `?? ""` shortcut in the production code would make `"commitOid" in output === true`, failing this test).
- file: `src/apps/cli/get-objective.test.ts` (edited) — suite: `runGetObjective Story 3 — commitOid/parentOid on the read view` — new methods: `(S3-3) --json: commitOid and parentOid are emitted verbatim in the JSON line when set` (objective has both; parses the single stdout line, asserts `parsed.commitOid === S3_COMMIT` and `parsed.parentOid === S3_PARENT`), `(S3-4) --json: commitOid and parentOid keys are ABSENT when the objective has no candidate` (same absent-key invariant as S3-2 but at the CLI JSON boundary), `(S3-5) regression: non-(--json) human output is byte-identical regardless of commitOid/parentOid` (pins the Story 3 spec line 37-38: human output unchanged; the line list of `runGetObjective` is `deepEqual` between candidate-set and candidate-absent, so a "commitOid: <sha>" line accidentally added to the human renderer would fail this test).
- file: `src/apps/cli/commands/read.test.ts` (edited) — suite: `src/apps/cli/commands/get/objective.ts` — new method: `gets an objective with commitOid and parentOid on --json (Story 3, 012)` (fake `getObjective.execute` returns `commitOid` and `parentOid`; asserts the parsed JSON has both fields verbatim, plus `received === { id: "obj-1" }` to pin the use-case input shape). This is a regression pin at the commander boundary — the test passes today only because the fake returns the fields directly; once the production use case starts returning them, this same test will pin the wire format end-to-end.

**asserts:** `GetObjectiveOutput` carries two new optional fields, `commitOid?: string` and `parentOid?: string`; when the domain value is set they are emitted verbatim on the JSON line of `get objective --json`; when the domain value is `undefined` the key is **absent** from the JSON (never `null`, never `""`) — a `building` objective genuinely has no candidate yet, and a client must be able to distinguish "key missing" from "key present but empty"; the human (non-`--json`) line list is byte-identical regardless of candidate presence (Story 3 spec line 37-38 + line 60); the existing 10 `get-objective.test.ts` cases (which set neither field) still pass — their expected `deepEqual` shapes contain no `commitOid`/`parentOid` key, so the production code must use a conditional spread (not unconditional emission).

**RED proof.**

- command: `node --test src/app/objective/get-objective.test.ts src/apps/cli/get-objective.test.ts src/apps/cli/commands/read.test.ts`
- exit: non-zero
- failure: verbatim failing lines from the two Story 3 RED tests:
  - `src/app/objective/get-objective.test.ts:(S3-1) execute returns commitOid and parentOid when both are set on the objective`: `AssertionError: commitOid carried into output; actual: undefined, expected: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'`
  - `src/apps/cli/get-objective.test.ts:(S3-3) --json: commitOid and parentOid are emitted verbatim in the JSON line when set`: `AssertionError: commitOid present in JSON; actual: undefined, expected: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'`
- aggregate for the Story 3 surface: `tests 41, pass 39, fail 2` — 2 are Story 3's new RED assertions; the 3 characterization tests (S3-2, S3-4, S3-5) pass now because the current production code emits nothing, and they continue to pass after GREEN because the conditional spread keeps the key absent when the domain value is `undefined`; the 1 `commands/read.test.ts` test passes today because the fake directly returns the field — it's a wire-format pin, not a RED test, and the SE's GREEN does not change its behavior.

**Open to Software Engineer.**

- `src/app/objective/get-objective.ts:16-23` — `GetObjectiveOutput` gains two **optional** fields, immediately after `status: string;`:
  ```ts
    /** The squashed candidate commit a client must echo back on a verdict. */
    commitOid?: string;
    /** The parent the candidate was built on (the broker's CAS anchor). */
    parentOid?: string;
  ```
  The `?` is load-bearing: a `building` objective has neither. A non-optional field would make the existing 10 cases fail with `Property 'commitOid' is missing` because the test sources do not pass the field. The Story 3 spec line 10-17 makes this explicit.
- `src/app/objective/get-objective.ts:59-69` — the returned object gains two **conditional spreads**, placed right after `status,`, mirroring the `workspace` convention at `src/app/initiative/get-initiative.ts:53-55`:
  ```ts
    ...(objective.commitOid !== undefined
      ? { commitOid: objective.commitOid }
      : {}),
    ...(objective.parentOid !== undefined
      ? { parentOid: objective.parentOid }
      : {}),
  ```
  Pinned rule: when the domain value is `undefined` the key is **absent** from the JSON — never `null`, never `""`. The S3-2 / S3-4 tests assert this. Do **not** write `commitOid: objective.commitOid ?? null` (would set the key to `null`) or `commitOid: objective.commitOid ?? ""` (would set the key to `""`).
- `src/apps/cli/objective.ts:61-94` (`runGetObjective`) is **unchanged** at the field-construction level (Story 3 spec line 37-38: "The human (non-`--json`) rendering is **unchanged**"). The `--json` branch already stringifies the use-case output verbatim at `:68-70`, so the new fields flow to the JSON line automatically. The S3-5 regression test pins the human output line list is byte-identical regardless of candidate presence.
- The domain type `Objective` at `src/domain/initiative.ts:37-41` already has the optional `commitOid?: string` and `parentOid?: string` fields — verified with `grep`. No domain change is needed.
- The SQLite layer at `src/storage/sqlite/sqlite-initiative-repository.ts:112` already selects both columns and at `:131-132` maps them only when non-NULL — verified by inspection. No storage change is needed.
- `src/apps/cli/commands/get/objective.ts:61-94` (`buildGetObjective` → `runGetObjective` plumbing) is **unchanged**. The new fields pass through the `--json` `JSON.stringify(output)` line at `:69` with no further wiring.
- No leaf command count change: `src/apps/cli/architecture.test.ts:28-33` (`EXPECTED_LEAF_FILE_COUNT = 65`, `EXPECTED_LEAF_COUNT = 68`) must not change. `composition.test.ts:587-608` (the full-stack `["get","objective","--id",…,"--json"]` test) stays green because the comment at `:600-602` says it queries the DB directly for `commitOid`, NOT through `GetObjective`; the new JSON field is additive and does not affect the status assertion at `:594-598`.

End-of-RED handoff. After the SE's GREEN turn, I'll re-run the same `node --test` command (plus `node --test src/composition.test.ts` for the full-stack regression gate the Story names) and confirm the 2 Story 3 failures flip to green before opening Story 4 (`04-required-expected-commit-on-verdicts.md`).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 012-explicit-activation-guarded-verdicts · Story 3 — `commitOid` on the objective read view

**Cycle.** GREEN for `<Story 3 test files: src/app/objective/get-objective.test.ts, src/apps/cli/get-objective.test.ts, src/apps/cli/commands/read.test.ts>`.

**Files changed.**

- `src/app/objective/get-objective.ts` (edited) — `GetObjectiveOutput` gains optional `commitOid?: string` and `parentOid?: string`; returned object adds two conditional spreads, omitted when the domain value is `undefined`.

**Seam (GREEN).** Two new optional fields on `GetObjectiveOutput`, each conditionally spread into the return object so a `building` objective produces an object whose `commitOid` and `parentOid` keys are **absent** (never `null`, never `""`). The S3-2 / S3-4 absent-key invariants pass; the S3-1 / S3-3 verbatim-emit invariants pass. The CLI `runGetObjective` (`:68-70`) stringifies the use-case output verbatim, so the new fields flow to the JSON line without further wiring; the human line list (`:71-90`) is untouched (S3-5 byte-identical regression passes).

**Refactor.** Deferred: Story 3 has no `## Action — REFACTOR:` block; the named scope is the two-field addition.

**Build check.**

- typecheck: exit 0
- `node --test src/app/objective/get-objective.test.ts src/apps/cli/get-objective.test.ts src/apps/cli/commands/read.test.ts` → 41/41 pass, 0 fail (S3-1..S3-5 all green).
- `node --test src/composition.test.ts src/apps/cli/architecture.test.ts` → 22/22 pass (composition full-stack `["get","objective","--id",…,"--json"]` test stays green; `EXPECTED_LEAF_FILE_COUNT = 65` / `EXPECTED_LEAF_COUNT = 68` unchanged — no new leaf).
- `npm test` → 1818/1818 pass, 0 fail.
- `npm run verify:handoff` → `VERIFY: PASS`.

**Assumptions.**

- VERIFIED: `Objective` already has optional `commitOid?: string` and `parentOid?: string` (`src/domain/initiative.ts:36-39`) and the SQLite mapper already selects both columns (`src/storage/sqlite/sqlite-initiative-repository.ts:112`) and maps them only when non-NULL (`:131-132`) — confirmed by reading the file. No domain or storage change is needed for Story 3.
- VERIFIED: `runGetObjective` at `src/apps/cli/objective.ts:68-70` `JSON.stringify(output)`s the use-case output verbatim, so the new fields flow to the JSON line without a CLI change. The S3-5 test in `src/apps/cli/get-objective.test.ts:361-387` pins the human line list is byte-identical between candidate-set and candidate-absent; the current human renderer (`:71-90`) never reads `commitOid`/`parentOid`, so this passes unchanged.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — 012-explicit-activation-guarded-verdicts · Story 4 — required `--expected-commit` on verdicts (RED)

**Cycle.** RED for Story 4 (`04-required-expected-commit-on-verdicts.md`). Story 4 is coupled with Story 5 (callers) per `index.md` line 17-21 — the required flag breaks every caller, so both land in the same commit. Story 4 owns the `src/` test additions; Story 5 owns the script caller updates (no test changes — `bash -n` + the four `*-proof.sh` runs are the verify).

**Test written (Story 4, RED).**

- file: `src/domain/initiative.test.ts` (edited) — suite: `initiative.test.ts` — new imports: `assertCandidateFresh`, `StaleCandidateError` from `./initiative.ts`; new methods: `(S4-D1) assertCandidateFresh('o','abc','abc') returns without throwing`, `(S4-D2) assertCandidateFresh('o','abc','def') throws StaleCandidateError with expected='abc', actual='def', and message matching /stale|expected|moved/i`, `(S4-D3) assertCandidateFresh('o','abc',undefined) throws StaleCandidateError with actual === ''`
- file: `src/app/objective/approve-objective.test.ts` (edited) — suite: `approve-objective.test.ts` — new import `StaleCandidateError`; **10 existing test bodies updated to pass the fixture's own `commitOid` as `expectedCommit`** at the Story's named call sites (lines 165, 187, 206, 239, 277, 306, 336, 362, 393, 437 — content, not Story-numbered lines: the 10 `useCase.execute({objectiveId: …})` calls). The 10 update to `execute({objectiveId: …, expectedCommit: "COMMIT_OID"})` (or `"SAME_OID"` for the empty-objective tests). New methods: `(S4-A1) execute stale approve (a): FailIfCalledBroker is never reached; rejects with StaleCandidateError; no save; no event`, `(S4-A2) execute stale approve on the empty-objective shortcut (d): commitOid === parentOid; stale expectedCommit is still refused before the shortcut integrates`, `(S4-A3) execute stale approve (b): in-transaction interleaving — early guard sees 'AAA', the uow re-check sees 'BBB'; rejects with StaleCandidateError; no save; no event`, `(S4-A4) execute matching approve (c): interleaving reads return 'AAA' on every call; integrates and appends objective.integrated`
- file: `src/app/objective/reject-objective.test.ts` (edited) — suite: `reject-objective.test.ts` — new import `StaleCandidateError`; **4 existing test sites updated** at lines 152, 210, 254, 289: the objective literal gains `commitOid: "REVIEWED_OID"` and the call sites gain `expectedCommit: "REVIEWED_OID"`. New methods: `(S4-R1) RejectObjective: stale expectedCommit rejects with StaleCandidateError; no objective.discarded; no task.discarded; no save`, `(S4-R2) RejectObjective: in-transaction interleaving — early guard sees 'AAA', uow re-check sees 'BBB'; rejected with StaleCandidateError; nothing saved`
- file: `src/app/objective/retry-objective.test.ts` (edited) — suite: `retry-objective.test.ts` — new import `StaleCandidateError`; new methods: `(S4-Y1) execute stale retry (a): conflict objective, broker never reached; rejects with StaleCandidateError; nothing saved` (broker.currentTip/squashObjective/gate.verify all throw if called), `(S4-Y2) execute stale retry (b): awaiting_confirmation objective (silent no-op path) refuses a stale guard; nothing saved` (this is the path Story 4 spec line 113-114 names — the tip-integrated no-op at `retry-objective.ts:129-130` is unreachable with a stale id), `(S4-Y3) execute matching retry on conflict with interleaved store: store returns 'AAA' on the early guard then 'BBB' inside the uow — refused with StaleCandidateError; nothing saved`
- file: `src/apps/cli/objective.test.ts` (edited) — suite: `objective.test.ts` — `FakeApproveObjective.execute` / `FakeRetryObjective.execute` / `FakeRejectObjective.execute` input shape gains required `expectedCommit: string`; the existing 13 tests (5 approve + 4 retry + 4 reject) all updated to pass `expectedCommit: "COMMIT_OID"` (the ones that don't already exit on the missing-`--id` check keep passing under the current code because the handler still doesn't validate the new flag — they'll go red only after the SE wires the `MissingFlagError` check). New methods: `(S4-CLI-1) runApproveObjective missing --expected-commit: returns exitCode 1 with 'error: missing required flag --expected-commit', no use-case call`, `(S4-CLI-2) runApproveObjective empty --expected-commit: returns exitCode 1 with 'error: missing required flag --expected-commit', no use-case call`, `(S4-CLI-3) runRetryObjective missing --expected-commit: returns exitCode 1 with 'error: missing required flag --expected-commit', no use-case call`, `(S4-CLI-4) runRejectObjective --resolution discard without --expected-commit: returns exitCode 1 with 'error: missing required flag --expected-commit', no use-case call`, `(S4-CLI-5) runRejectObjective --resolution retry without --expected-commit: returns exitCode 1 with 'error: missing required flag --expected-commit', no use-case call`. Note: `runApproveObjective`/`runRetryObjective`/`runRejectObjective` accept `args: Record<string, unknown>`, so the new flag-missing tests assert the runtime check (not a type error) — `expectedCommit` is undefined or empty → `MissingFlagError`
- file: `src/apps/cli/commands/mutation.test.ts` (edited) — suite: `mutation.test.ts` — **2 existing tests updated** to pass `--expected-commit abc`: `approves an objective from its required ID and emits its result` (now expects `{objectiveId:"obj-1", expectedCommit:"abc"}`) and `retries an objective from its required ID and emits its result` (now expects `{objectiveId:"obj-1", expectedCommit:"abc"}`). New methods: `(S4-MUT-1) approves an objective without --expected-commit: non-zero exit (commander requiredOption), no use-case call`, `(S4-MUT-2) retries an objective without --expected-commit: non-zero exit (commander requiredOption), no use-case call`, `(S4-MUT-3) rejects an objective with --expected-commit, --resolution, and optional --reason` (verifies RejectObjective receives `{objectiveId, expectedCommit, reason}`), `(S4-MUT-4) rejects an objective without --expected-commit: non-zero exit (commander requiredOption), no use-case call`
- file: `src/apps/cli/error-map.test.ts` (edited) — suite: `error-map.test.ts` — new import `StaleCandidateError`; new method: `(S4-EM-1) StaleCandidateError maps to exit 1 with single error line matching /stale|expected|moved/i` (asserts `exitCode === 1`, `stderr.length === 1`, the line starts with `error:`, and matches `/stale|expected|moved/i` so the Proof's `grep -qiE 'stale|expected|moved'` at `activation-verdict-proof.sh:97` will land)

**asserts (the user-observable contract):**

- `StaleCandidateError` is exported from `src/domain/initiative.ts` and re-exported via `src/app/errors.ts`; `assertCandidateFresh(objectiveId, expectedCommit, actual: string | undefined)` returns `void` on a match and throws `StaleCandidateError` on a mismatch or `undefined` actual.
- The three use cases accept `{ objectiveId, expectedCommit: string }` (required) and refuse a stale guard with `StaleCandidateError` **before any `ObjectiveBroker` / `workspaces.squashObjective` / `gate.verify` call**; the in-transaction re-check inside `uow.transaction(() => { ... })` compares the freshly-read `commitOid` against `expectedCommit` and throws on a mismatch, rolling the transaction back.
- The CLI surfaces declare `--expected-commit <oid>` as a commander `requiredOption` on `approve objective` / `reject objective` / `retry objective`; the `runApproveObjective` / `runRetryObjective` / `runRejectObjective` handlers check for the missing flag (after their existing `--id` / `--resolution` checks for `runRejectObjective`) and return `MissingFlagError('--expected-commit')` without dispatching to the use case; `toResult` in `src/apps/cli/error-map.ts` includes `StaleCandidateError` in the allow-list so the error renders as `error: objective … candidate moved: expected …, found …` + exit 1.
- Guard-check order is fixed: not-found → status guard → stale guard. Approving a `discarded` or `integrated` objective still raises `ObjectiveNotAwaitingConfirmationError` (not `StaleCandidateError`); S4-EM-1's match against `/stale|expected|moved/i` and the order pin via the in-transaction tests together prove the Proof phase D's "refusal happens before any git mutation" invariant.

**RED proof.**

- command: `node --test src/domain/initiative.test.ts src/app/objective/approve-objective.test.ts src/app/objective/reject-objective.test.ts src/app/objective/retry-objective.test.ts src/apps/cli/objective.test.ts src/apps/cli/commands/mutation.test.ts src/apps/cli/error-map.test.ts`
- exit: non-zero (1)
- verbatim failing lines from the RED surface:
  - `src/domain/initiative.test.ts` (whole-file fail): `SyntaxError: The requested module './initiative.ts' does not provide an export named 'assertCandidateFresh'` (also `'StaleCandidateError'`) — the new domain seam is missing; the 3 S4-D tests are the next step in the run.
  - `src/app/objective/approve-objective.test.ts` (whole-file fail): `SyntaxError: The requested module '../../domain/initiative.ts' does not provide an export named 'StaleCandidateError'` — the 4 S4-A tests + 10 updated existing tests are the next step.
  - `src/app/objective/reject-objective.test.ts` (whole-file fail): same `'StaleCandidateError'` import error — the 2 S4-R tests + 4 updated existing tests are the next step.
  - `src/app/objective/retry-objective.test.ts` (whole-file fail): same `'StaleCandidateError'` import error — the 3 S4-Y tests are the next step.
  - `src/apps/cli/error-map.test.ts` (whole-file fail): same `'StaleCandidateError'` import error — the S4-EM-1 test is the next step.
  - `src/apps/cli/commands/mutation.test.ts` (whole-file fail): the FIRST new test in the file (`approves an objective … --expected-commit abc`) throws `error: unknown option '--expected-commit'\n\nUsage: kanthord approve objective [options]\n…` from the commander parser because the option is not declared in `src/apps/cli/commands/approve/objective.ts:15` (nor the reject/retry siblings). The 4 S4-MUT tests + 2 updated existing tests are the next step.
  - `src/apps/cli/objective.test.ts` (loads — the handler functions accept `Record<string, unknown>` so the new flag is not a type error; the 5 S4-CLI tests fail at runtime): aggregate `ℹ tests 24 · ℹ pass 13 · ℹ fail 11`. S4-CLI-1 actual `exitCode === 0, stderr []` (handler does not check the flag, dispatches and resolves); S4-CLI-2 same; S4-CLI-3 same; S4-CLI-4 same; S4-CLI-5 same.
- aggregate for the Story 4 surface: `ℹ tests 30 · ℹ pass 13 · ℹ fail 17` for the seven files combined, plus **6 file-level failures** (`approve-objective.test.ts`, `reject-objective.test.ts`, `retry-objective.test.ts`, `domain/initiative.test.ts`, `error-map.test.ts`, `commands/mutation.test.ts`) that prevent individual test discovery because the seam (`StaleCandidateError` / `assertCandidateFresh`) or the commander option is missing.
- typecheck: `tsc --noEmit` reports **31 `error TS…`** across 7 files: 2× `TS2305` for the `StaleCandidateError` import in `domain/initiative.test.ts`; 2× `TS2305` for `StaleCandidateError` in `error-map.test.ts`; 1× `TS2305` in `retry-objective.test.ts`; multiple `TS2353 Object literal may only specify known properties, and 'expectedCommit' does not exist in type …` for the use-case input types and the `assertCandidateFresh` export — every error names a seam the Story 4 file's `## Change` section specifies.

**Open to Software Engineer.**

- `src/domain/initiative.ts` — export `StaleCandidateError` (Error subclass with `objectiveId`, `expected`, `actual` fields, message `objective <id> candidate moved: expected <expected>, found <actual>`, `name === "StaleCandidateError"`) and `assertCandidateFresh(objectiveId, expectedCommit, actual: string | undefined): void` beside the existing `IllegalObjectiveTransitionError` and `canRetryObjective` (Story 4 spec line 16-46). The guard is the single comparison implementation — no inline `!==` in any use case.
- `src/app/errors.ts:1-26` — add `export { StaleCandidateError } from "../domain/initiative.ts";` (mirror the `CycleError` re-export at `:4`).
- `src/apps/cli/error-map.ts:1-16` — import `StaleCandidateError` from `../../app/errors.ts` and add `err instanceof StaleCandidateError ||` to the allow-list immediately after the `ObjectiveNotAwaitingConfirmationError` line (`:81`).
- `src/app/objective/approve-objective.ts:45-47` — input becomes `{ objectiveId: string; expectedCommit: string }` (required). Insert the early guard `assertCandidateFresh(objectiveId, input.expectedCommit, objective.commitOid);` after the status guard (`:55-60`) and before `getInitiative` (`:62`) — i.e. before `broker.fetch` (`:79`), before `broker.countCommitsSince` (`:80-84`), before `broker.casUpdateRef` (`:91-97`). The early guard fires before the empty-objective shortcut at `:74-77`. `#integrate` (`:110-133`) takes `expectedCommit: string` as a new parameter; the first two statements inside `this.#uow.transaction(() => {` (`:116`) become `const fresh = this.#store.getObjective(objectiveId); assertCandidateFresh(objectiveId, expectedCommit, fresh?.commitOid);`. Both `#integrate` call sites (`:75` and `:106`) pass the new parameter through. `#recordConflict` is unchanged.
- `src/app/objective/reject-objective.ts:43-46` — input becomes `{ objectiveId: string; reason?: string; expectedCommit: string }` (required). Insert the early guard `assertCandidateFresh(objectiveId, input.expectedCommit, objective.commitOid);` after the `DISCARD_ALLOWED_FROM` check (`:54-57`). The first two statements inside `this.#uow.transaction(() => {` (`:59`) become the in-transaction re-check (same shape as approve). The failure-branch transaction is unchanged.
- `src/app/objective/retry-objective.ts:82-83` — `execute` input gains required `expectedCommit: string`. Insert the early guard `assertCandidateFresh(objectiveId, input.expectedCommit, objective.commitOid);` after the `canRetryObjective` check (`:102-107`) and before the conflict branch (`:109`) — the tip-integrated no-op at `:129-130` is therefore unreachable with a stale id. The first two statements inside the success `uow.transaction(() => {` in `#resolveConflict` (`:157`) become the in-transaction re-check (compare against the **stored** `commitOid`, still the pre-squash candidate at that point; the new oid is only written inside the callback). The failure-branch transaction (`:179-182`) is unchanged.
- `src/apps/cli/commands/approve/objective.ts:15` — add `.requiredOption("--expected-commit <oid>", "the candidate commit OID read from \`get objective --json\`")`after the existing`--id`; the action `opts`type gains`expectedCommit: string`; the args object passed to `runApproveObjective`gains`expectedCommit: opts.expectedCommit`; extend the `addHelpText("after", …)` Example to include the flag.
- `src/apps/cli/commands/reject/objective.ts:12-17` — the same `requiredOption`, opts field, args field, and Example update.
- `src/apps/cli/commands/retry/objective.ts:12-13` — the same `requiredOption`, opts field, args field, and Example update.
- `src/apps/cli/objective.ts:97` (`runApproveObjective`) — after the existing `--id` `MissingFlagError` check (`:101-104`), add: `const expectedCommit = args["expectedCommit"]; if (typeof expectedCommit !== "string" || expectedCommit === "") { return { ...toResult(new MissingFlagError("--expected-commit")), stdout: [] }; }`. Then call `execute({ objectiveId: id, expectedCommit })`. Success stdout/stderr and the `exitCode: 0` conflict wording (`:110-119`) are unchanged.
- `src/apps/cli/objective.ts:126` (`runRetryObjective`) — the same `--expected-commit` check, then `execute({ objectiveId: id, expectedCommit, ...note })` (note passthrough is the Story 06 a behavior; the new test `runRetryObjective --id … --expected-commit … --note …` pins all three).
- `src/apps/cli/objective.ts:147` (`runRejectObjective`) — the same `--expected-commit` check, placed **after** the existing `--resolution` missing check (`:158-163`) and the `--resolution` invalid check (`:164-172`), so the existing tests at `:429, :443` stay green. Then pass `expectedCommit` to both branches: `retryObjective.execute({ objectiveId: id, expectedCommit })` and `rejectObjective.execute({ objectiveId: id, reason, expectedCommit })`.
- Story 5 — the SE also lands the script caller updates in the same commit (index.md line 17-21 names them coupled): `scripts/e2e/landing-proof.sh:71`, `scripts/e2e/publish-idempotency-proof.sh:117`, `scripts/e2e/sequencing-proof.sh:154/229/235`, `scripts/e2e/discard-proof.sh:96-102` (help assertion + terminal-objective placeholder), `scripts/e2e/drive-run.sh:60/160-169` (snapshot column + interleaved loop). Do **not** modify `scripts/e2e/activation-verdict-proof.sh` (Story 4 spec line 50-52 marks it as the Proof and already correct).
- `src/apps/cli/architecture.test.ts:28-33` (`EXPECTED_LEAF_FILE_COUNT = 65`, `EXPECTED_LEAF_COUNT = 68`) must not change — no new leaves; `--expected-commit` is added to the three existing objective leaves.
- No new dep on `src/composition.ts`; no change to `ApproveObjective`'s `{outcome}` return contract; `InitiativeStatus` and `ObjectiveStatus` sets are unchanged.

End-of-RED handoff. After the SE's GREEN turn (Story 4 + Story 5, same commit), I'll re-run the same `node --test` command plus `node --test src/apps/cli/architecture.test.ts` plus `npm run verify:handoff` and confirm the 17 surface failures (and the 6 file-level failures) flip to green, then run the full Verification Gate (Story 2's full-stack `composition.test.ts` and Story 4's `npm run verify` gate) plus the `scripts/e2e/activation-verdict-proof.sh` Proof.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 012-explicit-activation-guarded-verdicts · Story 4 — required `--expected-commit` on verdicts, blocked on test fallout

**Cycle.** GREEN attempt for Story 4 (`04-required-expected-commit-on-verdicts.md`) plus the coupled Story 5 caller updates in the same commit. **Blocked — see OPEN:.**

**Files changed (production).**

- `src/domain/initiative.ts` (edited) — added `StaleCandidateError` (Error subclass with `objectiveId` / `expected` / `actual` fields, `name === "StaleCandidateError"`, message matches `/stale|expected|moved/i`) beside `IllegalObjectiveTransitionError`, and `assertCandidateFresh(objectiveId, expectedCommit, actual: string | undefined): void` beside `canRetryObjective`. The guard is the single comparison implementation; three use cases share it (AGENTS.md forbids use-case-calls-use-case).
- `src/app/errors.ts` (edited) — re-exported `StaleCandidateError` from `../domain/initiative.ts` (mirrors the `CycleError` re-export at `:4`).
- `src/apps/cli/error-map.ts` (edited) — imported `StaleCandidateError` from `../../app/errors.ts` and added `err instanceof StaleCandidateError ||` to the `toResult` allow-list immediately after the `ObjectiveNotAwaitingConfirmationError` line. Unlisted errors re-throw (`:122`), so this line is what turns the refusal into exit 1 + `error: …`.
- `src/app/objective/approve-objective.ts` (edited) — input gains required `expectedCommit: string`; early guard `assertCandidateFresh(objectiveId, input.expectedCommit, objective.commitOid)` inserted after the status guard (`:55-60`) and before `getInitiative` (`:62`) — before `broker.fetch` (`:79`), before `broker.countCommitsSince` (`:80-84`), before `broker.casUpdateRef` (`:91-97`); the empty-objective shortcut at `:74-77` is reached only AFTER the early guard. `#integrate` (`:110-133`) takes `expectedCommit: string` as a new parameter; the first two statements inside `this.#uow.transaction(() => {` are now `const fresh = this.#store.getObjective(objectiveId); assertCandidateFresh(objectiveId, expectedCommit, fresh?.commitOid);` — throwing rolls the transaction back (`src/storage/sqlite/sqlite-unit-of-work.ts:26`). Both `#integrate` call sites (`:75` and `:106`) pass the new parameter through. `#recordConflict` is unchanged.
- `src/app/objective/reject-objective.ts` (edited) — input gains required `expectedCommit: string` (alongside `reason?`); early guard inserted after the `DISCARD_ALLOWED_FROM` check (`:54-57`); the first two statements inside the transaction are the in-transaction re-check (same shape as approve). The failure-branch transaction is unchanged.
- `src/app/objective/retry-objective.ts` (edited) — input gains required `expectedCommit: string` (alongside `note?`); early guard inserted after the `canRetryObjective` check (`:102-107`) and before the conflict branch (`:109`) — so the tip-integrated silent no-op at `:129-130` is also unreachable with a stale id (Story 4 spec line 113-114). `#resolveConflict` (`:133-184`) takes `expectedCommit: string` as a new parameter; the first two statements inside the success `uow.transaction(() => {` are the in-transaction re-check. The failure-branch transaction is unchanged.
- `src/apps/cli/commands/approve/objective.ts` (edited) — added `.requiredOption("--expected-commit <oid>", "the candidate commit OID read from \`get objective --json\`")`after`--id`; the action `opts`type gains`expectedCommit: string`; the args object passed to `runApproveObjective`gains`expectedCommit: opts.expectedCommit`; `addHelpText("after", …)` Example updated to include the flag.
- `src/apps/cli/commands/reject/objective.ts` (edited) — the same `requiredOption`, opts field, args field, and Example update.
- `src/apps/cli/commands/retry/objective.ts` (edited) — the same `requiredOption`, opts field, args field, and Example update.
- `src/apps/cli/objective.ts` (edited) — `runApproveObjective` (`:97-123`): after the existing `--id` `MissingFlagError` check, added the same `MissingFlagError('--expected-commit')` runtime guard; calls `execute({ objectiveId: id, expectedCommit })`. `runRetryObjective` (`:125-145`): the same `--expected-commit` check, then `execute({ objectiveId: id, expectedCommit, ...note })`. `runRejectObjective` (`:147-186`): the same `--expected-commit` check, placed AFTER the `--resolution` missing check (`:158-163`) and the `--resolution` invalid check (`:164-172`) so the existing missing/invalid resolution messages and their tests are unaffected; passes `expectedCommit` to both `retryObjective.execute({...})` and `rejectObjective.execute({...})` branches. All success paths are unchanged: exit 0 + the existing stdout/stderr.

**Files changed (Story 5 — coupled caller updates, same commit).**

- `scripts/e2e/landing-proof.sh` (edited) — added `jv` + `obj_oid` beside the existing inline `node -e` helpers (lines 47-49); line 71 becomes `OBJ_OID=$(obj_oid "$OBJ"); test -n "$OBJ_OID"; node src/main.ts approve objective --id "$OBJ" --expected-commit "$OBJ_OID" >/dev/null`.
- `scripts/e2e/publish-idempotency-proof.sh` (edited) — added `jv` + `obj_oid`; line 117 becomes `OBJ_OID=$(obj_oid "$OBJ"); test -n "$OBJ_OID"; node src/main.ts approve objective --id "$OBJ" --expected-commit "$OBJ_OID" >/dev/null`.
- `scripts/e2e/sequencing-proof.sh` (edited) — added `jv` + `obj_oid` beside `read_manifest` (`:105`) and `status_of` (`:110`); the three `approve objective` call sites at lines 154 (AOBJ), 229 (O1), 235 (O1B) each read the oid via `obj_oid` immediately before the approve (an earlier land can re-squash a later objective, so a value captured once is not reusable).
- `scripts/e2e/discard-proof.sh` (edited) — added `jv` + `obj_oid` beside `read_manifest` (`:63`); the help assertion at line 96 is extended to cover `--expected-commit`; lines 98-102 (the terminal-objective claim) now pass `--expected-commit 0000…0` (a placeholder) so the terminal-objective error is the one being tested rather than a missing-flag error (per Story 4's pinned guard order: status guard before stale guard).
- `scripts/e2e/drive-run.sh` (edited) — snapshot query at `:60` gains the `commitOid` column on `objectives`; the approve loop at `:160-169` reads `id + oid` as a TSV pair, records a finding when the oid is missing, and never calls approve with an empty guard.
- `scripts/e2e/activation-verdict-proof.sh` — **untouched** (Story 4 spec line 50-52 marks it as the Proof; already correct).
- `docs/git-workflow.md` — untouched (prose/mermaid only, no copy-pasteable command lines).
- `bash -n` exits 0 for `landing-proof.sh`, `publish-idempotency-proof.sh`, `sequencing-proof.sh`, `discard-proof.sh`, `drive-run.sh`.

**Seam (GREEN).** The new `StaleCandidateError` is exported from `src/domain/initiative.ts` and re-exported through `src/app/errors.ts`; `assertCandidateFresh` is the single comparison implementation, called from all three use cases (and never inlined). The CLI surfaces declare `--expected-commit <oid>` as a commander `requiredOption` on `approve objective` / `reject objective` / `retry objective`; the `runApproveObjective` / `runRetryObjective` / `runRejectObjective` handlers check for the missing flag and return `MissingFlagError('--expected-commit')` without dispatching to the use case. `toResult` includes `StaleCandidateError` in the allow-list so the error renders as `error: objective … candidate moved: expected …, found …` + exit 1. Guard-check order is fixed: not-found → status guard → stale guard. The early guard precedes every `ObjectiveBroker` call and every `workspaces.squashObjective` / `gate.verify` call.

**Refactor.** Deferred: Story 4 has no `## Action — REFACTOR:` block; the named scope is the guard addition + caller updates.

**Build check.**

- `npm run typecheck` reports **8 `TS2345` errors, all in `src/app/objective/retry-objective.test.ts`**. No errors in any production file. The errors are at the 8 EXISTING test call sites (lines 146, 176, 207, 237, 284, 345, 421, 487) that the TE's Story 4 RED did not backfill with the new required `expectedCommit` field.
- All other Story 4 RED typecheck errors (29 of 31 in the TE's count) are now clean: the `StaleCandidateError` / `assertCandidateFresh` exports resolve; the `expectedCommit: string` field is accepted on the three use-case input types; the `--expected-commit` option is declared on the three CLI commands; the `MissingFlagError('--expected-commit')` runtime check is in place; the `toResult` allow-list renders the error as a single `error: …` line.
- The 8 remaining errors are the same class of bug Story 1 (26 fallout files) and Story 2 (36 fallout sites in `import-graph.test.ts`) already hit: the SE cannot add `expectedCommit: <matching-oid>` to the test file because test files are lane-forbidden.
- For the 8 call sites, the matching fixture-`commitOid` is the obvious value to pass:
  - line 146 (not-found): any string — the not-found error fires first
  - line 176 (`OBJ_A`, no `commitOid`): any string — the non-tip check fires first
  - line 207 (`OBJ`, status `building`, no `commitOid`): any string — `canRetryObjective('building')` is false
  - lines 237, 284, 345, 487 (`OBJ`, `commitOid: "STALE_OID"`): `"STALE_OID"`
  - line 421 (`OBJ`, `commitOid: "STALE_OID"`, `note: "guidance"`): `"STALE_OID"`
- Per-file fallout list (1 file, 8 sites): `src/app/objective/retry-objective.test.ts:146, 176, 207, 237, 284, 345, 421, 487`.

**OPEN: TE's Story 4 RED turn is missing the test-side backfill of the 8 EXISTING `RetryObjective.execute({...})` call sites in `src/app/objective/retry-objective.test.ts` — build is broken in 1 file (8 errors).**

The Story 4 spec makes the new field required at the type level (`{ objectiveId: string; expectedCommit: string }`, "**required**, not `string | undefined`" — spec line 65-66). The TE's RED backfill was complete for `approve-objective.test.ts` (10 sites) and `reject-objective.test.ts` (4 sites) — both compile now. The TE added 3 new tests to `retry-objective.test.ts` (S4-Y1/Y2/Y3) and a new import line, but did NOT update the 8 EXISTING test bodies in that same file. This is the same class of fallout Story 1 and Story 2 already had (and the TE fixed on the next cycle). The SE cannot fix it: every `expectedCommit: <oid>` insertion site is in a test file, and editing test files is the TE's lane. The fix is mechanical — add the fixture's own `commitOid` to each call (the Story 4 spec line 195-196 for approve already names this pattern: "the 10 existing constructions … updated to pass the fixture's own `commitOid` as `expectedCommit`"; the same pattern applies to the 8 retry sites).

**Recommended TE action:** backfill `expectedCommit: <matching-oid>` (or `expectedCommit: "any"` for the 3 sites where the not-found / non-tip / non-retryable-status guard fires before the stale guard) into the 8 `useCase.execute({...})` literals at `src/app/objective/retry-objective.test.ts:146, 176, 207, 237, 284, 345, 421, 487`. Drop the cast or keep the explicit `expectedCommit: string` field per the required type. The Story 1 file at `01-paused-in-initiative-creation.md:110-119` and the Story 2 OPEN-#1 from the SE's prior turn document the same class of bug for reference.

**Production + e2e-script changes above are in place.** Once the TE's test-side backfill lands, the typecheck will pass and the Story 4 surface (17 RED test failures + 6 file-level failures, per the TE's RED report) will be re-runnable. The Story 5 caller updates are in the same commit because index.md line 17-21 names the two stories coupled.

**Build check.**

- typecheck: exit non-zero (8 `TS2345` errors, all in `src/app/objective/retry-objective.test.ts` — test fallout, SE cannot fix)
- `bash -n` for the 5 Story 5 e2e scripts: exit 0
- `node --test` not run by SE per the role boundary (test execution is the TE's gate).

ATTEMPT-FAILED: 012-s4 — build broken by incomplete test-side update; TE must backfill `expectedCommit: <oid>` across 8 unlisted sites in `src/app/objective/retry-objective.test.ts` (lines 146, 176, 207, 237, 284, 345, 421, 487)

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — implementation ready for review

**Cycle.** Story 4 GREEN-confirm (the lane-forbidden-for-SE backfill the prior SE turn raised) → all Stories green → Verification Gate end-to-end green → IMPLEMENTATION_READY_FOR_REVIEW.

**Story 4 backfill (8 sites in `src/app/objective/retry-objective.test.ts`).**

The SE's last turn raised an OPEN with `ATTEMPT-FAILED: 012-s4` — 8 EXISTING `RetryObjective.execute({...})` call sites in the test file were missing the new required `expectedCommit` field (production was correct; test fallout only). Fixed per the SE's named lines and values:

- 5 sites (lines 207, 237, 284, 345, 487) — `useCase.execute({ objectiveId: OBJ.id })` → `useCase.execute({ objectiveId: OBJ.id, expectedCommit: "STALE_OID" })` via `replaceAll` (the fixture's own `commitOid: "STALE_OID"` is the matching guard; line 207's `building`-status guard fires before the candidate-fresh guard, so it works there too).
- Line 146 (not-found test) → `expectedCommit: "MATCH"` (`UnknownReferenceError` fires before the guard).
- Line 176 (non-tip integrated test) → `expectedCommit: "MATCH"` (`ObjectiveNotRetryableError` fires before the guard).
- Line 421 (note path) → `expectedCommit: "STALE_OID",` added before the existing `note: "guidance"`.

Typecheck: exit 0. No production changes; test files only (TE lane).

**EPIC verification gate.**

- `typecheck` (`npm run typecheck`) → exit 0
- `unit` (`npm test`) → exit 0, 1840 tests / 0 fail
- `verify:handoff` (`npm run verify:handoff`) → `VERIFY: PASS`
- `lint` (`npm run lint`) → exit 0
- `db status` (`node src/main.ts db status`) → exits cleanly (`db: .data/kanthord.db / schema: 0 / journal_mode: wal`)

**Proof.** `scripts/e2e/activation-verdict-proof.sh` → exit 0, prints the exact success string the EPIC names:

```
project created: 01KYJ9928VKBEH3Z01EVMQ7W1R
warning: You appear to have cloned an empty repository.
repository created: 01KYJ9934DC6AY7TVW906K4JHN
ai-provider registered: 01KYJ993VCKREH25RCPDX1V0AV
initiative created: paused-one
A ok: paused is reported separately from lifecycle status
B ok: a paused import is inert — no status change, no execution event, no workspace
initiative resumed: 01KYJ998ARZ414ZP5VM9E72RWS
C ok: the explicit start gate is what begins execution
objective integrated: 01KYJ998ARZ414ZP5VM9E72RWT
D ok: stale + missing verdict guards refused with no state change; matching verdict integrates
012 ok: inert paused import, explicit start gate, guarded objective verdicts
```

**Tasks closed.** 5/5 across 5 Stories (Story 1 `paused` in creation INSERT · Story 2 `--paused` CLI flag + `get initiative --json` field · Story 3 `commitOid`/`parentOid` on `get objective --json` · Story 4 required `--expected-commit` on approve / reject / retry with inside-transaction re-check · Story 5 e2e script caller updates — the same-commit coupling per `index.md` line 17-21).

**Handoff re-verification (SE's last turn claims).** The SE's last turn was blocked with an OPEN: it cited `npm run typecheck` exit non-zero (8 errors, all test-side fallout) and `bash -n` for 5 e2e scripts exit 0. After the backfill: `npm run typecheck` exit 0 (the 8 `TS2345` errors clear), `bash -n` still exit 0. Independently re-verified via `npm run verify:handoff` → `VERIFY: PASS` (machine-readable, exit 0).

```
IMPLEMENTATION_READY_FOR_REVIEW:
- gates: PASS
- proof: PASS (scripts/e2e/activation-verdict-proof.sh) — "012 ok: inert paused import, explicit start gate, guarded objective verdicts"
- stories: 5/5 complete
- date: 2026-07-28
- state: local-uncommitted
```

END: TEST-ENGINEER

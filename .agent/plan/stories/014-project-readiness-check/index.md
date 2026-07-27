# EPIC 014 — Project readiness diagnosis (`check project`) — stories

Epic: `.agent/plan/epics/014-project-readiness-check.md`
Prereq: EPIC 013 (sequence order).

`kanthord check project --id <id> [--json] [--probe-repositories] [--probe-provider]`
reports three separate verdicts — `configured`, `verified`, `operational` — plus
`ready` (all three), a `checks[]` array over a closed status vocabulary in which a
merely-recorded prerequisite reads `unverified` and never `ok`, and a structured
`next` action that carries a runnable command only when every value is known.

## Dispatch order

`01 → 02 → 03 → 04 → 05 → 06`

- **01 before 02**: Story 2 adds the `next` field to the report type and the
  module Story 1 creates. Story 1 ships `next: null` unconditionally.
- **03, 04, 05 before 06**: each ships a self-contained, hermetically tested
  capability (heartbeat table + writer, repository probe port + git adapter,
  provider probe) with no CLI surface. **Story 6 is the only story that wires
  anything into `composition.ts` or the CLI**, so the Proof script is red until
  06 lands. This is deliberate: 06 is the integration story.
- Story 6 bumps both leaf-count constants in `src/apps/cli/architecture.test.ts`
  (65 → 66 and 68 → 69). No other story touches that file.

## Stories

- 1 — `ProjectReadiness`: the pure, zero-I/O report over injected facts → `01-project-readiness-pure-report.md`
- 2 — structured `next` (`{check, action, requiresInput[], command?}`) → `02-structured-next-action.md`
- 3 — `daemon_heartbeats` table, interval writer, staleness read → `03-daemon-heartbeat.md`
- 4 — repository access probe (`git ls-remote`) behind a port → `04-repository-access-probe.md`
- 5 — provider probe (opt-in, billable) reusing `TestAiProvider` → `05-provider-probe.md`
- 6 — `CheckProject` fact collector + `check project` CLI leaf + wiring → `06-check-project-cli-leaf.md`

## Proof line ownership

Proof script: `scripts/e2e/project-readiness-proof.sh` (**do not modify**).

| Phase                                                                    | Exercises code from |
| ------------------------------------------------------------------------ | ------------------- |
| `A ok` (unknown id is a clear error)                                     | 6                   |
| `B ok` (missing prerequisites, `verified=null`, structured next)         | 1, 2, 6             |
| `C ok` (recorded reads `unverified`; unassigned provider is `missing`)   | 1, 6                |
| `D ok` (dangling credential → `blocked`, in a throwaway project)         | 1, 6                |
| `E ok` (empty vs paused vs runnable; configured ≠ ready)                 | 1, 2, 6             |
| `F ok` (no git spawned by default)                                       | 4, 6                |
| `G ok` (`--probe-repositories` verifies remote + branch, clones nothing) | 4, 6                |
| `H ok` (heartbeat live → stale)                                          | 3, 6                |
| `014 ok:`                                                                | all six             |

## Facts (needed for implementation)

**Greenfield gaps — things the epic assumes exist but do not:**

- **No `Clock` port exists anywhere in `src`.** `grep -rn "Clock" src` finds only
  `src/agent-runner/pi.ts:332` (`clock?: () => number`). `RunDaemon`'s only time
  seam is the injected `sleep` (`src/app/task/run-daemon.ts:70`). Every heartbeat
  clock read is therefore an injected `now: () => number` function, defaulted to
  `Date.now` at the composition root only.
- **No heartbeat/lease table at any migration version.** `grep -rn -i "heartbeat"
src` → zero hits. Migration 4 (`src/storage/sqlite/migrations.ts:143-150`) is
  the only place `initiatives.paused` is defined.
- **No fake git adapter exists.** `src/landing/git.test.ts`,
  `src/publication/git.test.ts`, `src/objective-broker/git.test.ts` all drive real
  git. Story 4's adapter takes an injected command runner so its unit test is
  hermetic.
- **`remove resource` does not exist.** `src/apps/cli/commands/remove.ts:19-22`
  registers only `remove dependency`, `remove initiative-dependency`,
  `remove objective-dependency`, `remove ai-provider`. Nothing in this epic adds
  it: Proof phase D creates its bad repository in a throwaway project instead, so
  no cleanup path is needed. A resource created by any story here is permanent.
- **`AddResource` does not validate a `https-token` credential reference.**
  `src/app/resource/add-resource.ts:76-118` validates only projectId, name
  uniqueness, embedded userinfo, and path; `auth` is passed through verbatim at
  `:110-118`. The only "exists and is a credential" check in `src` is
  `resolveCredential` at `src/composition.ts:600-606`. **Do not add validation
  there** — a dangling reference must stay creatable so the `blocked` verdict is
  reachable through the CLI, which is what Proof phase D exercises.
- **The only value-based credential redactor is an unexported inline closure**,
  `src/agent-runner/pi.ts:455-456`:
  `const redact = (s: string): string => provider.value ? s.split(provider.value).join("***") : s;`
  Story 4 extracts it to `src/domain/redact.ts` and rewires `pi.ts` to it. There
  is no other redactor: `src/app/resource/resource-view.ts:61-72` and
  `src/app/ai-provider/ai-provider-view.ts:5-14` are structural omission, not
  redaction.
- **`buildGitEnv` is not exported** (`src/publication/git.ts:49`). Story 4 adds
  the `export` keyword and reuses it — no second env builder.

**Load-bearing anchors:**

- CLI leaf to mirror: `src/apps/cli/commands/check/graph.ts` (19 lines, whole
  file). Group: `src/apps/cli/commands/check.ts:16` (`command.addCommand(...)`).
  Leaf builder shape is `(deps: CliDeps, io: CliIo) => Command`.
- `src/apps/cli/architecture.test.ts:28` `EXPECTED_LEAF_FILE_COUNT = 65`;
  `:33` `EXPECTED_LEAF_COUNT = 68`. The help test builds with
  `noopDeps = {} as unknown as CliDeps` (`:49`), so a leaf builder must not
  dereference `deps` outside `.action()`.
- **`apps/` may not import a capability port or `domain/`.** Enforced by
  `eslint-plugin-boundaries` (`eslint.config.js:8,21,39`, `"boundaries/dependencies"`
  with `default: "disallow"`). `src/apps/cli/deps.ts:63-78` documents the required
  workaround and `CliWorkspaceManager` is the precedent; `CliRepositoryLanding`
  below it and the inlined `ResourceType` union at `src/apps/cli/resource.ts:14-17`
  are two more. So: `repositoryProbe` on `CliDeps` is a **local structural mirror**
  (`CliRepositoryProbe`, Story 4 §6), while `providerProbe` and `checkProject` are
  imported class types because they live in `app/` (Story 5, Story 6).
  `src/app/project/check-project.ts` may import the real `RepositoryProbe` port —
  `app/` is allowed to, with `import type`.
- Result/exit-code contract: `src/apps/cli/commands/action.ts:1-26` —
  `CliResult {exitCode, stdout, stderr}` + `emitResult`, which sets
  `process.exitCode`. Never `process.exit`, never a thrown error out of an action.
- `--json` precedent: `src/apps/cli/ai-provider.ts:104-120` (one branch on the
  flag, both branches over the same view object).
- Error wording is already exact: `UnknownReferenceError`
  (`src/domain/errors.ts:19-29`) renders as `error: no project with id <id>` with
  exit 1 via `src/apps/cli/error-map.ts:120`, locked by
  `src/apps/cli/error-map.test.ts:20-25`. Phase A needs no new error type.
- Read ports available with no port change: `ProjectRepository.listResources`
  (`src/storage/port.ts:61`), `.getResource` (`:60`),
  `InitiativeRepository.listInitiatives` (`:76`), `.listAllInitiatives`
  (`:88`, returns `{id, paused}` only — join by id),
  `TaskRepository.listByInitiative` (`:112`),
  `AiProviderRegistry.listAssigned` (`:338`), `.list` (`:313`),
  `StatusStore.schemaVersion` (`:46`).
- `Initiative` has **no** `paused` field (`src/domain/initiative.ts:18-25`);
  `paused` is reachable only through `listAllInitiatives()`. Precedent:
  `src/app/task/enqueue-ready-tasks.ts:58-60`.
- `INITIATIVE_STATUSES = ["building","landed","discarded"]`
  (`src/domain/initiative.ts:4`); `status` is optional and defaults to
  `"building"` (`:22`). `TASK_STATUSES` (`src/domain/task.ts:4-11`) —
  "incomplete" excludes `completed` and `discarded`.
- `RepositoryAuth` is a three-variant union, `src/domain/resource.ts:13-16`; the
  credential link exists **only** as `auth.credentialId` on the `https-token`
  variant. There is no `credential` field on `Repository` (`:18-25`).
- `register ai-provider` sets the global default first-wins
  (`src/app/ai-provider/register-ai-provider.ts:242-244`), and
  `ResolveProjectChain` (`src/app/ai-provider/resolve-project-chain.ts:23`, sync,
  reads `registry.listAssigned(projectId)` at `src/storage/port.ts:338`) appends
  that active default to the chain (`src/domain/resolve-provider-chain.ts`).
  **The `ai_provider` check resolves through `ResolveProjectChain` including the
  appended default — bypassing the fallback is prohibited.** A registered but
  unassigned provider is what the daemon would actually run on, so the report says
  `unverified` (Proof phase C2), with a detail naming both `default` and `assign`
  so the implicit dependency stays visible. A report stricter than the daemon is
  the same class of lie as reporting a dead key as `ok`. `missing` means the
  **resolved chain is empty** (Proof phase B). Never use `providerChainFor`
  (`src/composition.ts:482-491`): it takes an initiative id and cannot serve a
  project with no initiative.
- Daemon loop: `src/app/task/run-daemon.ts:136` (`while (true)`), `:153`
  (`await this.#deps.runNext.execute()`), `:198` (poll sleep). SIGINT is wired
  outside the use case at `src/apps/cli/daemon.ts:69-71`, with a `finally` at
  `:108` — that `try/finally` is the heartbeat writer's start/stop site.
- Migration registry: `MIGRATIONS` at `src/storage/sqlite/migrations.ts:66`,
  array closes at `:797`, last entry `version: 26` at `:763`.
  `validateSequence` (`src/storage/sqlite/migrate.ts:54-63`) requires versions to
  be exactly contiguous `1..n`, so the new version is forced to be
  `last + 1`. **Reservations: EPIC 011 story 3 takes 27; EPIC 013 takes 27 and
  28** (011 and 013 already collide with each other). Story 3 therefore fixes the
  migration **name** (`014-s3-daemon-heartbeats`) and derives the number
  mechanically: 27 against the tree as authored, 28 if 011 or 013 landed first,
  29 if both did.
- `git ls-remote` already exists exactly once in `src`:
  `src/publication/git.ts:153` inside `#lsRemoteOID`. No git call site anywhere
  passes a `timeout`.
- `npm run verify` = `package.json:19`:
  `typecheck && test && verify:handoff && lint && node src/main.ts db status`.
  `verify:handoff` (`scripts/verify-handoff.mjs`) only re-runs `tsc --noEmit`; it
  does not read `.agent/plan/**`.
- Lane: `src/storage/sqlite/migrations.ts` and `scripts/e2e/*` are writable by
  the software-engineer; `package.json` and `AGENTS.md` are forbidden
  (`scripts/lane-check.sh:10-19`). No story here needs a forbidden file.

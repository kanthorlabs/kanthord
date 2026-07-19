# EPIC 007.1 — E2E hardening · story index

Epic: `.agent/plan/epics/007.1-e2e-hardening.md`
Findings (input): `.agent/plan/epics/007.1-e2e-findings.md`

**Authoring status (2026-07-19 — EXPANDED).** One coupled bug-fix epic (Groups
**A** observability + safe export, **C** import-context + local landing, **D**
resource lifecycle + secret/transport safety). Group **B** is NOT here — folded
into EPIC 008.1/008.2. Stories follow the repo convention: vertical slices, each
carrying its own end-to-end assertion; the final story consolidates the epic
Proof.

**Format:** every task states **Requires → Input → Action (RED/GREEN/REFACTOR)
→ Output → Verify**. Dispatched through `/work` (engineer lanes). One story per
file; one use case per file (verb-first), per `AGENTS.md`.

## Surfaces re-verified at expansion (2026-07-19, working tree)

- **Migrations top out at version 6** (`epic-007-sha256-and-idempotency`,
  `src/storage/sqlite/migrations.ts`). **007.1's slot is 7.** ONE migration 7
  (`epic-007.1-e2e-hardening`) is **anchored by Story 01 T3** (reshape
  `resources`); Stories **06** (events recreate + `task.verification`), **09**
  (`observability_refs`), **11** (`landing_candidates` / `landing_integrations`
  / `repo_locks`), and **12** (`workspace_cached_policies`) **append their DDL to
  that same migration-7 `up` block** — they never create a second migration.
  `user_version` is a single integer, so this is the only safe pattern; the
  number is confirmed when the epic starts.
- **Resource domain** (`src/domain/resource.ts`): `RESOURCE_TYPES =
[repository, credential, notification, ai_provider, filesystem]`.
  `Repository { id, projectId, type, name, organization, branch, path }`
  (**D2 reshapes** → `remoteUrl` + `auth` union, drops `organization`).
  `Credential { …, provider, value }` (**D4/D6** — `value` off argv + omitted).
  `AIProvider { …, provider, model, baseUrl?, effort? }`, `REASONING_EFFORTS`
  (**D3** validates `(provider, model)`).
- **`AddResource`** (`src/app/resource/add-resource.ts`) — a typed
  discriminated-union input, one variant per type; `DuplicateNameError` /
  `UnknownReferenceError` / `WrongTypeReferenceError` (`src/app/errors.ts`).
  **No `UpdateResource` / `update-*` use case exists** — D1 is net-new.
- **CLI** is a grep-able `COMMANDS` table keyed `"<verb> <object>"`
  (`src/apps/cli/router.ts`); resource create handlers in
  `src/apps/cli/resource.ts` (`runCreateRepository` uses `--organization`;
  `runCreateCredential` uses `--value` — **the D4 leak**;
  `runCreateAiProvider` validates only `--effort`, not the model — **the D3
  gap**). **No `get resource` and no `update *` command exist** — D1/D6 add
  them. `find resource` returns an id only.
- **Workspace** (`src/workspace/local.ts`, port `src/workspace/port.ts`):
  `WorkspaceManager.prepare(taskId, source) → Workspace { dir, branch,
baseCommit }`. `buildRemoteUrl` HARDCODES
  `https://github.com/<org>/<name>.git` (**the D2 bug**); `prepareFromRepository`
  clones `home`, validates `origin`, clones the workspace at `repo.branch`;
  `prepareFromFilesystem` inits git. `execFile` (no shell) is already used.
- **Landing** (`src/app/task/approve-task.ts`): `ApproveTask.#promote` moves the
  task branch to the proposal commit **inside the workspace only — it never
  lands to home `main`** (**the C2 bug**). `task_results` has
  `base_commit`/`proposal_commit`/`commit_sha` columns
  (`src/storage/sqlite/migrations.ts:133`); `PiAgentRunner`
  (`src/agent-runner/pi.ts`) captures `workspace.baseCommit` (**A7**: ensure it
  reaches the persisted row).
- **Events** (`src/domain/event.ts`): `EVENT_TYPES` = `task.*` +
  `agent.started|progress|finished`. **No `task.verification`** (A4 adds it);
  the `agent.progress` 1-per-5s cap lives in `src/agent-runner/pi.ts` (**A3**:
  move to the feed DISPLAY). `SqliteEventFeed` + `newEvent`
  (`src/domain/event.ts`), `ListEvents` (`src/app/task/list-events.ts`).
- **`RunDaemon`** (`src/app/task/run-daemon.ts`) delegates to
  `recover`/`enqueueReady`/`runNext` — **A1 adds a `Logger` port** wired to
  stdout by the CLI (`daemon run`), not `console.log` in the use case.
- **`GetTask`** (`src/app/task/get-task.ts`) returns `{ task, result }` where
  `result: TaskResultRow`; **it does NOT load `task_context`** (**A5**) and there
  is no `--result` render (**A2**).
- **Provider/models** (`src/agent/provider-session.ts`,
  `src/apps/cli/models.ts`): `PiProviderSessionFactory` builds on pi-ai
  `builtinModels`; `ListModels`/`get models` list the catalog. **D3** introduces
  an app-owned `ModelCatalog` port (pi adapter) for create/update validation,
  keeping the authoritative check at session open.
- **Graph codec** in core `src/app/graph/` (moved there by EPIC 008's
  prerequisite; if still CLI-side at expansion, C1 coordinates). `CreateGraph` /
  `ApplyGraph` / `ExportInitiative`; format currently has NO context field
  (**the C1 bug**). Graph format version bumps for C1 (coordinate with EPIC
  007's version — do not reuse it).
- **Composition root** `src/composition.ts` (`buildDeps`) is the ONLY module
  wiring adapters (`LocalWorkspaceManager`, `PiProviderSessionFactory`,
  repos, `SqliteEventFeed`). Every new port is injected here.
- **`Task.agent → Task.executor` rename is EPIC 008's**, not 007.1. Stories here
  keep the current `agent:` / `--agent` names; the C1 executor-binding-set
  validation refers to whatever the field is named when the epic runs.

## Stories (build order = dependency order)

1. [D2 — repository transport identity + secure git](01-d2-repo-transport.md)
   — new `Repository { remoteUrl, auth }` shape, `GIT_ASKPASS` injection, reject
   embedded userinfo, migrate the hardcoded GitHub URL. **Foundation** for D1 +
   C2/D5.
2. [D4 — secret input off argv](02-d4-secret-input.md) — remove `--value`;
   hidden-TTY reader / `--value-file` (`-`=stdin); `--value-timeout` (fails,
   never hangs); newline contract.
3. [D6 — structural omission of credential values + `get resource`](03-d6-omission-get-resource.md)
   — value structurally omitted from every serialization; a `get resource` read
   command that never emits the value; canary. Feeds story 9's export.
4. [D3 — `ModelCatalog` port + create/update validation](04-d3-model-catalog.md)
   — reject unknown `(provider, model)` at create AND update; point to
   `get models`; drop the escape hatches.
5. [D1 — typed `update` use cases + CLI](05-d1-typed-update.md) — `update
ai-provider|credential|repository|notification|filesystem`; immutable vs
   mutable field sets; `--clear-*`; no silent origin rewrite; value via
   `--value-file`; model via the D3 catalog. **Requires 1, 3, 4.**
6. [A — private journal: un-throttle capture + verification/turn/token events](06-a-journal-events.md)
   — A3 (throttle only the display), A4 (`task.verification` event), A6
   (numeric turn/token fields); event-type migration.
7. [A1 — daemon lifecycle logging (`Logger` port → stdout)](07-a1-daemon-logging.md)
   — readable claimed/started/verifying+result/outcome lines; port injected,
   wired by `daemon run`. **Requires 6.**
8. [A2/A5 — `get task --result` + context in `--json`](08-a2-a5-inspect.md) —
   `GetTask` loads `task_context`; `--result` renders summary / verification /
   commit / files changed. **Requires 6.**
9. [A — `diagnostics export`: closed safe-facts schema + canary](09-a-diagnostics-export.md)
   — the single sanitization boundary; opaque random refs, `seq` gaps, exact
   -schema validation, import restriction, canary tests (no prompts / paths /
   commands / tool-args / creds / repo / branch / commit). **Requires 3, 6.**
10. [C1 — `import graph` context binding (alias→id)](10-c1-import-context.md) —
    binding aliases in the codec + graph format version bump; `--bind` id
    resolution (name shorthand rejected on 0/multiple); provider↔credential +
    executor binding-set validation before the graph txn; context in `get task
--json`. **Requires resources (1–5).**
11. [C2 / A7 — `RepositoryLanding` port: local landing under a lock + durable SHA](11-c2-landing.md)
    — redefine same-repo `completed`; land the accepted candidate to the home
    canonical branch under a cross-process per-repo+branch lock; durable SHA
    metadata (fixes A7 `base_commit`); ff/merge/typed-conflict; crash-idempotent;
    wire into `approve`/completion. **Requires 1.**
12. [D5 — authenticated fetch + reconcile (shared lock + SHA CAS) + `sync`](12-d5-fetch-reconcile.md)
    — every online prepare fetches under the story-11 lock, compare-and-swaps
    local `main`, clones the workspace from the recorded canonical SHA; explicit
    `sync` (merge / typed conflict); cached-mode policy. **Requires 1, 11.**
13. [End-to-end smoke — consolidates the epic Proof](13-e2e-smoke.md) — Part A
    deterministic (real git in temp dirs) + Part B guarded live-provider.

## Golden-test / canary bullets, distributed

- **D6 structural-omission canary** (value never in any serialization) → **Story 3**,
  reused by the export canary in **Story 9**.
- **Landing real-git tests** (ff / merge / typed conflict / crash-idempotent /
  cross-process lock contention) → **Story 11**; fetch/reconcile CAS → **Story 12**.
- **Export canary** (no prompts/paths/commands/tool-args/creds/repo/branch/commit
  strings reach the safe artifact) → **Story 9**.
- **Hidden-TTY reader** (raw-mode restore in `finally`, `--value-timeout` fails
  not hangs) → **Story 2**.

## Cross-epic amendments (annotated "superseded/extended by EPIC 007.1")

- **EPIC 003 migrations** — a new migration **7**
  (`epic-007.1-e2e-hardening`): reshape `resources` for the Repository
  `remoteUrl`/`auth` union (D2); add landing/lock/SHA metadata (C2/D5); add the
  private-journal fields for turn/token + `task.verification` (A); ensure
  `task_results.base_commit` is persisted (A7).
- **`src/domain/resource.ts`** — `Repository` shape change (D2); no change to
  `Credential.value` shape but its serialization is structurally omitted (D6).
- **`src/domain/event.ts`** — `EVENT_TYPES` gains `task.verification` (A4).
- **`src/workspace/local.ts`** — `buildRemoteUrl` removed; clone/fetch use the
  D2 `remoteUrl` + `GIT_ASKPASS` injection (D2); prepare acquires the per-repo
  lock + clones from the recorded canonical SHA (D5).
- **`src/app/task/approve-task.ts`** — completion LANDS via the new
  `RepositoryLanding` port instead of only promoting the workspace ref (C2).
- **`src/apps/cli/router.ts`** — new `COMMANDS` keys: `update ai-provider` /
  `update credential` / `update repository` / `update notification` / `update
filesystem` (D1), `get resource` (D1/D6), `diagnostics export` (A),
  `repo land` + `repo sync` (C2/D5); `get task --result` flag (A2); `import
graph --bind` (C1); `create credential --value-file` replaces `--value` (D4);
  `create repository --remote-url/--auth/--credential` replaces `--organization`
  (D2).
- **`Task.agent → Task.executor` rename is OWNED BY EPIC 008**, not 007.1.

# Story 6 — `CheckProject` fact collector + `check project` CLI leaf

Epic: `.agent/plan/epics/014-project-readiness-check.md`
Depends on: Stories 1, 2, 3, 4, 5 (all of them — this is the only story that wires
anything into `composition.ts` or the CLI, and the only one that turns the Proof
green).

## Change

### 1. New file `src/app/project/check-project.ts` — the fact collector

The one impure piece: it does every read and every clock read, then calls the pure
`buildProjectReadiness`. Narrow structural deps (not the whole storage ports), so
its test needs no port-wide fake.

```ts
export interface CheckProjectDeps {
  projects: {
    get(id: string): { id: string } | undefined;
    listResources(projectId: string): Resource[];
    getResource(id: string): Resource | undefined;
  };
  initiatives: {
    listInitiatives(projectId: string): Initiative[];
    listAllInitiatives(): Array<{ id: string; paused: boolean }>;
  };
  tasks: { listByInitiative(initiativeId: string): Task[] };
  providers: {
    /** The daemon's resolved chain, in order, including the appended active global default. */
    chain(projectId: string): Array<{ id: string; name: string }>;
    /** Ids of the explicit project assignments, whatever their state. */
    assignedIds(projectId: string): string[];
  };
  status: { schemaVersion(): number };
  expectedSchemaVersion: number;
  heartbeat: {
    staleMs: number;
    instances(): Array<{ instanceId: string; ageMs: number }>;
  };
  repositoryProbe: RepositoryProbe;
  providerProbe: { execute(providerId: string): Promise<ProviderProbeOutcome> };
}
```

`check-project.ts` is in `app/`, so it may import `RepositoryProbe` from
`src/repository-probe/port.ts` — but with `import type` only (AGENTS.md: "use
`import type` for ports"). This is the opposite of `src/apps/cli/deps.ts`, which
must mirror that port structurally instead (Story 4 §6): `app/` may import a port,
`apps/` may not.

```ts
export interface CheckProjectInput {
  id: string;
  probeRepositories: boolean;
  probeProvider: boolean;
}

export class CheckProject {
  constructor(deps: CheckProjectDeps);
  execute(input: CheckProjectInput): Promise<ReadinessReport>;
}
```

`execute` body, pinned in this order:

1. `if (this.#deps.projects.get(input.id) === undefined) throw new UnknownReferenceError("project", input.id);`
   — imported from `../errors.ts` (`src/app/errors.ts:70`). This gives Proof phase A
   its `error: no project with id …` line with exit 1 via
   `src/apps/cli/error-map.ts:120` for free; no new error type.
2. **repositories** — `projects.listResources(input.id)`, keep
   `r.type === "repository"`, sort ascending by `id`, map to `RepositoryFact`:
   - `credentialId = r.auth.kind === "https-token" ? r.auth.credentialId : null`
     (`src/domain/resource.ts:13-16` — there is no `credential` field on
     `Repository`; the link lives only inside the `https-token` variant).
   - `const c = credentialId === null ? undefined : projects.getResource(credentialId);`
     → `credentialExists = c !== undefined`,
     `credentialIsCredentialType = c?.type === "credential"`.
   - `auth = r.auth.kind`.
3. **initiatives** — `initiatives.listInitiatives(input.id)`, sorted ascending by
   `id`; `paused` from a `Map` built once from
   `initiatives.listAllInitiatives()` (`Initiative` has no `paused` field —
   `src/domain/initiative.ts:18-25`; precedent
   `src/app/task/enqueue-ready-tasks.ts:58-60`), defaulting to `false` when the id
   is absent; `status = i.status ?? "building"`
   (`src/domain/initiative.ts:22` — optional, defaults to building);
   `incompleteTaskCount = tasks.listByInitiative(i.id).filter((t) => t.status !== "completed" && t.status !== "discarded").length`.
4. **aiProvider** — resolve **exactly as the daemon does**:
   ```ts
   const assignedIds = new Set(this.#deps.providers.assignedIds(input.id));
   const resolved = this.#deps.providers.chain(input.id).map((p) => ({
     id: p.id,
     name: p.name,
     source: assignedIds.has(p.id)
       ? ("assigned" as const)
       : ("default" as const),
   }));
   const aiProvider = { resolved, assignedCount: assignedIds.size };
   ```
   `chain` is `ResolveProjectChain.execute(projectId)`
   (`src/app/ai-provider/resolve-project-chain.ts:23`, synchronous,
   `AiProviderView[]` in rank order), which calls `registry.listAssigned(projectId)`
   (`src/storage/port.ts:338`) and appends the active global default via
   `resolveProviderChain` (`src/domain/resolve-provider-chain.ts`).
   `source` cannot come from `AiProviderView.isDefault`
   (`src/app/ai-provider/ai-provider-view.ts:5-14`): that is also `true` when the
   default _is_ assigned. Membership in `assignedIds` is the only correct test.
   **Do not bypass the default fallback.** `register ai-provider` sets the global
   default first-wins (`src/app/ai-provider/register-ai-provider.ts:242-244`), so a
   registered-but-unassigned provider is what the daemon would actually run on; a
   report that called it `missing` would be stricter than the daemon, which is the
   dishonesty this epic exists to prevent. Proof phase C2 asserts `unverified` with
   a detail naming both `default` and `assign`.
   Do **not** use `providerChainFor` (`src/composition.ts:482-491`): it takes an
   initiative id and cannot serve a project with no initiative.
5. **database** — `{ schemaVersion: status.schemaVersion(), expectedSchemaVersion }`.
6. **daemon** — `{ instances: heartbeat.instances(), staleMs: heartbeat.staleMs }`.
7. **probes** — build the `probes` object so a key is **absent** unless the
   corresponding flag was passed:
   - `probeRepositories === true` → `probes.repositories = []` then, for each
     repository fact **in ascending id order, sequentially (`for … of` with
     `await`, never `Promise.all`)**, push
     `{ resourceId: r.id, ...(await repositoryProbe.probe({ remoteUrl, branch, auth })) }`.
     Sequential order is what makes the array deterministic.
   - `probeProvider === true` → `probes.provider = []` then, when
     `resolved.length > 0`, push the outcome of
     `providerProbe.execute(resolved[0].id)`. Exactly one provider is probed: the
     **first member of the resolved chain** — the one the daemon would use first,
     whether it arrived by assignment or as the global default. With an empty
     chain the array stays empty; the `ai_provider` check is already
     `missing`/`blocked`, so `configured` is false regardless.
   - Both flags false → `probes` is `{}` and `verified` is `null`.
8. `return buildProjectReadiness(facts);`

The report is not cached and holds no clock: `heartbeat.instances()` is called once
per `execute`.

### 2. New file `src/apps/cli/project-readiness.ts` — the handler

```ts
export async function runCheckProject(
  args: Record<string, unknown>,
  checkProject: CheckProject,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }>;
```

- `const id = requireFlag(args, "id");` — reuse the `requireFlag` +
  `MissingFlagError` + `toResult` pattern of
  `src/apps/cli/ai-provider.ts:98-124`.
- `const report = await checkProject.execute({ id, probeRepositories: args["probe-repositories"] === true, probeProvider: args["probe-provider"] === true });`
- `--json` branch (`args["json"] === true`):
  `{ exitCode: report.ready ? 0 : 1, stdout: [JSON.stringify(report, null, 2)], stderr: [] }`.
  **`stderr` must be exactly `[]`** — the Proof captures `>file 2>&1` and then
  `JSON.parse`s the file, so a single stray stderr line breaks four phases.
- Text branch, in this exact line order:
  1. `project: ${report.projectId}`
  2. `configured: ${report.configured}`
  3. `verified: ${report.verified === null ? "null" : report.verified}`
  4. `operational: ${report.operational}`
  5. `ready: ${report.ready}`
  6. per check, in `checks` order: `${c.name.padEnd(13)}${String(c.status).padEnd(11)}${c.detail}`
  7. per probe of that check, immediately under it:
     `  - ${p.resourceId} ${p.status} ${p.detail}`
  8. when `report.next !== null`: `next: ${report.next.action}`, then
     `  requires: ${report.next.requiresInput.join(", ")}` if `requiresInput` is
     non-empty, else `  run: ${report.next.command}`
     `exitCode` is `report.ready ? 0 : 1`; `stderr` is `[]`.
- `catch (err) { const mapped = toResult(err); return { ...mapped, stdout: [] }; }`
  — identical to `src/apps/cli/ai-provider.ts:121-124`. `UnknownReferenceError` is
  already in the `toResult` allowlist (`src/apps/cli/error-map.ts:120`,
  `src/apps/cli/error-map.test.ts:20-25`).

### 3. New file `src/apps/cli/commands/check/project.ts` — the leaf

Mirror `src/apps/cli/commands/check/graph.ts` exactly (same imports style, same
`.addHelpText("after", …)` shape, no `.configureHelp` — matching its sibling):

```ts
import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runCheckProject } from "../../project-readiness.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildCheckProjectCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("project")
    .description("Diagnose whether a project is ready to run work.")
    .requiredOption("--id <id>", "project id")
    .option("--json", "print the readiness report as JSON")
    .option(
      "--probe-repositories",
      "probe each repository remote with git ls-remote",
    )
    .option(
      "--probe-provider",
      "probe the assigned ai provider (billable: makes a real model call)",
    )
    .addHelpText(
      "after",
      "\nExample:\n  kanthord check project --id 01J0000000000000000000000A --json\n",
    )
    .action(
      async (opts: {
        id: string;
        json?: boolean;
        probeRepositories?: boolean;
        probeProvider?: boolean;
      }) => {
        emitResult(
          await runCheckProject(
            {
              id: opts.id,
              ...(opts.json ? { json: true } : {}),
              ...(opts.probeRepositories ? { "probe-repositories": true } : {}),
              ...(opts.probeProvider ? { "probe-provider": true } : {}),
            },
            deps.checkProject,
          ),
          io,
        );
      },
    );
}
```

`deps` must only be dereferenced inside `.action()` — the architecture help test
builds every leaf with `noopDeps = {} as unknown as CliDeps`
(`src/apps/cli/architecture.test.ts:49`).

### 4. `src/apps/cli/commands/check.ts` — register the leaf

Add the import and, after
`command.addCommand(buildCheckGraphCommand(deps, io));` (line 16):
`command.addCommand(buildCheckProjectCommand(deps, io));`

### 5. `src/apps/cli/architecture.test.ts` — bump both constants

- `:28` `const EXPECTED_LEAF_FILE_COUNT = 65;` → `66` (one new file under
  `commands/check/`).
- `:33` `const EXPECTED_LEAF_COUNT = 68;` → `69`.
- Extend the adjacent comments with `014 adds check project`.

### 6. `src/composition.ts` + `src/apps/cli/deps.ts` — wire it

In `buildDeps`, after the Story 4/5 constructions:

```ts
const checkProject = new CheckProject({
  projects: {
    get: (id) => projectRepository.get(id),
    listResources: (projectId) => projectRepository.listResources(projectId),
    getResource: (id) => projectRepository.getResource(id),
  },
  initiatives: {
    listInitiatives: (projectId) =>
      initiativeRepository.listInitiatives(projectId),
    listAllInitiatives: () => initiativeRepository.listAllInitiatives(),
  },
  tasks: { listByInitiative: (id) => taskRepository.listByInitiative(id) },
  providers: {
    chain: (projectId) => resolveProjectChain.execute(projectId),
    assignedIds: (projectId) =>
      aiProviderRegistry.listAssigned(projectId).map((p) => p.id),
  },
  status: { schemaVersion: () => store.schemaVersion() },
  expectedSchemaVersion: MIGRATIONS[MIGRATIONS.length - 1]!.version,
  heartbeat: {
    staleMs: heartbeatStaleMs,
    instances: () => heartbeatInstances(),
  },
  repositoryProbe,
  providerProbe: probeAiProvider,
});
```

Every dependency is an **arrow wrapper**, never a bare method reference — a bare
reference loses `this` and crashes on the adapters' `#private` fields (AGENTS.md).
`store` is the `SqliteStatusStore` already built at `src/composition.ts:169`;
`resolveProjectChain` is already built at `src/composition.ts:247-250`;
`MIGRATIONS` is already imported there. Construct `checkProject` **after**
`resolveProjectChain` (line 250) so the binding exists.

Expose `checkProject,` in the returned bundle (`src/composition.ts:850-920`) and
declare `checkProject: CheckProject;` on `CliDeps` (`src/apps/cli/deps.ts:131`),
with the matching `import type` at the top of `deps.ts` (mirror `:19`).

## Constraints

- **The default path must spawn no child process.** With neither probe flag,
  nothing may call `repositoryProbe.probe` or `providerProbe.execute`. Proof phase
  F puts a `git` shim earlier in `PATH` that logs every invocation and exits 42;
  the log must stay empty. Constructing `GitRepositoryProbe` is fine — only
  `probe()` spawns.
- **`--probe-provider` is never implied by `--probe-repositories`**, and vice
  versa. Two independent booleans, no coupling.
- **`--json` writes nothing to stderr, ever** (see the handler note above). This
  includes the case where the report is not ready: the report goes to stdout and
  only the exit code says "not ready".
- Exit code is `0` **only** when `report.ready === true`. Every not-ready report
  exits 1, including a report whose only problem is a stopped daemon.
- `process.exitCode` via `emitResult` only. Never `process.exit`, never throw out
  of `.action()` (`src/apps/cli/commands/action.ts:16-25`).
- Do not touch `src/apps/cli/graph-check.ts` or
  `src/apps/cli/commands/check/graph.ts`.
- Do not add a project-discovery, creation, or auto-fix path: `--id` is required
  and the command writes nothing to the database (epic non-goals).

## Verify

- `node --test src/app/project/check-project.test.ts` — new file, hermetic
  (inline fakes for the six narrow deps, no sqlite, no git, no model; mirror the
  inline-fake style of `src/app/task/list-tasks.test.ts:10`):
  - unknown project id → rejects with `UnknownReferenceError` whose `message` is
    `no project with id <id>`, and **no** dep other than `projects.get` is called.
  - a repository with `auth.kind === "https-token"` whose `credentialId` resolves
    to a `credential` resource → `credentialExists: true,
credentialIsCredentialType: true` → report `repository: "unverified"`; the
    same with a missing resource → `"blocked"`; with a resource of type
    `"filesystem"` → `"blocked"`.
  - non-repository resources (`credential`, `filesystem`, `notification`) are
    excluded from the repository facts.
  - `paused` is taken from `listAllInitiatives()` and an initiative absent from
    that list defaults to `paused: false`; an initiative with `status`
    `undefined` is treated as `building`.
  - `incompleteTaskCount` counts `pending`, `running`, `failed`,
    `awaiting_confirmation` and excludes `completed` and `discarded`.
  - **provider source derivation**: `chain` returning `[{id: "p1"}]` with
    `assignedIds` returning `[]` → the fact is
    `{resolved: [{id: "p1", source: "default"}], assignedCount: 0}` and the report
    reads `ai_provider: "unverified"` with a detail containing `default` and
    `assign` (**not** `missing` — the daemon would run on it). The same `chain`
    with `assignedIds` returning `["p1"]` → `source: "assigned"`,
    `assignedCount: 1`, and the detail carries no default suffix.
  - `chain` returning `[]` with `assignedIds` returning `[]` →
    `ai_provider: "missing"`; `chain` returning `[]` with `assignedIds` returning
    `["p1"]` → `ai_provider: "blocked"`.
  - `source` is derived from `assignedIds` membership, not from `isDefault`: a
    chain member that is both assigned and the global default (so an
    `AiProviderView` with `isDefault: true`) whose id **is** in `assignedIds`
    yields `source: "assigned"` and no default suffix.
  - `chain` and `assignedIds` are each called exactly once per `execute`.
  - `probeRepositories: false, probeProvider: false` → `repositoryProbe.probe`
    called 0 times, `providerProbe.execute` called 0 times, `verified === null`.
  - `probeRepositories: true` with three repositories given in descending-id
    order → `probe` called exactly 3 times in **ascending id order**, and
    `checks.repository.probes.map((p) => p.resourceId)` is ascending; one failing
    probe → `verified === false` and that probe's `status === "failed"`.
  - `probeProvider: true` with a two-member resolved chain → `providerProbe.execute`
    called exactly once, with `resolved[0].id`; with an empty chain → called 0
    times, and although `probes.provider` is present-but-empty, nothing ran, so
    `verified === null` (Story 1); with a chain whose only member came from the
    default → called once with that id.
  - `heartbeat.instances()` is called exactly once per `execute`.
- `node --test src/apps/cli/project-readiness.test.ts` — new file, handler-level
  (inline fake `CheckProject`; mirror `src/apps/cli/project.test.ts:1-60`):
  - missing `--id` → `exitCode: 1` and `stderr` contains
    `error: missing required flag --id` (whatever `MissingFlagError` renders).
  - a thrown `UnknownReferenceError("project", "abc")` →
    `{ exitCode: 1, stdout: [], stderr: ["error: no project with id abc"] }`.
  - `--json` with `ready: false` → `exitCode === 1`, `stderr` deep-equals `[]`,
    and `JSON.parse(stdout[0])` deep-equals the report (this is the guard for the
    Proof's `2>&1` + `JSON.parse` capture).
  - `--json` with `ready: true` → `exitCode === 0`.
  - text mode → first five lines are exactly
    `project: …`, `configured: …`, `verified: null`, `operational: …`,
    `ready: …`; one line per check in `checks` order; a probe line
    `  - <id> ok <detail>` directly under its check; a `next:` line followed by
    `  requires: …` when `requiresInput` is non-empty and by `  run: …` when it is
    empty.
  - flag plumbing: `--probe-repositories` alone → `execute` receives
    `{ probeRepositories: true, probeProvider: false }`; `--probe-provider` alone →
    the mirror image; neither flag → both false.
- `node --test src/apps/cli/commands/check.test.ts` — extend the existing file
  (harness at `:10-27`, help pattern at `:66-84`):
  - `kanthord check project --help` output matches `/Usage: kanthord check project/`
    and contains `Example`.
  - omitting `--id` rejects with
    `error.code === "commander.missingMandatoryOptionValue"` (mirror `:51-64`).
  - the existing `check graph` cases still pass unchanged.
- `node --test src/apps/cli/architecture.test.ts` — passes with the two bumped
  constants.
- `npm run lint` — clean. `src/apps/cli/deps.ts`, the new handler
  (`src/apps/cli/project-readiness.ts`) and the new leaf must import nothing from
  `src/domain/` or from any `src/*/port.ts`: `apps/` gets its types from `app/` and
  from the local mirrors (`CliRepositoryProbe`, Story 4 §6).
- `npm run verify` exits 0.
- `scripts/e2e/project-readiness-proof.sh` prints `014 ok: …` (do not modify the
  script). Phase D runs against a throwaway project (`scratch-badcred`) and needs
  no cleanup path: it asserts `repository == blocked`, a `detail` containing
  `credential`, and `configured == false` — all three come from Story 1's
  repository rule 2, whose detail already names the credential reference.
- Proof: `A ok`, `B ok`, `C ok`, `D ok`, `E ok`, `F ok`, `G ok`, `H ok`,
  `014 ok:`.

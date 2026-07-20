# Story 02 — `create` verb group (9 leaves)

Epic: `.agent/plan/epics/007.2-migrate-cli-to-commander-js.md`
Requires: Story 01 (shell, `action.ts`, `deps.ts`, `buildProgram`).

## Goal

Migrate all nine `create` routes to Commander leaves, each in its own file under
`src/apps/cli/commands/create/`, composed by `buildCreateCommand`, and wired into
`buildProgram`. Behavior is identical to the old router: the same handler
(`runCreateProject`, `runCreateRepository`, `runCreateCredential`,
`runCreateTask`, …) is called with the same argument values; only the parser
changes.

## Locked contracts

```ts
// src/apps/cli/commands/create/<leaf>.ts
buildCreateProjectCommand(deps, io); // --name <name>
buildCreateInitiativeCommand(deps, io); // --project <id> --name <name>
buildCreateObjectiveCommand(deps, io); // --initiative <id> --name <name>
buildCreateRepositoryCommand(deps, io); // --project --name --remote-url --branch [--auth] [--credential] [--path]
buildCreateCredentialCommand(deps, io); // --project --name --provider --value-file <path|-> [--value-timeout <dur>]
buildCreateNotificationCommand(deps, io); // --project --name --provider <slack|telegram> --destination
buildCreateAiProviderCommand(deps, io); // --project --name --provider --model [--effort minimal|low|medium|high|xhigh]
buildCreateFilesystemCommand(deps, io); // --project --name --path
buildCreateTaskCommand(deps, io); // --objective --title --instructions --ac... [--agent] [--verification]... [--depends-on]... [--context]...
// src/apps/cli/commands/create.ts -> buildCreateCommand(deps, io): Command
```

## Cross-cutting mapping rule (applies to every leaf in every story)

Commander camelCases long flags in `opts` (`--remote-url` → `opts.remoteUrl`,
`--value-file` → `opts.valueFile`, `--depends-on` → `opts.dependsOn`). The
existing handlers read a `Record<string, unknown>` keyed by the **original kebab
names** (`args["remote-url"]`, `args["value-file"]`, `args["depends-on"]`). Each
leaf action therefore builds the args record with the **exact kebab keys the
handler reads** before calling it, e.g.:

```ts
.action(async (opts) => {
  emitResult(await runCreateRepository({
    project: opts.project, name: opts.name,
    "remote-url": opts.remoteUrl, branch: opts.branch,
    auth: opts.auth, credential: opts.credential, path: opts.path,
  }, deps.addResource), io);
});
```

Repeated options use a collector:
`.option("--ac <criterion>", "…", (v, acc: string[]) => (acc.push(v), acc), [])`
→ `opts.ac` is `string[]`. Booleans: `.option("--json", "…")` → `opts.json`.

**Choice-like flags** (`--auth`, `--effort`, `--provider`, `--resolution`,
`--method`) **document** valid values in help text but do **not** use commander
`.choices()` — validation stays in the handlers/use cases so exact error
messages and exit codes are preserved (parity). Required inputs use
`.requiredOption(...)`; optional ones use `.option(...)`.

## Verification Gate

`node --test src/apps/cli/commands/create.test.ts` green; existing
`project.test.ts`, `objective.test.ts`, `initiative.test.ts`, `resource.test.ts`,
`task.test.ts`, `credential-input.test.ts` still green; `npm run typecheck` 0;
`npm run lint` clean.

---

### Task T1 — `create` parent + project / initiative / objective leaves

**Requires:** Story 01 T4.

**Input:** `src/apps/cli/commands/create.ts` (new),
`src/apps/cli/commands/create/{project,initiative,objective}.ts` (new),
`src/apps/cli/commands/create.test.ts` (new),
`src/apps/cli/{project,initiative,objective}.ts` (handlers, unchanged).

**Action — RED:** in `create.test.ts`: for each of the three leaves, build the
leaf with a spy use case, `parseAsync` a valid argv, and assert the spy received
the mapped values and `cap` captured the handler result; also assert a missing
`--name` rejects (`.exitOverride()`, `err.code` is the commander missing-option
code). Each leaf `--help` shows `Usage: kanthord create <resource>` + an example.
Fails today: modules do not exist.

**Action — GREEN:** create the three leaf files (description, options/required
options, example, action → `emitResult(await runX(args, deps.x), io)`). Create
`create.ts`: `new Command("create").description(...).showHelpAfterError()` and
`.addCommand()` the three leaves.

**Action — REFACTOR:** none.

**Output:** `create project|initiative|objective` are Commander leaves.

**Verify:** `node --test src/apps/cli/commands/create.test.ts` green; `npm run
typecheck` 0.

---

### Task T2 — notification / filesystem / ai-provider leaves

**Requires:** T1.

**Input:** `src/apps/cli/commands/create/{notification,filesystem,ai-provider}.ts`
(new), `src/apps/cli/commands/create.ts`, `src/apps/cli/commands/create.test.ts`,
`src/apps/cli/resource.ts` (handlers, unchanged).

**Action — RED:** add tests: `create notification` maps `--provider`/
`--destination` to `runCreateNotification`; `create filesystem` maps `--path`;
`create ai-provider` maps `--provider`/`--model`/`--effort` to
`runCreateAiProvider`; each documents its valid `--provider`/`--effort` values in
`--help`. Assert spies + `cap`. Fails today: leaves not registered.

**Action — GREEN:** create the three leaf files (per the mapping rule; `--effort`
optional, valid values in help text, no `.choices()`), `.addCommand()` them in
`create.ts`.

**Action — REFACTOR:** none.

**Output:** three more `create` leaves wired.

**Verify:** `node --test src/apps/cli/commands/create.test.ts` green.

---

### Task T3 — `create repository` leaf

**Requires:** T1.

**Input:** `src/apps/cli/commands/create/repository.ts` (new),
`src/apps/cli/commands/create.ts`, `src/apps/cli/commands/create.test.ts`,
`src/apps/cli/resource.ts`.

**Action — RED:** test that `create repository --project p --name n --remote-url
https://… --branch main --auth https-token --credential c --path ./x` calls
`runCreateRepository` with the record `{ project, name, "remote-url", branch,
auth, credential, path }` (exact kebab keys); `--remote-url`/`--branch` are
required; `--help` documents the `--auth` values. Fails today: leaf missing.

**Action — GREEN:** create `repository.ts` with required `--project/--name/
--remote-url/--branch` and optional `--auth/--credential/--path`; action maps to
kebab keys and calls `runCreateRepository(args, deps.addResource)`. Register in
`create.ts`.

**Action — REFACTOR:** none.

**Output:** `create repository` migrated with `remote-url`/`auth` intact.

**Verify:** `node --test src/apps/cli/commands/create.test.ts` green; existing
`resource.test.ts` still green.

---

### Task T4 — `create credential` leaf (TTY / stdin / `--value-file`)

**Requires:** T1.

**Input:** `src/apps/cli/commands/create/credential.ts` (new),
`src/apps/cli/commands/create.ts`, `src/apps/cli/commands/create.test.ts`,
`src/apps/cli/resource.ts`, `src/apps/cli/credential-input.ts`.

**Action — RED:** test that `create credential --project p --name n --provider
anthropic --value-file -` calls `runCreateCredential(args, deps.addResource,
{ tty, stdin })` where `args` carries `{ project, name, provider, "value-file",
"value-timeout" }` (exact kebab keys) and the third argument is the
`{ tty, stdin }` reader object (assert it is passed, e.g. via a spy). The
example in `--help` must NOT contain a secret value (uses `--value-file`). Fails
today: leaf missing.

**Action — GREEN:** create `credential.ts` reproducing the old router's reader
construction verbatim: `{ tty: process.stdin.isTTY ? process.stdin : undefined,
stdin: process.stdin }`, then `emitResult(await runCreateCredential(args,
deps.addResource, reader), io)`. Register in `create.ts`.

**Action — REFACTOR:** none.

**Output:** `create credential` migrated; secret input path unchanged.

**Verify:** `node --test src/apps/cli/commands/create.test.ts` green; existing
`credential-input.test.ts` still green.

---

### Task T5 — `create task` leaf (repeated `--ac`/`--verification`/`--depends-on`/`--context`)

**Requires:** T1.

**Input:** `src/apps/cli/commands/create/task.ts` (new),
`src/apps/cli/commands/create.ts`, `src/apps/cli/commands/create.test.ts`,
`src/apps/cli/task.ts`.

**Action — RED:** test that `create task --objective o --title t --instructions i
--ac a1 --ac a2 --verification v1 --depends-on d1 --context type=r1` calls
`runCreateTask` with `{ objective, title, instructions, ac: ["a1","a2"],
verification: ["v1"], "depends-on": ["d1"], context: ["type=r1"], agent? }`
(repeated options collected to arrays; kebab key `"depends-on"`). Fails today:
leaf missing.

**Action — GREEN:** create `task.ts` with required `--objective/--title/
--instructions`, repeatable `--ac/--verification/--depends-on/--context` via
collectors, optional `--agent`; map to the handler's record (repeated keys as
arrays under their kebab names) and call `runCreateTask(args, deps.createTask)`.
Register in `create.ts`.

**Action — REFACTOR:** none.

**Output:** `create task` migrated with all repeatable inputs.

**Verify:** `node --test src/apps/cli/commands/create.test.ts` green; existing
`task.test.ts` still green.

---

### Task T6 — wire `create` into `buildProgram`

**Requires:** T1–T5.

**Input:** `src/apps/cli/index.ts`, `src/apps/cli/index.test.ts`.

**Action — RED:** in `index.test.ts`: `buildProgram(deps, cap.io)` `--help`
lists `create`; parsing `["create","project","--name","x"]` runs
`runCreateProject` and `cap` captures the id. Fails today: `create` not added.

**Action — GREEN:** `program.addCommand(buildCreateCommand(deps, io))` in
`index.ts`.

**Action — REFACTOR:** none.

**Output:** the `create` group is reachable from the program root.

**Verify:** `node --test src/apps/cli/index.test.ts` green; `npm run typecheck`
0; `npm run lint` clean.

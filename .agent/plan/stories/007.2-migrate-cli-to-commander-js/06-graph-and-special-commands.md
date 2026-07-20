# Story 06 — Graph + special routes (7 leaves)

Epic: `.agent/plan/epics/007.2-migrate-cli-to-commander-js.md`
Requires: Story 01 (shell). Independent of Stories 02–05.

## Goal

Migrate the routes with positional arguments, inline argument assembly, or a
rename/rewrite: `import resource`, `import graph` (positional `<dir>` + repeated
`--bind alias=id`), `export initiative` (positional `<id>`), `export diagnostic`
(was `diagnostics export`), `login provider` (was positional `login <provider>`),
`run daemon` (was `daemon run`), `land repository` (was `repo land`). These carry
the trickiest parity risk, so each reproduces the old router's inline logic
verbatim.

## Locked contracts

```ts
// commands/import.ts -> buildImportCommand ; leaves:
buildImportResourceCommand; // --path <file>
buildImportGraphCommand; // <dir> (positional, default ".") [--create --project] [--apply --initiative]
//   [--dry-run] [--delete-missing [--confirm-delete]] [--bind alias=<id>]...
// commands/export.ts -> buildExportCommand ; leaves:
buildExportInitiativeCommand; // <id> (positional) --out <dir>
buildExportDiagnosticCommand; // --initiative <id> --out <path> [--task <id>] [--debug]   (was `diagnostics export`)
// commands/login.ts -> buildLoginCommand ; leaf:
buildLoginProviderCommand; // --provider <provider> --project <id> --name <name> [--method browser|device_code]
// commands/run.ts -> buildRunCommand ; leaf:
buildRunDaemonCommand; // [--fail <id>]... [--until-idle] [--poll-interval <ms>]   (was `daemon run`)
// commands/land.ts -> buildLandCommand ; leaf:
buildLandRepositoryCommand; // --repository <id> --workspace <dir> --base <branch> --candidate <sha>  (was `repo land`)
```

Positionals use `.argument(...)`: `import graph` →
`.argument("[dir]", "graph directory", ".")`; `export initiative` →
`.argument("<id>", "initiative id")`. The action signature is
`(positionalArgs..., opts)`.

## Verification Gate

`node --test src/apps/cli/commands/special.test.ts` green; existing
`import.test.ts`, `import-graph.test.ts`, `export.test.ts`, `diagnostics.test.ts`,
`login.test.ts`, `daemon.test.ts`, `repo.test.ts`,
`router-positional.regression.test.ts`, `graph-import-export.e2e.test.ts` still
green; `npm run typecheck` 0; `npm run lint` clean.

---

### Task T1 — `import` parent + `import resource` + `import graph` (positional + `--bind`)

**Requires:** Story 01 T4.

**Input:** `commands/import.ts`, `commands/import/{resource,graph}.ts` (new),
`commands/special.test.ts` (new), `src/apps/cli/import.ts`,
`src/apps/cli/import-graph.ts`, and the old `import graph` entry in
`src/apps/cli/router.ts` (source of the inline assembly to copy).

**Action — RED:** (a) `import resource --path f` → `runImportResource({path:"f"},
deps.importResources)`. (b) `import graph ./g --create --project p --bind a=r1
--bind b=r2 --dry-run` calls `runImportGraph` with the options object
`{ dir:"./g", create:true, apply:false, dryRun:true, deleteMissing:false,
confirmDelete:false, project:"p", initiative:undefined,
bind:{a:"r1",b:"r2"} }` and the second-argument dependency object
(`createGraph/applyGraph/newId/getResource/findResourcesByName`); (c) `import
graph` with no positional defaults `dir` to `"."`. Assert via spy. Fails today:
modules missing.

**Action — GREEN:** create `import/resource.ts` (simple). Create
`import/graph.ts` with `.argument("[dir]", …, ".")` and the flags; in the action,
**copy verbatim** from the old router entry: the `--bind alias=value` → record
parse, the `dir ?? "."` default, and the second-argument object with the
`getResource`/`findResourcesByName` try/catch closures. Compose both in
`import.ts`.

**Action — REFACTOR:** none.

**Output:** `import resource` and `import graph` migrated; positional + bind
parsing preserved.

**Verify:** `node --test src/apps/cli/commands/special.test.ts` green; existing
`import.test.ts`, `import-graph.test.ts` still green.

---

### Task T2 — `export` parent + `export initiative` (positional) + `export diagnostic` (rename)

**Requires:** Story 01 T4.

**Input:** `commands/export.ts`, `commands/export/{initiative,diagnostic}.ts`
(new), `commands/special.test.ts`, `src/apps/cli/export.ts`,
`src/apps/cli/diagnostics.ts`.

**Action — RED:** (a) `export initiative I --out D` calls
`runExportInitiative({ id:"I", out:"D" }, deps.exportInitiative)` — the id
arrives as the **positional**, not `--id`; (b) `export diagnostic --initiative I
--out P --task T --debug` calls `runDiagnosticsExport` with `{ initiative:"I",
out:"P", task:"T", debug:true }`; the old spelling `diagnostics export` does NOT
resolve. Assert spies + `cap`. Fails today: modules missing.

**Action — GREEN:** create `export/initiative.ts` (`.argument("<id>")` +
`--out`), mapping the positional id + `--out` to the handler object; create
`export/diagnostic.ts` calling `runDiagnosticsExport`. Compose in `export.ts`.

**Action — REFACTOR:** none.

**Output:** `export initiative` (positional) and `export diagnostic` (rename)
migrated.

**Verify:** `node --test src/apps/cli/commands/special.test.ts` green; existing
`export.test.ts`, `diagnostics.test.ts` still green.

---

### Task T3 — `login provider` (rewrite of positional `login <provider>`)

**Requires:** Story 01 T4.

**Input:** `commands/login.ts`, `commands/login/provider.ts` (new),
`commands/special.test.ts`, `src/apps/cli/login.ts`.

**Action — RED:** `login provider --provider openai-codex --project p --name n
--method browser` calls `runLogin("openai-codex", args, deps.login)` where the
first argument is the `--provider` value and `args` carries `{ provider, project,
name, method }`; `--provider`/`--project`/`--name` are required; the old
positional form `login openai-codex` does NOT resolve. Assert spy + `cap`. Fails
today: module missing.

**Action — GREEN:** create `login/provider.ts` (required `--provider/--project/
--name`, optional `--method` with values documented) whose action calls
`emitResult(await runLogin(opts.provider, { provider: opts.provider, project:
opts.project, name: opts.name, method: opts.method }, deps.login), io)`. Compose
in `login.ts`.

**Action — REFACTOR:** none.

**Output:** `login provider --provider <p>` migrated; positional login removed.

**Verify:** `node --test src/apps/cli/commands/special.test.ts` green; existing
`login.test.ts` still green.

---

### Task T4 — `run daemon` (rename) + `land repository` (rename)

**Requires:** Story 01 T4.

**Input:** `commands/run.ts`, `commands/run/daemon.ts`, `commands/land.ts`,
`commands/land/repository.ts` (new), `commands/special.test.ts`,
`src/apps/cli/daemon.ts`, `src/apps/cli/repo.ts`.

**Action — RED:** (a) `run daemon --fail t1 --fail t2 --until-idle
--poll-interval 50` calls `runDaemon(args, deps.buildDaemon, deps.logger)` with
`{ fail:["t1","t2"], "until-idle":true, "poll-interval":"50" }` (repeated
`--fail` collected; kebab keys); the old `daemon run` does NOT resolve. (b) `land
repository --repository r --workspace w --base b --candidate c` calls
`runRepoLand(args, deps.repoLanding, deps.resolveHomeDir)` with those keys; the
old `repo land` does NOT resolve. Assert spies + `cap`. Fails today: modules
missing.

**Action — GREEN:** create `run/daemon.ts` (repeatable `--fail` collector,
boolean `--until-idle`, `--poll-interval`; action passes `deps.buildDaemon` and
`deps.logger`) and `land/repository.ts` (required flags). Compose in `run.ts` /
`land.ts`.

**Action — REFACTOR:** none.

**Output:** `run daemon` and `land repository` migrated.

**Verify:** `node --test src/apps/cli/commands/special.test.ts` green; existing
`daemon.test.ts`, `repo.test.ts` still green.

---

### Task T5 — wire `import` / `export` / `login` / `run` / `land` into `buildProgram`

**Requires:** T1–T4.

**Input:** `src/apps/cli/index.ts`, `src/apps/cli/index.test.ts`.

**Action — RED:** `buildProgram` `--help` lists `import`, `export`, `login`,
`run`, `land`; parsing `["run","daemon","--until-idle"]` runs `runDaemon`;
parsing `["export","initiative","I","--out","D"]` runs `runExportInitiative`.
Fails today: not added.

**Action — GREEN:** `program.addCommand(...)` for all five parents.

**Action — REFACTOR:** none.

**Output:** the full 46-leaf tree is reachable from the root (main.ts still uses
the old router — flipped in Story 07).

**Verify:** `node --test src/apps/cli/index.test.ts` green; `npm run typecheck`
0; `npm run lint` clean.

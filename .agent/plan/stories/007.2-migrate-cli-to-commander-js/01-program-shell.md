# Story 01 — Program shell, result boundary, hermetic harness (+ `check`, `db`)

Epic: `.agent/plan/epics/007.2-migrate-cli-to-commander-js.md`

## Goal

Stand up the Commander.js foundation every later story builds on: the single
result adapter (`emitResult` + `CliIo`), the deps interface moved out of
`router.ts` (`CliDeps`), and a rebuilt `buildProgram(deps, io?)` that sets the
program name/description/version and strict, actionable parse errors. Prove the
pattern by migrating the three simplest leaves — `check graph`, `db migrate`,
`db status` — each as its own file with description, option help, and a
copy-paste example. `src/main.ts` is **not** changed here; the new tree is
tested hermetically and the old `dispatch` router stays live.

## Locked contracts (exact names — tests assert)

```ts
// src/apps/cli/commands/action.ts  (new)  — see index.md for the full body.
export interface CliResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}
export interface CliIo {
  out(t: string): void;
  err(t: string): void;
  setExitCode(c: number): void;
}
export const processIo: CliIo;
export function emitResult(result: CliResult, io: CliIo): void;

// src/apps/cli/deps.ts  (new)  — the deps bundle + Logger, moved verbatim from router.ts.
export interface Logger {
  info(m: string): void;
  warn(m: string): void;
  error(m: string): void;
}
export interface CliDeps {
  /* every field currently on RouterDeps, unchanged */
}

// src/apps/cli/commands/check/graph.ts
export function buildCheckGraphCommand(deps: CliDeps, io: CliIo): Command;
// src/apps/cli/commands/check.ts
export function buildCheckCommand(deps: CliDeps, io: CliIo): Command;
// src/apps/cli/commands/db/migrate.ts   -> buildDbMigrateCommand(deps, io)
// src/apps/cli/commands/db/status.ts    -> buildDbStatusCommand(deps, io)
// src/apps/cli/commands/db.ts           -> buildDbCommand(deps, io)

// src/apps/cli/index.ts  (replaces the prototype)
export function buildProgram(deps: CliDeps, io?: CliIo): Command; // io defaults to processIo
```

## Constraints

- `emitResult` is the ONLY place that writes handler stdout/stderr and sets the
  exit code. Leaf actions never call `process.stdout.write` directly.
- `CliDeps` is `RouterDeps` moved byte-for-byte to `deps.ts`. `router.ts` then
  `import type { CliDeps as RouterDeps }` (or re-exports) so `router.ts` and its
  tests stay green. No field renamed.
- `buildProgram` sets `.name("kanthord")`, a one-line `.description(...)`, and
  `.version(...)`. Read the version at runtime from `package.json`
  (`readFileSync(new URL("../../../package.json", import.meta.url))`, parse
  `.version`) — do **not** add a tsconfig JSON-import setting.
- Strict errors: on the program and every parent call `.showHelpAfterError()`.
  Keep Commander's default unknown-command / missing-value / excess-argument
  behaviour (non-zero exit, message on stderr). `requiredOption` marks required
  inputs; `check graph` uses `--path <file>` as a required option.
- `buildCheckGraphCommand` action: `emitResult(await runGraphCheck(opts.path), io)`.
  `buildDbMigrateCommand`: `emitResult(await runDbMigrate(deps.migrateDb), io)`.
  `buildDbStatusCommand`: `emitResult(await runDbStatus(deps.getDbStatus), io)`.
- `index.ts` contains no leaf option/action — only `program.addCommand(buildCheckCommand(...))`
  and `program.addCommand(buildDbCommand(...))`.

## Verification Gate

`node --test src/apps/cli/commands/*.test.ts` green; existing `router.test.ts`
still green (deps move did not break it); `npm run typecheck` 0; `npm run lint`
clean.

---

### Task T1 — result boundary (`action.ts`) + deps move (`deps.ts`)

**Requires:** none.

**Input:** `src/apps/cli/commands/action.ts` (new),
`src/apps/cli/commands/action.test.ts` (new), `src/apps/cli/deps.ts` (new),
`src/apps/cli/router.ts`.

**Action — RED:** in `action.test.ts`: (a) `emitResult({ exitCode: 0, stdout:
["a","b"], stderr: [] }, io)` with a capturing `io` pushes `"a\n"` then `"b\n"`
to out, nothing to err, and `setExitCode(0)`; (b) a result with `stderr` lines
and `exitCode: 1` routes lines to err and sets code 1. Fails today: module does
not exist.

**Action — GREEN:** create `action.ts` with the exact bodies from `index.md`.
Create `deps.ts`: move the `Logger` interface and the whole `RouterDeps` body
out of `router.ts`, exporting them as `Logger` and `CliDeps`. In `router.ts`,
replace the inline declarations with
`import type { CliDeps, Logger } from "./deps.ts"` and
`export type RouterDeps = CliDeps;` so existing imports keep working.

**Action — REFACTOR:** none.

**Output:** the single result adapter exists; `CliDeps`/`Logger` live in
`deps.ts`; `router.ts` compiles against the moved types.

**Verify:** `node --test src/apps/cli/commands/action.test.ts` green;
`node --test src/apps/cli/router.test.ts` green; `npm run typecheck` 0.

---

### Task T2 — `check graph` leaf + `check` parent + hermetic harness note

**Requires:** T1.

**Input:** `src/apps/cli/commands/check/graph.ts` (new),
`src/apps/cli/commands/check.ts` (new),
`src/apps/cli/commands/check.test.ts` (new), `src/apps/cli/graph-check.ts`.

**Action — RED:** in `check.test.ts` using the `capture()` pattern from
`index.md`: (a) build `buildCheckGraphCommand(fakeDeps, cap.io)`, `parseAsync`
`["--path","/tmp/x.yaml"]`, and assert `runGraphCheck` ran with `/tmp/x.yaml`
(spy) and `cap` captured its result; (b) `buildCheckCommand(...)` with
`.exitOverride()` parsing `["graph"]` with no `--path` rejects with
`err.code === "commander.missingMandatoryOptionValue"` (verified — see the error
-code table in `index.md`); (c) `--help` output contains `Usage: kanthord check graph`
and the word `Example`. Fails today: modules do not exist.

**Action — GREEN:** create `check/graph.ts`: a `Command("graph")` with
`.description(...)`, `.requiredOption("--path <file>", "path to the graph YAML
file")`, `.addHelpText("after", … example …)`, and an action calling
`emitResult(await runGraphCheck(opts.path), io)`. Create `check.ts`:
`new Command("check").description(...).showHelpAfterError()` then
`.addCommand(buildCheckGraphCommand(deps, io))`; return it.

**Action — REFACTOR:** none.

**Output:** `check graph` is a real Commander leaf in its own file with complete
help.

**Verify:** `node --test src/apps/cli/commands/check.test.ts` green;
`npm run typecheck` 0.

---

### Task T3 — `db migrate` / `db status` leaves + `db` parent

**Requires:** T1.

**Input:** `src/apps/cli/commands/db/migrate.ts` (new),
`src/apps/cli/commands/db/status.ts` (new), `src/apps/cli/commands/db.ts` (new),
`src/apps/cli/commands/db.test.ts` (new), `src/apps/cli/db.ts`.

**Action — RED:** in `db.test.ts`: (a) `buildDbMigrateCommand(deps, io)` parse
`[]` calls `runDbMigrate(deps.migrateDb)` (spy) and `cap` captures its result;
(b) same for `buildDbStatusCommand`/`runDbStatus`; (c) `buildDbCommand` `--help`
lists `migrate` and `status`; each leaf `--help` shows `Usage: kanthord db
migrate` / `… db status` and an example. Fails today: modules do not exist.

**Action — GREEN:** create the two leaf files (each a `Command`, description,
example, action → `emitResult`) and `db.ts` (`new Command("db")…
.showHelpAfterError()` + `.addCommand()` both leaves).

**Action — REFACTOR:** none.

**Output:** `db migrate` and `db status` are real leaves under a `db` parent.

**Verify:** `node --test src/apps/cli/commands/db.test.ts` green;
`npm run typecheck` 0.

---

### Task T4 — rebuild `buildProgram` (shell + assemble `check` + `db`)

**Requires:** T2, T3.

**Input:** `src/apps/cli/index.ts` (replace prototype),
`src/apps/cli/index.test.ts` (new).

**Action — RED:** in `index.test.ts`: (a) `buildProgram(deps, cap.io)` `--help`
(with `.exitOverride()` + `configureOutput`) contains `Usage: kanthord`,
`check`, and `db`; (b) parsing `["db","migrate"]` runs `runDbMigrate` and
captures its result via `cap`; (c) parsing `["bogus"]` rejects with
`err.code === "commander.unknownCommand"`; (d) `program.version()` returns the
`package.json` version string. Fails today: the prototype has no io seam, no
version, and only `check graph`/`db`.

**Action — GREEN:** rewrite `index.ts` to export `buildProgram(deps, io =
processIo)`: build the program, set name/description/version (read from
`package.json`), `.showHelpAfterError()`, then `.addCommand(buildCheckCommand(
deps, io))` and `.addCommand(buildDbCommand(deps, io))`. No leaf logic here.

**Action — REFACTOR:** remove the old prototype's inline `check`/`db` action
blocks and the old `CliDeps` interface in `index.ts` (now provided by `deps.ts`).

**Output:** `buildProgram` is the assembly-only root; three leaves wired.

**Verify:** `node --test src/apps/cli/index.test.ts` green;
`npm run typecheck` 0; `npm run lint` clean; `node --test src/apps/cli/router.test.ts`
still green.

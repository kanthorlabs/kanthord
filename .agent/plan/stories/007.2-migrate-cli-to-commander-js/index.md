# EPIC 007.2 — Migrate CLI to Commander.js · story index

Epic: `.agent/plan/epics/007.2-migrate-cli-to-commander-js.md`

**Authoring status (2026-07-20 — EXPANDED).** One migration epic: replace the
hand-written `node:util.parseArgs` router (`src/apps/cli/router.ts`) with
Commander.js as the single parser/router, keeping Ports & Adapters intact
(Commander parses and routes only; each leaf calls an existing thin handler and
formats the result). The 46-command inventory is frozen in the epic; the five
renames (`daemon run`→`run daemon`, `events`→`list event`, `get models`→`list
model`, `diagnostics export`→`export diagnostic`, `repo land`→`land repository`)
and `login <provider>`→`login provider --provider <provider>` are applied here.

**Format:** every task states **Requires → Input → Action (RED/GREEN/REFACTOR)
→ Output → Verify**. One story per file. Stories build the new tree
incrementally and test it hermetically; `src/main.ts` keeps using the old
`dispatch` router until the final cutover story, so the tree is never half-wired
at runtime and every intermediate story ends green.

## Surfaces re-verified at expansion (2026-07-20, working tree)

- **Old router** `src/apps/cli/router.ts`: a grep-able `COMMANDS` table keyed
  `"<verb> <object>"`, 46 entries, each `{ usage, parse, positional?, handler }`.
  `dispatch(argv, deps)` returns `{ exitCode, stdout, stderr }` — never throws,
  never calls `process.exit`. `RouterDeps` (46+ fields) and a local `Logger`
  interface are declared inside this file. This file is deleted in the last story.
- **Handlers already exist and are already tested** — `runCreateProject`
  (`project.ts`), `runGetResource` (`resource.ts`), `runImportGraph`
  (`import-graph.ts`), `runEvents` (`events.ts`), `runLogin` (`login.ts`),
  `runGetModels` (`models.ts`), `runDaemon` (`daemon.ts`), etc. Each returns the
  `{ exitCode, stdout, stderr }` shape. **We do not rewrite handlers** — the new
  command files call the same `runX` functions with the same argument values.
  Their existing `*.test.ts` stay green and are the parity net.
- **Prototype** `src/apps/cli/index.ts` exports `buildProgram(deps)` with only
  `check graph`, `db migrate`, `db status`, no io seam, no examples, not called
  by `main.ts`. **Story 01 replaces it.**
- **Entrypoint** `src/main.ts` builds deps via `buildDeps(dbPath, {maxTurns})`,
  then `await dispatch(process.argv.slice(2), deps)` and writes the result. Only
  the last story changes it to `parseAsync`.
- **`commander@^15.0.0`** is already a dependency (`package.json`).
- **Route-pointer to fix (B1):** `src/model-catalog/port.ts` `UnknownModelError`
  message contains ``Run `get models` …`` and `src/model-catalog/port.test.ts`
  asserts that verbatim. The `list model` rename requires updating both. This is
  the one deliberate edit outside `src/apps/cli/` (last story).
- **Special behaviors that must survive parity:** credential stdin/TTY reader
  (`create credential` / `update credential`), `import graph` positional `<dir>`
  - repeated `--bind alias=id` parsing, `export initiative` positional `<id>`,
    `create task` repeated `--ac` / `--verification` / `--depends-on` / `--context`,
    `list event` (`events`) `--follow` + SIGINT AbortController, `run daemon`
    repeated `--fail` + `Logger` wiring.

## Locked shared contracts (all stories depend on these — authored in Story 01)

Directory layout (new):

```text
src/apps/cli/commands/
  action.ts              # CliIo + processIo + emitResult (the one result adapter)
  <group>.ts             # build<Group>Command(deps, io): Command  — composes leaves
  <group>/<leaf>.ts      # build<Group><Leaf>Command(deps, io): Command — one leaf
src/apps/cli/deps.ts     # CliDeps (moved out of router.ts) + Logger interface
src/apps/cli/index.ts    # buildProgram(deps, io?): Command — assembles groups only
```

Result boundary (`src/apps/cli/commands/action.ts`):

```ts
export interface CliResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}
export interface CliIo {
  out(text: string): void; // write to stdout stream
  err(text: string): void; // write to stderr stream
  setExitCode(code: number): void;
}
export const processIo: CliIo = {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
  setExitCode: (c) => {
    process.exitCode = c;
  },
};
/** The single action adapter: writes a handler result via the injected io. */
export function emitResult(result: CliResult, io: CliIo): void {
  for (const line of result.stdout) io.out(line + "\n");
  for (const line of result.stderr) io.err(line + "\n");
  io.setExitCode(result.exitCode);
}
```

Leaf/group/program signatures:

```ts
export function build<Group><Leaf>Command(deps: CliDeps, io: CliIo): Command;
export function build<Group>Command(deps: CliDeps, io: CliIo): Command; // parent
export function buildProgram(deps: CliDeps, io?: CliIo): Command;        // io defaults processIo
```

Every leaf action does exactly: map Commander opts/args → the existing handler's
argument shape → `emitResult(await runX(args, deps.x), io)`. No business logic in
the router layer.

Every leaf **must** declare: `.description(...)`, help text on every
argument/option, and one `.addHelpText("after", "\nExample:\n  $ kanthord …")`
using the canonical route — **never** a credential value in the example argv.
(This distributes epic Story 5 into each command as it is built; the structural
help-completeness test lives in the cutover story.)

Strict, actionable parse errors: on each parent and the program set
`.showHelpAfterError()` and `.allowUnknownOption(false)`; `create task` etc. use
`.requiredOption(...)` for required inputs. Commander's default unknown-command /
missing-argument / excess-argument handling (non-zero exit, message on stderr)
is kept — tests assert it.

## Commander@15 error codes (verified against node_modules, 2026-07-20)

Installed: `commander@15.0.0`. RED assertions use these exact `err.code` strings
(from `program.exitOverride()`; `parseAsync` rejects with a `CommanderError`):

| Situation                                      | `err.code`                              | stderr message                                   |
| ---------------------------------------------- | --------------------------------------- | ------------------------------------------------ |
| `.requiredOption(...)` not supplied            | `commander.missingMandatoryOptionValue` | `error: required option '<flags>' not specified` |
| unknown command / unknown subcommand           | `commander.unknownCommand`              | `error: unknown command '<name>'`                |
| missing required positional `.argument("<x>")` | `commander.missingArgument`             | `error: missing required argument '<name>'`      |
| option present but value missing               | `commander.optionMissingArgument`       | —                                                |
| unknown flag                                   | `commander.unknownOption`               | —                                                |
| excess positional arguments                    | `commander.excessArguments`             | —                                                |

There is **no** `missingRequiredOption` code — a required option uses
`commander.missingMandatoryOptionValue`. Positionals (`import graph`,
`export initiative`) use the `commander.missingArgument` / `excessArguments`
family, not the option family.

## Hermetic test pattern (used by every command test)

```ts
// Build ONE leaf (or the program), override exits, capture io + commander output.
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  let code = 0;
  const io: CliIo = {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    setExitCode: (c) => {
      code = c;
    },
  };
  return { io, out, err, code: () => code };
}
// Fake deps: `{} as CliDeps` filled only with the use-case(s)/spy under test,
// per the existing router.test.ts convention. Assert (a) the spy received the
// mapped values and (b) io captured the handler's stdout/stderr/exit code.
// For parse/unknown errors: cmd.exitOverride() + cmd.configureOutput({writeOut,
// writeErr}); parseAsync rejects with err.code (e.g. "commander.unknownCommand",
// "commander.missingArgument") — assert on that, so no test ever exits the process.
```

## Stories (build order = dependency order)

1. [Program shell, result boundary, hermetic harness (+ `check`, `db`)](01-program-shell.md)
   — `action.ts`, `deps.ts` (move `CliDeps`/`Logger`), rebuilt `buildProgram`,
   program name/description/version, strict errors; migrate `check graph`,
   `db migrate`, `db status` as the reference pattern. **Foundation for all.**
2. [`create` verb group (9 leaves)](02-create-commands.md) — project, initiative,
   objective, repository, credential (TTY/stdin), notification, ai-provider,
   filesystem, task (repeated `--ac`/`--verification`/`--depends-on`/`--context`).
3. [Mutation verbs (10 leaves)](03-mutation-commands.md) — rename
   project/initiative/objective, pause/resume initiative, add/remove dependency,
   retry/approve/reject task.
4. [Read verbs `get`/`find`/`list` (12 leaves)](04-read-commands.md) — get
   task/project/resource, find project/initiative/objective/resource, list
   task/initiative/objective + the renames **`list event`** (follow/SIGINT) and
   **`list model`**.
5. [`update` verb group (5 leaves)](05-update-commands.md) — ai-provider,
   credential (TTY/stdin), repository, notification, filesystem.
6. [Graph + special routes (7 leaves)](06-graph-and-special-commands.md) — import
   resource, **import graph** (positional `<dir>` + repeated `--bind`), export
   initiative (positional `<id>`), **export diagnostic**, **login provider**,
   **run daemon**, **land repository**.
7. [Cutover, caller migration, help test, Proof](07-cutover-and-proof.md) — flip
   `main.ts` to `parseAsync`; fix the `UnknownModelError` route pointer + its
   locked test; update live callers (docs/flowchart, README, scripts, tests) but
   **not** history; add the help-completeness + old-spelling-rejection tests;
   delete `router.ts` + router-only tests; run the epic Proof; `npm run verify`.

## Cross-cutting rules (apply to every story)

- **Do not touch handler logic or output.** New command files import and call the
  existing `runX` handlers with the same argument values. If a handler needs a
  value the old router computed inline (e.g. credential `{ tty, stdin }`, the
  `events` AbortController, the `import graph` `--bind`→record parse), reproduce
  that computation verbatim in the leaf action.
- **`RouterDeps` → `CliDeps`.** Story 01 moves the interface to `deps.ts`;
  `router.ts` imports it back so it and its tests stay green until the cutover.
- **`index.ts` only assembles.** Parents only `.addCommand()` leaves; the program
  only `.addCommand()` parents. No leaf option/action declared in a parent or in
  `index.ts` (an architecture test in Story 07 enforces this).
- **No aliases** for the five old routes or the old positional `login`.
- **History is off-limits.** Route renames update only live callers; never edit
  `.agent/tdd/history/**`, `.agent/tdd/memory/**`, or closed epics/stories.

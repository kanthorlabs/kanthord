# Story 5 — `setup project` CLI leaf + interactive prompt seam

Epic: `.agent/plan/epics/015-guided-project-setup.md`
Depends on: Story 4 (same file, `src/apps/cli/setup/run-setup.ts`).

## Change

### A. The prompt seam — new file `src/apps/cli/setup/prompt.ts`

```ts
export interface SetupPrompt {
  /** Resolves `undefined` on EOF / Ctrl-C. */
  ask(message: string): Promise<string | undefined>;
}
```

**Do not add a member to `CliIo`** (`src/apps/cli/commands/action.ts:12-16`) —
it is output-only, and every `noopIo` / `capture()` literal in the suite
(`src/apps/cli/architecture.test.ts:50-54`,
`src/apps/cli/commands/run-cli.ts:24-30`, and each leaf test) would stop
type-checking. `SetupPrompt` follows the existing precedent of the separate
`LoginIO` type (`src/apps/cli/login.ts:6-19`) wired from the composition root.

The real implementation is wired in `src/composition.ts`, mirroring the readline
block already at `src/composition.ts:832-848`: `createInterface({ input: process.stdin, output: process.stdout })`,
`await rl.question(message + " ")`, `rl.close()` in `finally`, and `undefined`
when the interface closes without a line. Return it in the `buildDeps` bundle as
`setupPrompt`, plus `stdinIsTty: process.stdin.isTTY === true`. Add both to
`CliDeps` (`src/apps/cli/deps.ts:131-211`).

### B. Interactive merge + mode guards — `src/apps/cli/setup/run-setup.ts`

Insert **before** the `parseSetupAnswers` call of Story 4 step 1:

1. `args.nonInteractive && args.answersPath === undefined` → return
   `{ exitCode: 1, stdout: [], stderr: ["error: --non-interactive requires --answers <file>"] }`.
2. `!args.nonInteractive && args.answersPath === undefined && deps.stdinIsTty === false`
   → return
   `{ exitCode: 1, stdout: [], stderr: ["error: stdin is not a TTY; use --answers <file> --non-interactive"] }`.
   This must return, never block on a read.
3. `!args.nonInteractive && deps.prompt === undefined` → the same TTY error as
   step 2.
4. `args.nonInteractive` → skip prompting entirely; a missing answer is Story 2's
   preflight error. **Resume never re-asks for a missing answer.**
5. Otherwise prompt for **exactly the keys that are required and absent**, in
   this fixed order — discriminants before their dependents:

   `project.name`, `repository.name`, `repository.remoteUrl`,
   `repository.branch`, `repository.path`, `repository.auth`,
   `credential.name`, `credential.provider`, `credential.valueFile`,
   `provider.route`, `provider.name`, `provider.provider`, `provider.model`,
   `provider.oauthMethod`, `provider.baseUrl`, `provider.api`,
   `provider.valueFile`, `provider.confirmCost`, `graph.skip`,
   `graph.packagePath`.

   Relevance is recomputed after each discriminant is known: the three
   `credential.*` keys are asked only when `repository.auth === "https-token"`;
   the route-specific provider keys only for that route; `graph.packagePath`
   only when `graph.skip` is `false`. A key already present in the answers file
   is **never** re-prompted.
   `graph.bind.<alias>` is never prompted — the aliases are unknown until the
   package is read; a missing binding fails at the graph step naming the alias.

6. Per-answer validation with re-prompt: after each answer, validate that one
   key in isolation — non-empty; enum membership for `repository.auth`,
   `provider.route`, `provider.api`; exactly `true`/`false` for `graph.skip` and
   `provider.confirmCost`; not `-` for a `*.valueFile`. On an invalid answer
   print `error: <the same message parseSetupAnswers would emit>` to `stderr` and
   re-ask the **same** key. After **3** invalid attempts for one key, return
   `exitCode: 1` with `error: <key>: too many invalid answers`.
7. `ask` resolving `undefined` (EOF / Ctrl-C) at any point → return
   `{ exitCode: 1, stdout: [], stderr: ["error: aborted"] }`. Because all
   prompting precedes validation, and validation precedes every write, an abort
   is structurally before the first write.
8. A secret is never prompted for. The prompt message for a `*.valueFile` key is
   `<key> (path to a file containing the secret):`; every other key's message is
   `<key>:`.

The merged answers are assembled as answers-file text plus one
`<key>=<value>` line per collected answer, then handed to
`parseSetupAnswers(mergedText, baseDir)` — one validation pass over the union,
so an interactive run and an `--answers` run are validated identically.
`baseDir` is the answers file's directory, or `process.cwd()` when there is no
answers file (passed in by the leaf, not read inside `run-setup.ts`).

### C. Closing output — `src/apps/cli/setup/run-setup.ts`

After the graph step succeeds, append these four lines to `stdout`, in order:

```
project id: <projectId>
readiness: configured=<b> verified=<null|b> operational=<b> ready=<b>
state: configured-with-work | configured-no-work
next: <command>
```

- The readiness values come from
  `await deps.checkProject.execute({ id: projectId, probeRepositories: false, probeProvider: false })`
  — 014's `CheckProjectInput`. **Both probe flags are `false`**: setup already ran
  its own repository probe and provider verification at their steps, and 014's
  provider probe is billable. With both flags false the report's `verified` is
  `null`, which is printed as `verified=null`. Print **only** those four booleans. Never
  print `checks[].detail` and never print the report's `next` field — 014's
  `next.command` may name the daemon, which would break the no-work contract.
- `state` is `configured-with-work` when the project has at least one initiative
  after the graph step (the graph outcome was `create` or a name-matching
  `skip`), otherwise `configured-no-work`.
- `next` for `configured-with-work` is exactly `kanthord run daemon`.
- `next` for `configured-no-work` is exactly
  `kanthord import graph --create --dir <graph-package-dir> --project <projectId>`.
- **In the `configured-no-work` case no line of `stdout` or `stderr` may contain
  the string `run daemon`.** The Proof fails the run if it appears.
- The exit code is `0` for both terminal states regardless of `configured` — the
  readiness line is a diagnostic, not a gate.
- If `checkProject` rejects, print `readiness: unavailable` in place of the
  readiness line and keep `exitCode: 0`; the configuration did happen.

### D. The leaf — new file `src/apps/cli/commands/setup/project.ts`

```ts
export function buildSetupProjectCommand(deps: CliDeps, io: CliIo): Command;
```

Mirrors `src/apps/cli/commands/get/project.ts:8-27`:

- `new Command("project")`
- `.description("Set up a project end to end: repository, credential, AI provider, and an optional graph.")`
- `.configureHelp({ commandUsage: () => "kanthord setup project" })`
- `.option("--answers <file>", "path to an answers file (key=value per line)")`
- `.option("--non-interactive", "never prompt; every answer must come from --answers")`
- `.addHelpText("after", "\nExample:\n  kanthord setup project --answers ./setup.answers --non-interactive\n")`
- `.action(async (opts) => emitResult(await runSetup({ answersPath: opts.answers, nonInteractive: opts.nonInteractive === true }, { ...deps-derived bundle... }), io))`

The leaf builds the `RunSetupDeps` bundle with **arrow wrappers**, never bare
method references:

- `readTextFile: (p) => readFile(p, "utf8")` (`node:fs/promises`)
- `readSecretFile: (p) => readCredentialValue({ valuefile: p, timeoutMs: 180_000 })`
  — imported from `../../credential-input.ts`; the leaf is inside `apps/cli/`, so
  this is the epic's intended path and no `src/app/` module touches it.
- `readGraphPackage: async (dir) => parseGraphPackage(await readGraphPackageDir(dir))`
  — from `../../graph-md/parse.ts`
- `getResource: async (id) => { try { return deps.getResource.execute(id); } catch { return undefined; } }`
  and `findResourcesByName: async (projectId, name) => { try { return [{ id: await deps.findResource.execute({ projectId, name }) }]; } catch { return []; } }`
  — byte-identical to `src/apps/cli/commands/import/graph.ts:68-90`.
- `prompt: deps.setupPrompt`, `stdinIsTty: deps.stdinIsTty`, and the use cases
  straight off `deps` — including EPIC 014's three existing keys
  `checkProject: deps.checkProject`, `repositoryProbe: deps.repositoryProbe` and
  `providerProbe: deps.providerProbe`. Pass the two probe objects **whole**;
  never a bare `deps.repositoryProbe.probe` method reference, which would lose
  `this` and crash on the adapter's `#private` fields.

### E. The group — new file `src/apps/cli/commands/setup.ts`

Copy `src/apps/cli/commands/run.ts:7-19` exactly, substituting `setup`:
`new Command("setup").name("kanthord setup").description("Guided setup commands.").showHelpAfterError()`,
the `preSubcommand` `copyInheritedSettings` hook, then
`command.addCommand(buildSetupProjectCommand(deps, io))`.

### F. Registration — `src/apps/cli/index.ts`

One import in the `L5-34` block and, following the hoisted-const style of
`L45-70`, `const setup = buildSetupCommand(deps, io).name("setup");` plus
`.addCommand(setup)` in the chain at `L72-106`. No `.action(`, `.option(`,
`.requiredOption(` or `.argument(` may appear in `index.ts`.

### G. Leaf counts — `src/apps/cli/architecture.test.ts`

This story adds exactly one leaf file under `commands/setup/` and exactly one
registered leaf. **Increment both `EXPECTED_LEAF_FILE_COUNT` (`:28`) and
`EXPECTED_LEAF_COUNT` (`:33`) by `+1` from whatever values the file holds when
this story runs** — do not hard-code a number; EPICs 011–014 also bump them.
`src/apps/cli/commands/setup.ts` sits directly in `commands/` and
`src/apps/cli/setup/*.ts` is outside `commands/`, so neither affects
`EXPECTED_LEAF_FILE_COUNT`, which scans subdirectories only.

## Constraints

- `CliIo` is not modified.
- Interactive mode never prompts for a secret, only for a path.
- A non-TTY stdin with no `--answers` must **return an error**, not block.
- The closing block must not print 014's `next` field or any check `detail`.
- The readiness call must be read-only. The Proof's Phase H compares the full
  `db status` row-count fingerprint across an identical rerun, so a `checkProject`
  that persists anything would fail it.
- Prompt order and the 3-attempt limit are fixed — no randomness, no
  implementer choice.

## Verify

`src/apps/cli/setup/run-setup.interactive.test.ts` — a scripted `SetupPrompt`
(an array of queued answers plus a recorded list of asked messages), no real
TTY, no `process.stdin`:

- `--non-interactive` with no `--answers` → `exitCode 1`, stderr
  `error: --non-interactive requires --answers <file>`, zero calls on every fake.
- no `--answers`, not `--non-interactive`, `stdinIsTty: false` → `exitCode 1`,
  stderr matching `/not a TTY/`, and the fake prompt records **zero** asks
  (proves it does not hang or read).
- fully interactive happy path: the recorded ask order deep-equals the pinned
  key order for `repository.auth=https-token` + `provider.route=apiKey` +
  `graph.skip=false`, and `exitCode === 0`.
- answers-file precedence: with `project.name` and `repository.name` present in
  the file, neither key appears in the recorded asks.
- relevance: with `repository.auth=ambient` answered, no `credential.*` key is
  asked; with `provider.route=oauth`, `provider.oauthMethod` is asked and
  `provider.valueFile`, `provider.confirmCost`, `provider.baseUrl`,
  `provider.api` are not; with `graph.skip=true`, `graph.packagePath` is not asked.
- re-prompt: an invalid `repository.auth` then a valid one asks
  `repository.auth` twice, prints one `error:` line, and the run succeeds.
- three invalid answers for one key → `exitCode 1`, stderr matching
  `/too many invalid answers/`, zero write calls.
- `ask` resolving `undefined` mid-sequence → `exitCode 1`, stderr `error: aborted`,
  zero write calls.
- the ask message for `credential.valueFile` contains `path` and the recorded
  messages contain no secret; a scripted answer that is a path is never echoed
  back as a value.
- `--non-interactive` with a complete answers file records zero asks.

`src/apps/cli/setup/run-setup.closing.test.ts`:

- with-work: `stdout` ends with the four lines; the `project id:` line contains
  the project id; `readiness:` carries all four booleans from the fake
  `checkProject`; `state: configured-with-work`; `next: kanthord run daemon`.
- no-work (`graph.skip=true`, no initiatives): `state: configured-no-work`,
  `next` contains `import graph`, and **no** line of `stdout` or `stderr`
  contains `run daemon`.
- with-work where the graph step was a name-matching `skip` still reports
  `configured-with-work`.
- a fake `checkProject` whose report carries `next: { command: "kanthord run daemon" }`
  and a check `detail` mentioning the daemon produces **no** `run daemon` in the
  no-work output (proves only the four booleans are printed).
- the recorded `checkProject` input deep-equals
  `{ id: <projectId>, probeRepositories: false, probeProvider: false }`, and a
  report with `verified: null` renders `verified=null`.
- a rejecting `checkProject` yields `readiness: unavailable` and `exitCode 0`.
- `configured: false` still yields `exitCode 0`.

`src/apps/cli/commands/setup/project.test.ts` — leaf-level, `capture()` io in the
style of `src/apps/cli/ai-provider.test.ts:33-49`:

- `--help` first line equals `Usage: kanthord setup project [options]` and the
  help text contains `Example`.
- `--answers ./x --non-interactive` reaches `runSetup` with
  `{ answersPath: "./x", nonInteractive: true }`.
- a `HandlerResult` with `exitCode: 1` sets the captured exit code to 1 and
  writes the stderr lines.

`src/apps/cli/architecture.test.ts`:

- both constants bumped by one; `buildProgram` exposes the new leaf; the leaf has
  a non-empty description and `Usage:` + `Example` in its help; `index.ts` still
  contains none of the four banned substrings.
- `runCli(["setup", "project", "--help"])` first line equals
  `Usage: kanthord setup project [options]`.

- `node --test src/apps/cli/setup/ src/apps/cli/commands/setup/ src/apps/cli/architecture.test.ts`
- `npm run verify` exits 0.
- Proof: Phase F (the closing output names the project id, `run daemon`, and
  `configured-with-work`; no secret in the output) and Phase K
  (`configured-no-work`, `import graph` present, `run daemon` absent). The whole
  Proof depends on this story because it registers the command group — before it,
  every phase fails with an unknown command.

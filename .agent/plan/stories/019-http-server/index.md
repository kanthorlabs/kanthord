# EPIC 019 — HTTP server skeleton — stories

Epic: `.agent/plan/epics/019-http-server.md`
Prereq: EPIC 018 (sequence order).

After this epic `kanthord serve` runs a koa server on `127.0.0.1` that answers
`GET /healthz` with the CLI's own version behind HTTP Basic auth against
`API_KEY`, serves a UI shell at `GET /`, logs JSON through pino, and carries the
route table / envelope / error registry every later HTTP epic extends.

## Dispatch order

`01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09`, strictly sequential. Story 00 is
already done (maintainer).

The file order deviates from the epic's `S1…S9` bullet order in exactly one
place, and every story header names its epic bullet: **03 implements epic bullet
S4 (auth + logger) and 04 implements epic bullet S3 (route table)**. Reason:
`src/apps/http/deps.ts` (`HttpDeps`) imports `HttpLogger` from
`src/apps/http/logger.ts`, so the logger interface must exist before the table.

No two stories are a coupled pair; each ends with `npm run verify` green.

## Stories

- 00 — dependencies + `.env.example` (maintainer, DONE) → `00-dependencies.md`
- 01 — one version constant + `.env` loading (S1) → `01-version-and-env.md`
- 02 — envelope, HTTP error classes, error registry (S2) →
  `02-envelope-and-error-registry.md`
- 03 — Basic auth + `HttpLogger` + `PinoLogger` (S4) → `03-auth-and-logger.md`
- 04 — route table, matcher, decode helpers, `health.get` (S3) →
  `04-route-table.md`
- 05 — the koa app + `startHttpServer` (S5) → `05-koa-app-and-server.md`
- 06 — the UI shell row (S6) → `06-ui-shell.md`
- 07 — the `serve` CLI leaf + composition wiring (S7) → `07-cli-serve-leaf.md`
- 08 — CLI-retirement inventory test (S8) → `08-cli-retirement-inventory.md`
- 09 — the program proof runs green (S9) → `09-program-proof.md`

Planning artefact written by the planner (NOT by `/work` — `.agent/plan/**` is
lane-forbidden to every role): `retirement.md`, the CLI→HTTP migration roadmap
the epic's S8 bullet refers to.

## Facts (needed for implementation)

Greenfield: `src/apps/http/` does not exist. Nothing in `src/` imports `koa`,
`pino`, `@koa/bodyparser`, `@koa/cors` or `supertest` yet.

Dependencies already installed (Story 00, do not touch `package.json`):
`koa@3.2.1`, `pino@10.3.1`, `@koa/bodyparser@6.1.0`, `@koa/cors@5.0.0`;
dev: `supertest@7.2.2`, `@types/koa@3.0.3`, `@types/koa__cors@5.0.1`,
`@types/supertest@7.2.1`. `koa` and `@koa/cors` carry no typings of their own —
the two `@types` packages supply them. Verified on this tree: `import Koa from
"koa"`, `import { bodyParser } from "@koa/bodyparser"`, `import cors from
"@koa/cors"`, `import pino from "pino"`, `import request from "supertest"` all
typecheck under `tsconfig.json` (`module: nodenext`, `verbatimModuleSyntax`,
`strict`), `ctx.request.body` typechecks (bodyparser augments koa's `Request`),
and the whole stack runs under Node 24 direct TS execution.

Import boundaries (`eslint.config.js`): `src/apps/**` is ONE boundaries element
(`apps`), so `src/apps/cli/**` may import `src/apps/http/**` and vice versa —
this is how `src/apps/cli/index.ts:5-38` already imports `./commands/*`.
`apps/` may NOT import `src/domain/**` nor any `src/*/port.ts`. That is why
`src/apps/cli/deps.ts:159-163` re-declares `Logger`, and why
`src/apps/http/logger.ts` declares `HttpLogger` instead of importing
`src/logger/port.ts`. Only `src/composition.ts` and `src/main.ts` may import
concrete adapters such as `src/logger/pino.ts`.

Version today: `src/apps/cli/index.ts:41-45` reads `package.json` inline:

```ts
const packageVersion = (
  JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;
```

used once at `src/apps/cli/index.ts:85` (`.version(packageVersion)`).

CLI leaf wiring: `buildProgram(deps: CliDeps, io: CliIo = processIo): Command` at
`src/apps/cli/index.ts:48`; leaf consts at `:49-78`; `.addCommand(...)` chain at
`:87-118` ending `.addCommand(queue);` on line 118.
`src/apps/cli/architecture.test.ts` enforces three things a new leaf must
respect: `index.ts` contains none of `.action(`, `.option(`, `.requiredOption(`,
`.argument(` (`:41-47`, `:69-78`); `EXPECTED_LEAF_FILE_COUNT = 73`
(`:28`) counts leaf files in `commands/` **subdirectories only**;
`EXPECTED_LEAF_COUNT = 79` (`:40`) counts registered leaves and each leaf's help
must contain `Usage:` and `Example` (`:127-134`).

Leaf idiom to mirror — `src/apps/cli/commands/queue.ts` (27 lines, a top-level
leaf living directly in `commands/`, exactly the shape `serve` needs):
`new Command("queue").description(...).configureHelp({ commandUsage: () =>
"kanthord queue" }).option(...).addHelpText("after", "\nExample:\n  kanthord
queue --json\n").action(async (opts) => { emitResult(await runQueueList(...),
io); })`.

`src/apps/cli/commands/action.ts` (26 lines) is the whole io contract:
`CliResult { exitCode, stdout: string[], stderr: string[] }`,
`CliIo { out(text), err(text), setExitCode(code) }`, `processIo` (writes to the
real streams, `setExitCode` sets `process.exitCode`), and
`emitResult(result, io)` which appends `"\n"` per line.

`CliDeps` (`src/apps/cli/deps.ts:166-290`) is a flat bag with an index signature
(`[key: string]: unknown` at `:168`) and already carries `logger: Logger;` at
`:223`.

`buildDeps(dbPath, opts?)` is `src/composition.ts:184-187`; it builds
`const logger = new StdoutLogger();` at `:293` and returns one flat object
literal at `:1159-1244` (key `logger` at `:1205`).
`src/composition.test.ts:67-113` asserts key presence with
`assert.ok("<key>" in deps, "deps.<key> present")`.

`src/main.ts` (62 lines): EPIPE guard `:9-14`; first `process.env` read is
`const dbPath = process.env.KANTHORD_DB ?? ".data/kanthord.db";` at `:16`;
`buildDeps(...)` at `:59`. No `process.loadEnvFile` anywhere in `src/`.

`toResult` (`src/apps/cli/error-map.ts:100-166`) is one flat `instanceof`
disjunction over ~60 classes returning `{ exitCode: 1, stderr: ["error: …"] }`,
and **re-throws every unlisted error at `:165`** — the reason the HTTP app needs
its own registry plus a `500` fallback.

Domain error classes the registry seeds, both in `src/domain/errors.ts`:
`DuplicateNameError` at `:5` (`constructor(kind, scope, errorName)`),
`UnknownReferenceError` at `:19` (`constructor(kind, id)`).

Test conventions: co-located `*.test.ts`, flat `test(...)` from `node:test` (some
files use `describe`), `import assert from "node:assert/strict"`,
`mkdtempSync(join(tmpdir(), "<prefix>-"))` + `rmSync(dir, { recursive: true,
force: true })` in `finally`, thrown types asserted with
`assert.throws(fn, ErrorClass)` / `await assert.rejects(fn, ErrorClass)`.
Logger output is captured with a hand-rolled object literal
(`src/composition.test.ts:122-127`), never a mocking library. CLI commands are
driven through `runCli(argv, deps)` (`src/apps/cli/commands/run-cli.ts:17-58`),
which strips the trailing newline per captured line. Env vars are never mutated
globally in a spawn test — `src/main.test.ts:29-33` builds
`{ ...process.env, KANTHORD_DB: <temp>, ...overrides }` and passes it to
`spawnSync`. The only in-process env mutation idiom is save/restore in a
`finally` (`src/workspace/local.test.ts:475-489`).

Loopback-listener precedent: `scripts/e2e/mock-openai-completions.mjs:45-55`
(`server.listen(0, "127.0.0.1", …)`, port read from `server.address()`,
`SIGTERM`/`SIGINT` → `server.close`).

The proof script `scripts/e2e/http-serve-proof.sh` is already committed and
already confirmed RED on this tree: `db migrate` passes, then
`serve --port 0` fails with `unknown command 'serve'`.

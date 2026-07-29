# Story 07 — the `serve` CLI leaf + composition wiring

Epic: `.agent/plan/epics/019-http-server.md` (bullet S7)
Depends on: Story 06.

## Change

1. **`src/apps/cli/deps.ts`** — add one field immediately after `logger: Logger;`
   (`:223`):

   ```ts
   import type { HttpLogger } from "../http/logger.ts"; // with the other type imports
   …
     logger: Logger;
     /** Structured JSON logger for `serve`; pino-backed (composition root). */
     httpLogger: HttpLogger;
   ```

   `src/apps/cli/**` importing `src/apps/http/**` is legal: `src/apps` is ONE
   eslint `boundaries` element, which is why `index.ts:5-38` already imports
   `./commands/*`. `npm run lint` is the check.

2. **`src/composition.ts`** — add `import { PinoLogger } from "./logger/pino.ts";`
   beside the other logger imports (`:104-106`) and add one key to the returned
   object literal, immediately after `logger,` (`:1205`):

   ```ts
     logger,
     httpLogger: new PinoLogger(),
   ```

   `composition.ts` is the only module allowed to construct `PinoLogger`.

3. **New file `src/apps/cli/serve.ts`** — the pure, unit-testable part (mirrors
   how `src/apps/cli/queue.ts` holds the logic for `commands/queue.ts`):

   ```ts
   export const DEFAULT_PORT = 4100;

   /** Parse --port. Default 4100; 0 allowed (ephemeral). Throws InvalidPortError. */
   export function parsePort(raw: string | undefined): number;

   export class InvalidPortError extends Error {}
   ```

   `parsePort` rules: `undefined` → `DEFAULT_PORT`; a value matching `/^\d+$/`
   and `<= 65535` → that number (including `0`); anything else (non-numeric,
   negative, `1.5`, `> 65535`) → `InvalidPortError` with message
   `--port must be an integer between 0 and 65535`.

4. **New file `src/apps/cli/commands/serve.ts`** — a top-level leaf living
   directly in `commands/`, shaped like `commands/queue.ts`:

   ```ts
   export function buildServeCommand(deps: CliDeps, io: CliIo): Command;
   ```

   Body:
   - `new Command("serve")`
   - `.description("Serve the kanthord HTTP API and UI on loopback.")`
   - `.configureHelp({ commandUsage: () => "kanthord serve" })`
   - `.option("--port <n>", "port to listen on (0 = ephemeral)", String(DEFAULT_PORT))`
   - `.addHelpText("after", "\nExample:\n  kanthord serve --port 4100\n")`
     (`src/apps/cli/architecture.test.ts:127-134` requires `Usage:` and
     `Example` in every leaf's help)
   - `.action(async (opts: { port?: string }) => { … })` which, in order:
     1. `const port = parsePort(opts.port)` and
        `const apiKey = requireApiKey(process.env["API_KEY"])`, both inside one
        `try`; on `InvalidPortError` or `MissingApiKeyError` call
        `io.err("error: " + err.message + "\n")`, `io.setExitCode(1)` and
        `return` — no listener is opened and nothing is thrown out of the action.
     2. `const httpDeps: HttpDeps = { logger: deps.httpLogger };`
     3. `const app = buildHttpApp(httpDeps, { apiKey });`
     4. `const server = await startHttpServer(app, { port, logger: deps.httpLogger });`
     5. register shutdown ONCE for both signals:
        `const stop = () => { void server.close(); };`
        `process.once("SIGTERM", stop); process.once("SIGINT", stop);`
        This action is the ONLY place in the codebase that attaches process signal
        handlers for the server.
   - The action prints nothing through `io`; the `listening` line comes from
     `PinoLogger` (JSON on stdout), so stdout stays one parseable format.

5. **`src/apps/cli/index.ts`** — add
   `import { buildServeCommand } from "./commands/serve.ts";` to the import block,
   add `const serve = buildServeCommand(deps, io).name("serve");` in the const
   block (`:49-78`), and add `.addCommand(serve)` to the chain, immediately before
   `.addCommand(queue);` on line 118. No `.option(`/`.action(` may appear in
   `index.ts` (`architecture.test.ts:41-47`).

## Constraints

- `requireApiKey` is called with `process.env["API_KEY"]` here and nowhere else in
  `src/apps/http/**`; the HTTP app stays env-free.
- The action must not call `process.exit`. Setting the exit code through `io`
  (`processIo.setExitCode` sets `process.exitCode`) is what makes the failure path
  testable and still gives a non-zero process exit.
- Do not add a `--host` flag. The bind address is fixed at `127.0.0.1`.
- `src/apps/cli/serve.ts` must not import koa, `app.ts` or `server.ts` — it stays
  a pure parser so its tests need no server.

## Verify

- New test `src/apps/cli/serve.test.ts` (`node --test src/apps/cli/serve.test.ts`):
  - `parsePort(undefined)` → `4100`; `parsePort("0")` → `0`;
    `parsePort("4100")` → `4100`; `parsePort("65535")` → `65535`.
  - `parsePort("abc")`, `parsePort("-1")`, `parsePort("1.5")`,
    `parsePort("65536")`, `parsePort("")` each
    `assert.throws(..., InvalidPortError)`.
- New test `src/apps/cli/commands/serve.test.ts`, driven through
  `runCli(["serve", …], deps)` (`src/apps/cli/commands/run-cli.ts:17`) with a
  fake `deps` supplying only `httpLogger` (cast
  `as unknown as CliDeps`, the idiom at `architecture.test.ts:60`). Save and
  restore `process.env["API_KEY"]` in a `finally`, per
  `src/workspace/local.test.ts:475-489`:
  - `API_KEY` deleted → `exitCode` `1`, a stderr line containing `API_KEY`, and
    the fake logger recorded no `listening` line.
  - `API_KEY` = a 15-character value → `exitCode` `1` naming `API_KEY`.
  - `API_KEY` valid + `--port abc` → `exitCode` `1` with a stderr line containing
    `--port`.
  - `API_KEY` valid + `--port 0` → `exitCode` `0`; the fake logger recorded one
    `listening` line whose `port` is a number; a `fetch` to
    `http://127.0.0.1:<that port>/healthz` with a valid `Authorization` header
    returns `200`.

    Shutdown for this test is deterministic and uses no real signal: before
    `runCli`, snapshot `const before = process.listeners("SIGTERM")`; after the
    assertions, compute the listeners the action added
    (`process.listeners("SIGTERM").filter((l) => !before.includes(l))`), assert
    there is exactly one, call it directly, then `process.off("SIGTERM", it)` and
    the same for `SIGINT` — in a `finally`, so a failed assertion still leaves the
    process clean. After calling it, a `fetch` to the same port rejects.
    `process.removeAllListeners` is forbidden: it would delete listeners the test
    runner owns.
- `src/apps/cli/architecture.test.ts`: bump `EXPECTED_LEAF_COUNT` from `79` to
  `80` and extend its doc comment with `019 Story 07 adds the top-level `serve`
leaf, directly in commands/, so EXPECTED_LEAF_FILE_COUNT (73) is unchanged`.
  `EXPECTED_LEAF_FILE_COUNT` must NOT change. The suite's help test then also
  covers `serve`'s `Usage:`/`Example`.
- `src/composition.test.ts`: add `assert.ok("httpLogger" in deps, "deps.httpLogger
present")` to the structural test at `:67-113`.
- `node src/main.ts commands | grep -c "^kanthord serve"` prints `1`.
- `npm run verify` exits 0.
- Proof: delivers phase A (`serve --port 0` starting and logging `listening`),
  phase G (`API_KEY` unset → non-zero exit) and phase H (`SIGTERM` shutdown).

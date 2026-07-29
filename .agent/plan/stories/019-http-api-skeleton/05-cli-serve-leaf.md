# Story 05 — the `serve` CLI leaf

Epic: `.agent/plan/epics/019-http-api-skeleton.md`
Depends on: Story 04.

## Change

### 1. `CliDeps` carries the database path

- `src/apps/cli/deps.ts` — add `dbPath: string;` to the `CliDeps` interface
  (declared `:166-290`), immediately before `stdinIsTty: boolean;` at `:289`, with
  the comment `/** The SQLite file path; the HTTP key file sits beside it. */`.
- `src/composition.ts` — add `dbPath,` to the returned object literal
  (`:1159-1244`), immediately before `stdinIsTty: process.stdin.isTTY === true,`
  at `:1243`. `dbPath` is already the function's first parameter (`:185`), so this
  is a shorthand property.

Reason: `apps/` must not read `process.env`; `main.ts:16` already owns the env
read and passes the path to `buildDeps`.

### 2. New handler `src/apps/cli/serve.ts`

```ts
import { dirname, join } from "node:path";
import { buildServer } from "../http/server.ts";
import type { CliDeps } from "./deps.ts";
import type { CliIo } from "./commands/action.ts";

export async function runServe(
  args: Record<string, unknown>,
  deps: CliDeps,
  io: CliIo,
): Promise<void>;
```

Pinned behaviour:

1. Parse `args["port"]`: `String(args["port"] ?? "4100")` must match `/^\d+$/`
   and be `<= 65535`, else write
   `error: --port must be an integer between 0 and 65535` via `io.err` (with a
   trailing newline), `io.setExitCode(1)`, and return.
2. `const keyPath = join(dirname(deps.dbPath), "http-key");`
3. `const server = await buildServer(deps, { port, keyPath, logError });` — a
   throw (e.g. `KeyPermissionsError`, `EADDRINUSE`) is caught and written as
   `error: ${err.message}` via `io.err` with `io.setExitCode(1)`, then return.
4. **`io.out(\`${server.port}\n\`)` — the bound port alone on the first stdout
   line.** Binding: nothing may be printed before it;
   `scripts/e2e/http-api-proof.sh:76` reads line 1 and strips non-digits.
   Then `io.out(\`kanthord api listening on http://127.0.0.1:${server.port}\n\`)`
   as the second line.
5. Await a promise that resolves when `SIGTERM` **or** `SIGINT` fires; the handler
   calls `await server.close()` then resolves. Register with `process.once` for
   both signals and remove **both** listeners in a `finally`, mirroring
   `src/apps/cli/commands/list/event.ts:34-58`. `io.setExitCode(0)`.

`logError` is `(requestId, err) => io.err(\`error: request ${requestId} failed: ${String(err)}\n\`)`.

Binding: `runServe` calls `io.out` directly and never uses `emitResult` — the
port line must appear before the process blocks. No other command in the tree
does this (`src/apps/cli/commands/action.ts:22-26` buffers), so do not look for a
helper.

### 3. New leaf `src/apps/cli/commands/serve.ts`

Mirror `src/apps/cli/commands/queue.ts` exactly (a top-level leaf, directly in
`commands/`, not a subdirectory):

```ts
export function buildServeCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("serve")
    .description("Serve the kanthord REST API on loopback.")
    .configureHelp({ commandUsage: () => "kanthord serve" })
    .option("--port <n>", "port to listen on (0 picks a free port)", "4100")
    .addHelpText("after", "\nExample:\n  kanthord serve --port 4100\n")
    .action(async (opts: { port: string }) => {
      await runServe({ port: opts.port }, deps, io);
    });
}
```

### 4. Wire it in `src/apps/cli/index.ts`

- Add `import { buildServeCommand } from "./commands/serve.ts";` in the import
  block (ends `:38`).
- Add `const serve = buildServeCommand(deps, io).name("serve");` after `:78`.
- Change `:118` from `.addCommand(queue);` to `.addCommand(queue)` and append
  `.addCommand(serve);`.

**Binding: `index.ts` must not gain `.action(` / `.option(` / `.requiredOption(` /
`.argument(`** — `src/apps/cli/architecture.test.ts:47-52,68-76` scans the raw
source for those strings.

## Constraints

- Do not change `EXPECTED_LEAF_FILE_COUNT` (`architecture.test.ts:28`) — it scans
  `commands/` **subdirectories** only, and `serve.ts` lives directly in
  `commands/`, like `queue.ts`.
- `buildServeCommand` must not touch `deps` at build time —
  `architecture.test.ts:60` builds the tree with `{} as unknown as CliDeps`.
- Surgical: no other `deps.ts` / `composition.ts` field is added or reordered.

## Verify

Test-engineer edit to the existing `src/apps/cli/architecture.test.ts`:

- Bump `EXPECTED_LEAF_COUNT` from `79` to `80` (`:44`) and extend the doc comment
  above it with `019 Story 5 adds \`serve\` as a new top-level leaf, directly in
  commands/, so EXPECTED_LEAF_FILE_COUNT stays 73`.
- The existing suite then proves, with no new test: `serve` has a non-empty
  description, its help contains `Usage:` and `Example`, and `index.ts` still
  contains no banned method.

New test file `src/apps/cli/commands/serve.test.ts`,
`describe("src/apps/cli/commands/serve.ts")`, using the local `capture()` idiom
from `src/apps/cli/commands/read.test.ts:8-26`:

- `--port abc` → exit code 1, one `err` line equal to
  `"error: --port must be an integer between 0 and 65535\n"`, and no server is
  started (assert `out` is empty).
- `--port 70000` → the same failure.
- `--port 0` against a temp `dbPath` → the FIRST `out` entry is a digit-only
  string whose numeric value is `> 0`, the second contains
  `listening on http://127.0.0.1:`, the key file exists at
  `join(dirname(dbPath), "http-key")`, and the command exits 0 after
  `process.emit("SIGTERM")`. Drive the shutdown by emitting the signal once the
  first `out` line has arrived, and `await` the action promise.
- After shutdown, both signal listener counts are back to their pre-test values
  (`process.listenerCount("SIGTERM")` and `"SIGINT"`), mirroring the guard at
  `src/apps/cli/commands/read.test.ts:493-529`.

Existing suites that must stay green unchanged: `src/apps/cli/index.test.ts`
(root help), `src/composition.test.ts` (the new `dbPath` field must not break
`buildDeps`).

Commands:

- `node --test src/apps/cli/commands/serve.test.ts src/apps/cli/architecture.test.ts src/composition.test.ts` exits 0.
- `node src/main.ts serve --help` prints a usage line and an `Example` block.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-api-proof.sh` phase A (the port line and the key file)
  and phase H (`SIGTERM` shutdown).

# Story 02 — D4: secret input off argv

Epic: `.agent/plan/epics/007.1-e2e-hardening.md`

## Goal

`create credential` stops accepting `--value` on the command line. Interactive
TTY sessions get a hidden prompt (raw mode, restore in `finally`). Automation
gets `--value-file <path>` (or `--value-file -` for stdin). A `--value-timeout
<duration>` flag (default 3 minutes) ensures the CLI always terminates — never
hangs waiting for input that never arrives.

The `Credential.value` field continues to exist in the domain; what changes is
how the CLI reads it off the user. Value is never logged, never included in
error messages, never returned in `stdout`.

## Locked contracts (exact names — tests assert verbatim)

```ts
// src/apps/cli/credential-input.ts  (new module, CLI layer only)

/**
 * Read a credential value from the appropriate source:
 * - if valuefile === "-": read all of stdin until EOF
 * - if valuefile is a path: read that file until EOF
 * - if tty is provided (interactive): prompt via hidden raw-mode TTY
 *
 * Newline contract: strip ONE trailing LF or CRLF; reject empty;
 * preserve all other bytes.
 *
 * On timeout: throw CredentialReadTimeoutError.
 * Sources are mutually exclusive (valuefile and tty cannot both be set).
 */
export async function readCredentialValue(opts: {
  valuefile?: string; // path or "-"
  tty?: NodeJS.ReadStream; // provided only when isatty(stdin)
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<string>;

export class CredentialReadTimeoutError extends Error {
  constructor(timeoutMs: number); // name = "CredentialReadTimeoutError"
}

export class EmptyCredentialError extends Error {
  constructor(); // name = "EmptyCredentialError"
}
```

```ts
// src/apps/cli/resource.ts — updated runCreateCredential signature
// - accepts "value-file" in args (path or "-")
// - does NOT accept "value" in args (removed)
// - calls readCredentialValue() and passes the result to addResource.execute
// - on CredentialReadTimeoutError: exitCode 1, stderr message, NEVER hangs
// - value never appears in stdout or stderr of the returned HandlerResult
export async function runCreateCredential(
  args: Record<string, unknown>,
  addResource: AddResource,
  io: { tty?: NodeJS.ReadStream; timeoutMs?: number },
): Promise<HandlerResult>;
```

## Constraints

- `readCredentialValue` is a CLI-layer module (`src/apps/cli/`). Domain and app
  layers (`src/domain/`, `src/app/`) do not change for D4. `Credential.value`
  remains a `string` in the domain.
- Raw TTY mode: call `process.stdin.setRawMode(true)` only when `opts.tty` is
  provided and the stream supports it. Always restore in a `finally` block even
  if an error is thrown, even if `setRawMode` threw.
- `--value-file -` reads from stdin. This is the only implicit stdin path. No
  `--value-env` escape hatch.
- `--value-timeout` parses `<number>s`, `<number>m`, `<number>ms` (e.g. `3m`,
  `30s`, `500ms`). Invalid format → exitCode 1 before attempting to read.
  Default: 3 minutes (180 000 ms).
- Sources are mutually exclusive: if both `--value-file` and a TTY are present,
  `--value-file` wins (automated pipelines run without a TTY; the flag is the
  explicit override).
- The `--value` flag is removed from the `"create credential"` COMMANDS entry.
  Passing `--value` via the CLI now produces an "unknown option" parse error
  (strict mode already in place).

## Verification Gate

`node --test src/apps/cli/credential-input.test.ts` green; `npm run typecheck`
exit 0; `npm run lint` clean. Tests do NOT use a real TTY (mock `tty`); they
test `--value-file` and `--value-file -` with real temp files and piped
`Readable` streams.

---

### Task T1 — `readCredentialValue` + timeout + newline contract (no TTY path)

**Requires:** nothing beyond `src/apps/cli/`.

**Input:** `src/apps/cli/credential-input.ts` (new), `src/apps/cli/credential-input.test.ts` (new).

**Action — RED:** tests: (a) `readCredentialValue({ valuefile: "/tmp/f", timeoutMs: 5000 })`
where `/tmp/f` contains `"sk-abc\n"` returns `"sk-abc"` (trailing newline stripped);
(b) file contains `"sk-abc\r\n"` returns `"sk-abc"` (CRLF stripped); (c) file
contains only `"\n"` throws `EmptyCredentialError`; (d) file is empty throws
`EmptyCredentialError`; (e) file contains `"sk\nabc"` returns `"sk\nabc"` (internal
newline preserved — only ONE trailing stripped); (f) `valuefile: "-"` with a
`Readable` that emits `"sk-from-stdin"` + EOF returns `"sk-from-stdin"`;
(g) timeout: `valuefile: "-"` with a `Readable` that never emits + `timeoutMs: 50`
throws `CredentialReadTimeoutError`; test asserts the error message contains the
timeout duration. Fails today: module does not exist.

**Action — GREEN:** create `src/apps/cli/credential-input.ts`. Implement
`readCredentialValue` for the `valuefile` path only (TTY path in T2). For `-`:
wrap stdin in a `Promise` that resolves on `'end'` or rejects on `'error'`;
race against `setTimeout(reject, opts.timeoutMs)`. For a file path: `readFile`
raced against the same timeout. Apply newline contract: strip ONE trailing `\n`
or `\r\n`; throw `EmptyCredentialError` if result is empty. Export
`CredentialReadTimeoutError` and `EmptyCredentialError`.

**Action — REFACTOR:** extract `stripTrailingNewline(buf: Buffer): string` helper.

**Output:** `readCredentialValue` works for `valuefile` source; timeout always
terminates; newline contract enforced.

**Verify:** `node --test src/apps/cli/credential-input.test.ts` green;
`npm run typecheck` 0.

---

### Task T2 — hidden TTY reader (raw mode, restore in `finally`)

**Requires:** T1.

**Input:** `src/apps/cli/credential-input.ts`, `src/apps/cli/credential-input.test.ts`.

**Action — RED:** tests using a mock TTY stream (a `PassThrough` with
`isTTY = true` and a stub `setRawMode`): (a) `readCredentialValue({ tty: mockTty, timeoutMs: 5000 })`
resolves with `"sk-tty"` when the mock emits `"sk-tty\n"` then ends; (b) if
`setRawMode` throws, the rejection propagates AND `setRawMode(false)` is still
called (restore-in-finally — verified via the stub call count); (c) timeout
applies the same as for `valuefile`. Fails today: TTY path not implemented.

**Action — GREEN:** add the TTY branch to `readCredentialValue`. When `opts.tty`
is provided: call `opts.tty.setRawMode(true)` in a try-block; collect chars
(hide echo by not writing them back) until newline; call `opts.tty.setRawMode(false)`
in `finally`. Race against `setTimeout(reject, opts.timeoutMs)`. Apply the
same newline contract.

**Action — REFACTOR:** none.

**Output:** TTY path restores raw mode in all exit paths.

**Verify:** suite green; `npm run typecheck` 0.

---

### Task T3 — `runCreateCredential` uses `--value-file`; removes `--value`

**Requires:** T1, T2.

**Input:** `src/apps/cli/resource.ts`, `src/apps/cli/router.ts`,
`src/apps/cli/credential-input.test.ts` (add integration-style handler tests).

**Action — RED:** tests: (a) calling the `"create credential"` CLI with
`--value sk-plaintext` (as a raw argv string) returns exitCode 1 with "unknown
option" in stderr (strict parse rejects it); (b) calling with
`--value-file <temp-file>` where the file holds `"sk-ok\n"` returns exitCode 0
and stdout contains an id; (c) `stdout` does NOT contain `"sk-ok"`; (d) stderr
does NOT contain `"sk-ok"`; (e) calling with `--value-file -` and stdin piped to
an empty `Readable` + `--value-timeout 50ms` returns exitCode 1 with a message
containing "timeout". Fails today: `runCreateCredential` reads `--value` from args.

**Action — GREEN:** update `runCreateCredential` signature to accept `io: { tty?:
NodeJS.ReadStream; timeoutMs?: number }`. Parse `--value-timeout` from args (if
present). Call `readCredentialValue({ valuefile: args["value-file"], tty: io.tty,
timeoutMs })` and pass the resolved value to `addResource.execute`. On
`CredentialReadTimeoutError` or `EmptyCredentialError`, return exitCode 1 with a
clear message (no value in the message). Remove the `value` flag from the function
body and from the `"create credential"` COMMANDS entry in `router.ts`; add
`value-file` and `value-timeout` flags.

**Action — REFACTOR:** none.

**Output:** `--value` is gone from the CLI; `--value-file` is the automation
path; timeout always terminates; value never in results.

**Verify:** handler tests green; `npm run typecheck` 0; `npm run lint` clean.

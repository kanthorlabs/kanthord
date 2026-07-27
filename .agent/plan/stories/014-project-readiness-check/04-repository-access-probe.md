# Story 4 — repository access probe (`git ls-remote`) behind a port

Epic: `.agent/plan/epics/014-project-readiness-check.md`

## Change

### 1. New file `src/domain/redact.ts` — extract the ONE existing redactor

The only value-based credential redactor in `src` is an unexported inline closure,
`src/agent-runner/pi.ts:455-456`:

```ts
// Build redactor: replaces all occurrences of the credential value with ***
const redact = (s: string): string =>
  provider.value ? s.split(provider.value).join("***") : s;
```

Move that logic verbatim into a shared module — same algorithm, same `***`
placeholder:

```ts
// src/domain/redact.ts — EPIC 014 Story 4
// Extracted from the inline closure at agent-runner/pi.ts:455-456 so the
// repository and provider probes redact through the same path.

/** Replaces every occurrence of `secret` with `***`. A null/empty secret is a no-op. */
export function makeRedactor(
  secret: string | null | undefined,
): (s: string) => string {
  return (s: string): string =>
    secret !== null && secret !== undefined && secret !== ""
      ? s.split(secret).join("***")
      : s;
}
```

### 2. `src/agent-runner/pi.ts:455-456` — rewire, do not duplicate

Replace the two-line closure with `const redact = makeRedactor(provider.value);`
and add the import. Every existing call site (`pi.ts:480`, `:610`, `:661`, `:666`)
stays untouched.

### 3. `src/publication/git.ts:49` — export `buildGitEnv`

Add the `export` keyword to `async function buildGitEnv(` (line 49). Nothing else
in that file changes. The probe reuses it so there is exactly one sanitised-git-env
builder (it strips `GIT_TRACE*`/`GIT_CURL_VERBOSE`, sets `GIT_TERMINAL_PROMPT=0`,
and wires a chmod-600 askpass for `https-token`).

### 4. New file `src/repository-probe/port.ts`

```ts
// src/repository-probe/port.ts — EPIC 014 Story 4
import type { RepositoryAuth } from "../domain/resource.ts";

/** Timeout for one probe. A timeout is a `failed` result, never a hang. */
export const REPOSITORY_PROBE_TIMEOUT_MS = 10_000;

export interface RepositoryProbeInput {
  remoteUrl: string;
  branch: string;
  auth: RepositoryAuth;
}

export interface RepositoryProbeResult {
  status: "ok" | "failed";
  /** One line, already redacted, at most 300 characters. */
  detail: string;
}

/** Read-only remote reachability + branch presence. Never clones, never writes. */
export interface RepositoryProbe {
  probe(input: RepositoryProbeInput): Promise<RepositoryProbeResult>;
}
```

### 5. New file `src/repository-probe/git.ts`

```ts
export class GitRepositoryProbe implements RepositoryProbe {
  constructor(
    resolveCredential?: (credentialId: string) => Promise<string>,
    run?: (
      args: string[],
      opts: { env: Record<string, string>; timeout: number },
    ) => Promise<{ stdout: string; stderr: string }>,
  );
  probe(input: RepositoryProbeInput): Promise<RepositoryProbeResult>;
}
```

`run` defaults to `promisify(execFile)` bound to `"git"` — mirror
`src/publication/git.ts:93-99`'s `gitOut`, but pass `timeout` (no existing git
call site does, `grep -n "timeout" src/**/git.ts` → nothing).

`probe` body, pinned:

1. `const { env, cleanup } = await buildGitEnv(input.auth, this.#resolveCredential);`
   inside a `try`, with `cleanup()` in a `finally`.
2. Build the redactor from the resolved token: when
   `input.auth.kind === "https-token"` and `resolveCredential` is present,
   resolve the value and `makeRedactor(value)`; otherwise `makeRedactor(null)`.
3. Run exactly
   `["ls-remote", "--heads", input.remoteUrl, `refs/heads/${input.branch}`]`
   with `{ env, timeout: REPOSITORY_PROBE_TIMEOUT_MS }`. **No `cwd` option** — the
   repository's `--path` may not exist, and passing it would make `execFile`
   fail with `ENOENT` for a perfectly reachable remote.
4. On success, branch presence is `stdout.includes(`refs/heads/${input.branch}`)`:
   - present → `{ status: "ok", detail: `refs/heads/${input.branch} present on remote` }`
   - absent → `{ status: "failed", detail: `branch "${input.branch}" not found on remote` }`
     (the branch name must appear literally in `detail` — Proof phase G2 asserts
     the detail contains `nope`).
5. On throw → `{ status: "failed", detail: firstLine }` where `firstLine` is
   `redact(String(err.stderr ?? err.message ?? err)).split("\n")[0].trim()`
   truncated to 300 characters. When `err.killed === true` or
   `err.signal === "SIGTERM"`, the detail is instead
   `` `probe timed out after ${REPOSITORY_PROBE_TIMEOUT_MS}ms` ``.

### 6. `src/apps/cli/deps.ts` — a LOCAL structural mirror, never the port type

`apps/` may depend on `app/` only, never a capability port and never `domain/`.
`eslint-plugin-boundaries` enforces it (`eslint.config.js:8,21,39`;
`"boundaries/dependencies"` with `default: "disallow"`), and
`src/apps/cli/deps.ts:63-78` documents the required workaround with
`CliWorkspaceManager` as the precedent (`CliRepositoryLanding` just below it is a
second one, and `src/apps/cli/resource.ts:14-17` mirrors a domain union the same
way). So `import type { RepositoryProbe }` in `deps.ts` is a lint error — declare
a mirror instead, next to `CliRepositoryLanding`:

```ts
/**
 * Minimal structural surface of the repository-probe capability that the CLI
 * bundle exposes. Declared locally (rather than importing `RepositoryProbe` from
 * `repository-probe/port.ts`) so this `apps/` module honors the architecture
 * boundary: `apps/` may depend on `app/` only, never a capability port type. The
 * concrete `GitRepositoryProbe` (an adapter) remains structurally assignable to
 * this shape, so `composition.ts` can return it as part of `CliDeps`. Mirrors the
 * `CliWorkspaceManager` pattern above. The `auth` union is inlined for the same
 * reason `resource.ts:14-17` inlines `ResourceType`: `RepositoryAuth` lives in
 * `domain/`. `REPOSITORY_PROBE_TIMEOUT_MS` stays owned by the port and is not
 * mirrored — nothing in `apps/` reads it.
 */
export interface CliRepositoryProbe {
  probe(input: {
    remoteUrl: string;
    branch: string;
    auth:
      | { kind: "ambient" }
      | { kind: "https-token"; credentialId: string }
      | { kind: "ssh-agent" };
  }): Promise<{ status: "ok" | "failed"; detail: string }>;
}
```

Then add `repositoryProbe: CliRepositoryProbe;` to the `CliDeps` interface
(`src/apps/cli/deps.ts:131`). The mirror's shape is a consumed contract — EPIC 015
reads it — so keep it exactly `probe({remoteUrl, branch, auth})` →
`{status, detail}`, never throwing.

### 7. `src/composition.ts` — construct only (no CLI wiring in this story)

Beside `const publisher = ...`, add
`const repositoryProbe = new GitRepositoryProbe(resolveCredential);` reusing the
existing `resolveCredential` closure at `src/composition.ts:600-606`, and expose
`repositoryProbe,` in the returned bundle (`src/composition.ts:850-920`).
`composition.ts` keeps the concrete adapter and the real port type — only `deps.ts`
uses the mirror. Nothing calls it until Story 6.

## Constraints

- **Never clone, never fetch, never write.** `ls-remote` only. Do not touch the
  repository's `path`, do not create it, do not `cwd` into it.
- The probe must not run at all unless the caller asks: this story adds no CLI
  flag and no call site. Proof phase F (a `git` shim earlier in `PATH` that logs
  and exits 42) passes because nothing on the default path constructs a git
  child. `GitRepositoryProbe`'s constructor must therefore spawn nothing — all
  work happens inside `probe()`.
- `timeout` must be passed on every invocation. A hung remote is a `failed`
  result within `REPOSITORY_PROBE_TIMEOUT_MS`, never a hang.
- Every `detail` passes through `makeRedactor` before it is returned. No raw
  stderr ever reaches a report or a log.
- Do not write a second redactor and do not write a second git-env builder — the
  whole point of edits 1-3 is that there stays exactly one of each.
- **`src/apps/cli/deps.ts` must not import from `src/repository-probe/` or from
  `src/domain/`.** The mirror is structural only. `GitRepositoryProbe` must stay
  assignable to `CliRepositoryProbe` without a cast in `composition.ts` — if a cast
  becomes necessary, the mirror has drifted from the port and the mirror is what
  must be corrected.
- `REPOSITORY_PROBE_TIMEOUT_MS` is exported from `src/repository-probe/port.ts`
  only. Do not duplicate the number in `apps/`.
- `src/agent-runner/pi.test.ts` must pass unchanged after the `pi.ts` rewire; that
  file's redaction tests (`:1102`, `:1129`, `:1220`) are the regression guard.

## Verify

- `node --test src/domain/redact.test.ts` — new file:
  - `makeRedactor("sk-test")("sk-test is invalid") === "*** is invalid"`;
    two occurrences both replaced.
  - `makeRedactor(null)`, `makeRedactor(undefined)`, `makeRedactor("")` return the
    input unchanged.
  - a secret containing regex metacharacters (`a.*b`) is replaced literally, not
    as a pattern.
- `node --test src/repository-probe/git.test.ts` — new file, hermetic via the
  injected `run` (no real git):
  - `run` is called exactly once with
    `["ls-remote", "--heads", "<url>", "refs/heads/main"]` and with
    `opts.timeout === REPOSITORY_PROBE_TIMEOUT_MS`, and `opts` has **no** `cwd`
    key.
  - stdout containing `<oid>\trefs/heads/main` → `status: "ok"`.
  - stdout empty (remote answered, branch absent) → `status: "failed"` and
    `detail` contains the branch name.
  - `run` rejecting with `{ stderr: "fatal: repository not found\n" }` →
    `status: "failed"`, `detail === "fatal: repository not found"` (first line,
    trimmed).
  - `run` rejecting with `{ killed: true, signal: "SIGTERM" }` →
    `status: "failed"` and `detail` contains `timed out`.
  - `https-token` auth with a `resolveCredential` returning `"sk-secret"` and a
    `run` rejection whose stderr contains `sk-secret` → `detail` does not contain
    `sk-secret` and does contain `***`.
  - a 5000-character stderr → `detail.length <= 300`.
- `node --test src/agent-runner/pi.test.ts` — unchanged, must stay green
  (redaction regression guard for the `pi.ts:455` rewire).
- `node --test src/publication/git.test.ts` — unchanged, must stay green (the
  `export` keyword on `buildGitEnv` changes no behaviour).
- `npx eslint src/apps/cli/deps.ts src/repository-probe` — clean. A
  `boundaries/dependencies` error here means `deps.ts` imported the port instead of
  mirroring it.
- `npm run verify` exits 0 — `tsc --noEmit` is what proves `GitRepositoryProbe` is
  assignable to `CliRepositoryProbe` (composition returns the adapter as that
  field, with no cast), and `npm run lint` is what proves the boundary holds.
- Proof: `G ok` and `F ok` (with Story 6). This story provides the probe; Story 6
  provides the `--probe-repositories` flag that reaches it.

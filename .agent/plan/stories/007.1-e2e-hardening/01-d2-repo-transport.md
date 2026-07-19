# Story 01 — D2: repository transport identity + secure git

Epic: `.agent/plan/epics/007.1-e2e-hardening.md`

## Goal

`Repository` grows a clean `remoteUrl` + `auth` union in place of the
hardcoded `organization` field. `LocalWorkspaceManager` derives the remote
from `repo.remoteUrl` directly and injects credentials via `GIT_ASKPASS`
rather than embedding tokens in URLs. The `buildRemoteUrl` + `organization`
path is removed. A migration 7 column carries the new shape in SQLite.

This is the **foundation** for D1 (typed update) and C2/D5 (landing + fetch)
— both consume `remoteUrl` + `auth`.

## Locked contracts (exact names — tests assert verbatim)

```ts
// src/domain/resource.ts — replaces the old Repository shape

export type RepositoryAuth =
  | { kind: "ambient" }
  | { kind: "https-token"; credentialId: string }
  | { kind: "ssh-agent" };

export interface Repository extends Entity {
  type: "repository";
  name: string;
  remoteUrl: string; // was: organization (computed via buildRemoteUrl)
  branch: string;
  path: string;
  auth: RepositoryAuth; // new field; migration default = { kind: "ambient" }
}

// validation error thrown by newRepository / AddResource when remoteUrl
// carries embedded userinfo or a token in the URL authority:
export class EmbeddedCredentialError extends Error {
  readonly field: "remoteUrl";
  constructor(url: string); // name = "EmbeddedCredentialError"
}
```

```ts
// src/app/resource/add-resource.ts — updated input variant
type AddResourceInput =
  | {
      type: "repository";
      projectId: string;
      name: string;
      remoteUrl: string;
      branch: string;
      path: string;
      auth: RepositoryAuth;
    }
  | /* other variants unchanged */ …
```

```ts
// src/workspace/port.ts — GIT_ASKPASS helper type (internal, used by local.ts)
// The actual GIT_ASKPASS mechanism is entirely inside LocalWorkspaceManager;
// the port interface (WorkspaceManager) is unchanged.

// src/workspace/local.ts — public surface changes:
// - defaultBuildRemoteUrl() and LocalWorkspaceManagerOptions.buildRemoteUrl
//   are REMOVED.
// - LocalWorkspaceManager now reads repo.remoteUrl directly.
// - clone/fetch inject credentials via GIT_ASKPASS + a temp askpass program
//   (never in URL, never in argv, never in config, never in script source).
// - Secure env contract: GIT_TERMINAL_PROMPT=0, credential.helper='',
//   strip GIT_TRACE* and GIT_CURL_VERBOSE from the child env.
// - rejects remoteUrl with embedded userinfo at create time (EmbeddedCredentialError).
```

```ts
// src/storage/sqlite/migrations.ts — migration 7 schema change
// version 7, name: "epic-007.1-e2e-hardening"
// ALTER TABLE resources ADD COLUMN remoteUrl TEXT;
// ALTER TABLE resources ADD COLUMN authKind TEXT DEFAULT 'ambient';
// ALTER TABLE resources ADD COLUMN authCredentialId TEXT;
// (existing rows: remoteUrl derived from org+name GitHub URL, authKind='ambient')
```

## Constraints

- `src/domain/resource.ts` imports nothing outside `src/domain/`. The
  `EmbeddedCredentialError` check (userinfo in URL) is a pure string test —
  no `URL` constructor allowed to throw.
- `src/app/resource/add-resource.ts` imports `domain/` and `storage/port.ts`
  only. No workspace code in the use case.
- `LocalWorkspaceManager` (`src/workspace/local.ts`) is the **only** place
  that builds the `GIT_ASKPASS` environment. The askpass program is a **static
  non-secret** shell one-liner that echoes nothing (ambient) or reads the token
  from a temp file readable only by the current user. The token is written to
  that file, never passed on the command line.
- `execFile` (no shell) is already used and must stay. No `exec`, no
  `spawnSync` with `shell: true`.
- `organization` is removed from the domain type and `AddResourceInput`.
  The CLI flag `--organization` is replaced by `--remote-url`, `--auth`, and
  `--credential`. The migration converts existing rows where possible.
- SSH path: `auth.kind === "ssh-agent"` sets a clean remote and relies on the
  ambient agent. No managed key injection this epic.
- `isRepository` type guard is updated to match the new interface.

## Verification Gate

`node --test src/domain/resource.test.ts` and
`node --test src/workspace/local.test.ts` green; `npm run typecheck` exit 0;
`npm run lint` clean. The workspace tests run real `git` in temp dirs (no
network required — `file://` remotes).

---

### Task T1 — domain: `RepositoryAuth` union + `EmbeddedCredentialError` + new `Repository` shape

**Requires:** nothing beyond `src/domain/`.

**Input:** `src/domain/resource.ts`, `src/domain/resource.test.ts`.

**Action — RED:** tests: (a) `EmbeddedCredentialError` is thrown when a
`Repository` is created with `remoteUrl = "https://x-access-token:sk@github.com/o/r.git"`
(userinfo present); (b) a clean `https://github.com/o/r.git` is accepted; (c)
`RepositoryAuth` union variants round-trip through `isRepository`; (d)
`organization` is absent from the new type (typecheck-level — compile test).
Fails today: type has `organization`, no `remoteUrl`, no `EmbeddedCredentialError`.

**Action — GREEN:** replace `organization: string` with `remoteUrl: string` and
`auth: RepositoryAuth` on `Repository`. Add `EmbeddedCredentialError`. Add a
`parseRemoteUrl` guard used in `buildResource` (the existing generic builder)
to reject embedded userinfo: check for `@` before the host in the URL authority
component (simple string parse, no `new URL()`). Update `buildResource` for the
`"repository"` branch. Export `RepositoryAuth` and `EmbeddedCredentialError`.

**Action — REFACTOR:** none.

**Output:** `Repository` shape matches the locked contract; `EmbeddedCredentialError`
is thrown on embedded credentials. `organization` is gone.

**Verify:** `node --test src/domain/resource.test.ts` green; `npm run typecheck` 0.

---

### Task T2 — app: `AddResourceInput` repository variant uses `remoteUrl` + `auth`

**Requires:** T1.

**Input:** `src/app/resource/add-resource.ts`,
`src/app/resource/add-resource.test.ts`.

**Action — RED:** tests: (a) `AddResource.execute` with
`{ type: "repository", remoteUrl: "https://github.com/o/r.git", branch: "main", path: "", auth: { kind: "ambient" }, … }`
stores the resource and returns an id; (b) a call with
`{ type: "repository", organization: "o", … }` (old shape) fails at the
TypeScript level (compile test, or runtime `organization` key absent from
the input union). Fails today: input union still has `organization`.

**Action — GREEN:** update the `"repository"` variant of `AddResourceInput` to
`{ remoteUrl: string; branch: string; path: string; auth: RepositoryAuth }`.
Remove `organization`. Update the body of `execute` for the repository branch:
derive `path` from `remoteUrl` hostname+path when `input.path === ""` (replace
the `organization`-based join with a URL-slug join), construct the `Repository`
with `remoteUrl` + `auth`.

**Action — REFACTOR:** none.

**Output:** `AddResource` accepts and stores the new repository shape.

**Verify:** `node --test src/app/resource/add-resource.test.ts` green;
`npm run typecheck` 0.

---

### Task T3 — migration 7: reshape `resources` table columns

**Requires:** T1, T2.

**Input:** `src/storage/sqlite/migrations.ts`, `src/storage/sqlite/migrations.test.ts`
(if it exists; otherwise create it), any SQLite adapter that reads `organization`
from `resources.attributes`.

**Action — RED:** a test that: opens a fresh DB, runs migration 6, inserts a
repository resource with `organization + name` in attributes, then runs migration
7, and asserts the row now has `remoteUrl` (derived as `https://github.com/<org>/<name>.git`)
and `authKind = 'ambient'`. Also: running migration 7 on a DB that already has it
is idempotent (version guard prevents double-apply). Fails today: migration 7 does
not exist.

**Action — GREEN:** append migration 7 (`name: "epic-007.1-e2e-hardening"`) to
`MIGRATIONS`. DDL: `ALTER TABLE resources ADD COLUMN remoteUrl TEXT;`,
`ALTER TABLE resources ADD COLUMN authKind TEXT DEFAULT 'ambient';`,
`ALTER TABLE resources ADD COLUMN authCredentialId TEXT;`. Data step: for each
`resources` row where `type = 'repository'`, extract `organization` and `name`
from `attributes` JSON, set `remoteUrl = 'https://github.com/' || org || '/' || name || '.git'`
and `authKind = 'ambient'`.

**Action — REFACTOR:** none.

**Output:** migration 7 is the last entry; existing repository rows migrate
to `remoteUrl` + `authKind`.

**Verify:** migration test green; `npm run verify` green.

---

### Task T4 — workspace: `LocalWorkspaceManager` uses `remoteUrl` + `GIT_ASKPASS`

**Requires:** T1, T2, T3.

**Input:** `src/workspace/local.ts`, `src/workspace/local.test.ts`.

**Action — RED:** tests using a real `git init` in a temp dir: (a) preparing a
workspace for a `{ remoteUrl: "file:///tmp/…", branch: "main", auth: { kind: "ambient" } }`
repository clones without error and sets `workspace.baseCommit`; (b) a repo with
`auth.kind = "https-token"` calls `execFile` such that the token never appears
in the argv array (checked by inspecting the args passed to the `execFile` call
with a spy or by confirming the token is written to a temp file only); (c) the
child process env for any git call contains `GIT_TERMINAL_PROMPT=0` and does NOT
contain `GIT_TRACE`, `GIT_TRACE_CURL`, or `GIT_CURL_VERBOSE` keys. Fails today:
`buildRemoteUrl` hardcodes GitHub; no `GIT_ASKPASS` mechanism.

**Action — GREEN:** remove `defaultBuildRemoteUrl`, `LocalWorkspaceManagerOptions.buildRemoteUrl`,
and all uses of `this.buildRemoteUrl`. Read `repo.remoteUrl` directly. Implement
`buildGitEnv(auth: RepositoryAuth, credentialValue?: string): Record<string, string>`:
strip `GIT_TRACE*` and `GIT_CURL_VERBOSE` from `process.env`, always set
`GIT_TERMINAL_PROMPT=0`. For `https-token`: write the token to a `chmod 600`
temp file (via `writeFile` + `chmod`), set `GIT_ASKPASS` to a static one-liner
script that echoes the token file content. For `ssh-agent` and `ambient`: no
`GIT_ASKPASS`, no extra env. Pass this env to every `execFile` call. Redact any
stderr that arrives from git before re-throwing errors (replace the token value
with `<redacted>` using the same temp file path as a hint).

**Action — REFACTOR:** extract `buildGitEnv` as a module-internal helper.

**Output:** `LocalWorkspaceManager` derives the remote from `repo.remoteUrl` only;
tokens never in URL, argv, or scripts; child env is sanitised.

**Verify:** `node --test src/workspace/local.test.ts` green (real git, `file://`
remotes); `npm run typecheck` 0; `npm run lint` clean.

---

### Task T5 — CLI: `create repository` uses `--remote-url --branch --auth --credential`

**Requires:** T2.

**Input:** `src/apps/cli/resource.ts`, `src/apps/cli/router.ts`,
`src/apps/cli/resource.test.ts` (if it exists).

**Action — RED:** a test that calls `runCreateRepository` with
`{ project, name, "remote-url": "https://github.com/o/r.git", branch: "main", auth: "ambient" }`
returns `exitCode: 0`; a call with a `--remote-url` containing embedded userinfo
returns `exitCode: 1` with a message mentioning `remoteUrl`; a call with
`--organization` in args returns `exitCode: 1` (unknown flag). Fails today:
handler requires `--organization`.

**Action — GREEN:** rewrite `runCreateRepository` to parse `--remote-url`,
`--auth` (`ambient` | `https-token` | `ssh-agent`, default `ambient`), and
`--credential` (required when `--auth https-token`). Build `RepositoryAuth` from
these flags. Call `addResource.execute` with the new input shape. Update the
`"create repository"` entry in `COMMANDS` (`src/apps/cli/router.ts`): replace
`organization` with `remote-url`, add `auth` and `credential` flags.

**Action — REFACTOR:** none.

**Output:** `create repository --remote-url … --branch … [--auth …] [--credential …]`
is the new CLI surface; `--organization` is gone.

**Verify:** handler unit test green; `npm run typecheck` 0; `npm run lint` clean.

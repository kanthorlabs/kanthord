# Story 5 — `examples/oauth-package` — a real v3 graph package

Epic: `.agent/plan/epics/011-client-discovery-surface.md`

## Change

Create the directory `examples/oauth-package/` with exactly these seven files.
The layout is **flat** (the reader walks any `*.md` at any depth and takes the
node kind from frontmatter only — `src/apps/cli/graph-md/parse.ts:10-24`,
`src/app/graph/graph-codec.ts:307-324`), mirroring
`scripts/e2e/make-todo-service-graph.sh:39-108`, which is the working reference
for a hand-authored, importable package.

**`examples/oauth-package/initiative.md`**

```
---
kind: initiative
ref: oauth-integration
name: OAuth Integration
bindings:
  source: repository
---
```

**`examples/oauth-package/objective-backend.md`**

```
---
kind: objective
ref: oauth-backend
initiative: oauth-integration
name: Backend
---
```

**`examples/oauth-package/objective-web.md`**

```
---
kind: objective
ref: oauth-web
initiative: oauth-integration
name: Web
after: [oauth-backend]
---
```

**`examples/oauth-package/task-google-oauth-api.md`**

```
---
kind: task
ref: google-oauth-api
objective: oauth-backend
title: Implement Google OAuth API
agent: generic@1
context:
  source: source
---
# Instructions
Add the server-side Google OAuth 2.0 authorization-code flow: an endpoint that
redirects to Google's consent screen with the configured client id and scopes,
and a callback endpoint that exchanges the code for tokens and stores the
resulting session.
# Acceptance Criteria
- [ ] A login endpoint redirects to Google's consent screen
- [ ] The callback endpoint exchanges the authorization code for tokens
- [ ] An invalid or expired code returns a 4xx response, never a 5xx
```

**`examples/oauth-package/task-session-refresh.md`**

```
---
kind: task
ref: session-refresh
objective: oauth-backend
title: Refresh expired OAuth sessions
agent: generic@1
dependencies: [google-oauth-api]
context:
  source: source
---
# Instructions
Refresh an expired access token from its stored refresh token when a request
arrives with an expired session, and reject the request when the refresh token
is itself invalid.
# Acceptance Criteria
- [ ] An expired access token is refreshed transparently on the next request
- [ ] An invalid refresh token clears the session and returns 401
```

**`examples/oauth-package/task-oauth-ui.md`**

```
---
kind: task
ref: oauth-ui
objective: oauth-web
title: Implement OAuth UI
agent: generic@1
context:
  source: source
---
# Instructions
Add the sign-in screen that starts the OAuth flow, plus the post-callback
state: a signed-in view showing the account, and a sign-out control.
# Acceptance Criteria
- [ ] A sign-in control starts the OAuth flow
- [ ] After callback the signed-in account is displayed
- [ ] A sign-out control ends the session
```

**`examples/oauth-package/.kanthord-export.json`** — committed as a
`formatVersion: 3` placeholder, because the Proof checks it **before** import
(`scripts/e2e/client-discovery-proof.sh:53-54`) and reads `initiativeId` from it
**after** import (`:60`), and `import graph --create` overwrites the whole file
with the freshly minted ids (`src/apps/cli/import-graph.ts:523-543`). Field set
is exactly `ExportManifest` (`src/app/graph/graph-package.ts:39-52`):

```json
{
  "packageId": "",
  "formatVersion": 3,
  "digestAlgorithm": "sha256",
  "initiativeId": "",
  "nodes": {},
  "files": [],
  "objectiveIds": [],
  "refToId": {
    "objectives": {},
    "tasks": {}
  }
}
```

## Constraints

- **No `id:` key in any `.md` frontmatter.** `import graph --create` throws
  `CreateModeIdError` on any persisted id
  (`src/app/graph/create-graph.ts:96-110`). The committed state of this
  directory is the _pre-import_ state.
- `agent:` must be `generic@1`. The live agent catalog admits only `generic@1`
  and `fake@1` (`src/composition.ts:283-285`), so `tdd@1` / `pr@1` / `k8s@1`
  from the README tree are deliberately not used.
- Every task must have a non-empty `title`, a non-empty `# Instructions`
  section, and at least one `# Acceptance Criteria` item — all three are
  hard-required by `newTask` via `CreateGraph`
  (`src/domain/task.ts:65-75`, `src/app/graph/create-graph.ts:212-220`).
  Each AC item is a single line starting `- [ ] ` with **no** indented
  continuation line (`graph-codec.ts:97-101`).
- No `# Verification` section in any task (the section is optional, and a
  verification command would run against a repository this example does not
  own).
- Task `dependencies:` stay **within one objective**; cross-objective ordering
  is expressed only by the objective-level `after: [oauth-backend]`.
- Do not add any other file to the directory. A stray `*.md` with frontmatter
  would be parsed as a graph node; a `*.md` without frontmatter is ignored but
  still pointless here.
- **`examples/demo-graph.yaml` must not be touched** — it is `check graph`
  input, asserted by `src/apps/cli/graph-check.test.ts:15-16`.

## Verify

- `node --test src/apps/cli/graph-import-export.e2e.test.ts` — one new test in
  that file (it already drives real import against real sqlite): resolve
  `examples/oauth-package` from the repo root, **copy it into the test's temp
  dir** (import rewrites the package in place), run `import graph <copy> --create --project <p> --bind source=<repoId>`, and assert:
  - exit code 0, no stderr;
  - the copy's `.kanthord-export.json` now has `formatVersion === 3`, a
    26-char ULID `initiativeId`, `objectiveIds.length === 2`, and
    `Object.keys(refToId.tasks)` deep-equals
    `["google-oauth-api", "oauth-ui", "session-refresh"]` after sorting;
  - `ListObjectives` for that initiative returns 2 objectives named
    `Backend` and `Web`;
  - `ListTasks` for that initiative returns 3 rows, every row has a non-empty
    `title`, and the `session-refresh` row's `dependencies` contains exactly
    the `google-oauth-api` task id.
- `node --test src/apps/cli/graph-check.test.ts` — unchanged and still green
  (guards that `examples/demo-graph.yaml` was not modified).
- `npm run verify` exits 0.
- Proof: `scripts/e2e/client-discovery-proof.sh` Phase **C** — the
  `C ok: examples/oauth-package imports and persists as a v3 package` line
  (`client-discovery-proof.sh:52-66`).

  **Known Proof-script defect (see `index.md` blocker B2):** the Proof imports
  `examples/oauth-package` in place, so a run rewrites the committed `.md` files
  with `id:` keys and replaces the manifest. Run
  `git checkout -- examples/oauth-package` after the Proof, and do **not**
  commit the mutated package.

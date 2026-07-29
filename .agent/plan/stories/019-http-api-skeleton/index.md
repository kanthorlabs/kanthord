# EPIC 019 — HTTP API skeleton: one REST resource, served end to end — stories

Epic: `.agent/plan/epics/019-http-api-skeleton.md`
Prereq: EPIC 018 (sequence order).

`kanthord serve --port <n>` runs a loopback REST API that answers
`GET /api/projects/:id` over the contract every later resource reuses: an
explicit route table, a JSON envelope, a stable error-code registry with HTTP
statuses, and JWT session auth by HttpOnly cookie or bearer token.

## Dispatch order

`00` is already satisfied — verify only, do not dispatch.

1. `01-transport-primitives.md` — pure, no dependants blocked.
2. `02-envelope-and-error-registry.md` — pure.
3. `03-route-table-and-projects-get.md` — needs 02's `InvalidInputError` site.
4. `04-server.md` — needs 01, 02, 03. **The largest story.**
5. `05-cli-serve-leaf.md` — needs 04.
6. `06-cli-coverage-audit.md` — needs 03 and 05 (the leaf must exist before the
   audit can list it as deferred).
7. `07-program-proof.md` — last; needs everything.

`03` + `04` are a coupled pair: `04`'s middleware chain consumes `03`'s `Route`
type. Implement `03` first and do not change its type in `04`.

## Stories

- 00 — dependency `find-my-way` (maintainer; ALREADY DONE) → `00-dependency-find-my-way.md`
- 01 — `jwt.ts` + `key.ts` → `01-transport-primitives.md`
- 02 — `envelope.ts` + `error-registry.ts` → `02-envelope-and-error-registry.md`
- 03 — `routes.ts` + `decode.ts` + `views/project.ts` + `deps.ts` → `03-route-table-and-projects-get.md`
- 04 — `server.ts` (the middleware chain) → `04-server.md`
- 05 — `commands/serve.ts` + `serve.ts` handler + `dbPath` on `CliDeps` → `05-cli-serve-leaf.md`
- 06 — `deferred.ts` + the coverage audit test → `06-cli-coverage-audit.md`
- 07 — the program Proof goes GREEN → `07-program-proof.md`

## Facts (needed for implementation)

- **`src/apps/http/` does not exist.** Every file in stories 01–04 and 06 is new.
- **`find-my-way@9.7.0` is installed** (`package.json:40`, `package-lock.json:3751`).
  `import Router from "find-my-way";` typechecks under this repo's tsconfig
  (verified). Its `find(method, path)` returns
  `{ handler, params: Record<string, string | undefined>, store, searchParams: Record<string, string> } | null`
  (`node_modules/find-my-way/index.d.ts:126-131,179-183`) and `hasRoute(method, path): boolean`
  (`:191`). **Use `find`, never `lookup`** — the server owns its own 404/405 and
  middleware order.
- **eslint boundaries, verified empirically.** All of `src/apps` is ONE element
  (`eslint.config.js:27`, `partialMatch: false`, no capture segment). A
  production file under `src/apps/http/` may import: `src/app/**` (policy
  `eslint.config.js:76-77`), anything under `src/apps/**` (intra-element, not
  checked), `src/composition.ts` (unclassified), and node builtins. It may **NOT**
  import `src/domain/**`, any capability adapter, or even a `*/port.ts` — the
  port carve-out (`:66-72`) is for `app/` only. `src/apps/http/*.test.ts` is
  exempt (`:91-95`).
- **`CliDeps`** — `src/apps/cli/deps.ts:166`, with `[key: string]: unknown` at
  `:168`, so `{} as unknown as CliDeps` and intersections both work.
  `getProject: GetProject;` is `:174`. Last field `stdinIsTty: boolean;` is `:289`.
- **`GetProject`** — `src/app/project/get-project.ts`: `execute({ id })` returns
  `Promise<Project>`, throwing `UnknownReferenceError("project", id)` at `:15`.
- **`Project` is exactly `{ id: string; name: string }`** plus an inherited
  optional `projectId?: string` that is unset for a root project
  (`src/domain/project.ts:4`, `src/domain/entity.ts:5`). `apps/http` may not
  import the type — accept a structural parameter instead.
- **`kanthord get project --id X --json` prints `JSON.stringify(project)`
  verbatim, unmapped** (`src/apps/cli/get.ts:19-21`), i.e. `{"id":…,"name":…}`.
  That is what the Proof compares against.
- **The view convention is explicit field-by-field literals, never a spread** —
  `src/app/resource/resource-view.ts:61-65` ("Explicitly list fields — never
  spread — so `value` is structurally absent").
- **tsconfig** (`tsconfig.json`): `module`/`moduleResolution` `nodenext`,
  `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
  `allowImportingTsExtensions`, `lib: ["esnext"]`, `types: ["node"]`. Relative
  imports MUST carry `.ts`. Type-only imports MUST use `import type`. Global
  `fetch` is typed via `@types/node`. No DOM lib.
- **eslint enables exactly one rule** (`boundaries/dependencies`,
  `eslint.config.js:39`) — typescript-eslint is used only as a parser, so no
  `no-explicit-any` / `no-unused-vars` / `no-floating-promises`.
- **Test conventions:** `import assert from "node:assert/strict"` +
  `import { describe, test } from "node:test"`; `describe` label is the path of
  the file under test; temp dirs are
  `mkdtempSync(join(tmpdir(), "kanthord-<slug>-"))` with
  `try { … } finally { rmSync(dir, { recursive: true, force: true }); }` per test
  (`src/events/sqlite.test.ts:20`, `src/apps/cli/e2e-smoke.test.ts:11-13`).
  Deps doubles are built inline per test as
  `{ getProject: { execute: async (i: unknown) => … } } as unknown as CliDeps`
  (`src/apps/cli/commands/retry/task.test.ts:73`); there is **no** shared fake
  bundle helper and none should be created.
- **The one existing port-binding test** is
  `src/agent-runner/pi-session.custom.test.ts:171-247`: `server.listen(0,
"127.0.0.1", cb)` wrapped in `new Promise<number>`, port read from
  `server.address()` guarded by `typeof addr === "object"`, `server.close()` in
  `finally`. Copy that shape; no `AddressInfo` import exists in the repo.
- **`src/apps/cli/architecture.test.ts` hard-codes counts.**
  `EXPECTED_LEAF_COUNT = 79` (`:44`) must become `80` when `serve` is added.
  `EXPECTED_LEAF_FILE_COUNT = 73` (`:28`) must NOT change — it scans
  `commands/` **subdirectories** only, and `serve.ts` sits directly in
  `commands/` like `queue.ts`. The leaf-path recursion to copy is
  `collectRows` at `src/apps/cli/commands/commands.ts:13-20`.
  `architecture.test.ts` bans `.action(` / `.option(` /
  `.requiredOption(` / `.argument(` in `index.ts` (`:47-52`) and requires every
  leaf to have a non-empty description and help containing both `Usage:` and
  `Example` (`:101-136`).
- **The leaf template to mirror is `src/apps/cli/commands/queue.ts`** (27 lines,
  a top-level leaf with options).
- **`src/apps/cli/index.ts` edit sites:** import block ends `:38`; the
  `const …` block ends `:78` (`const queue = buildQueueCommand(deps, io).name("queue");`);
  the chain ends `:118` (`.addCommand(queue);`).
- **`buildDeps`** is `src/composition.ts:184`, opens SQLite at `:188`, and its
  single flat return object literal spans `:1159-1244` (`stdinIsTty:` is `:1243`).
- **`scripts/e2e/http-api-proof.sh` already exists** and is RED at phase A
  (`unknown command 'serve'`). Story 07 must make it GREEN **without editing it**.
- **Lanes** (`scripts/lane-check.sh`): `src/**/*.test.ts` → test-engineer only;
  other `src/**/*.ts` and `scripts/*` → software-engineer only; `package.json` is
  locked to both.
- `npm run verify` = typecheck → `node --test` → verify-handoff (a second
  typecheck) → `eslint .` → `node src/main.ts db status`. It does **not** run
  `format:check` and does **not** run any Proof script.

# Story S5 — resource write rows: four typed creates, four typed PATCHes, bulk import

Epic: `.agent/plan/epics/021-http-planning-writes.md` (decision 5 + decision 6's
`import resource` row)
Depends on: Story S1, S2, S3, S4 (`idView` / `idsView` live in `views/shared.ts`).

Nine rows. `ROUTES.length` becomes `40`.

## Change

### 1. `src/app/resource/add-resource.ts` — republish the auth type

`RepositoryAuth` is declared in `src/domain/resource.ts:13` and `apps/http` may
not name it. A parallel structural mirror in `apps/http` would silently drift the
day a fourth auth kind is added, so the app layer republishes its own input
contract instead — the same move `check-graph.ts:9-14` already makes for its
errors and `ReadinessEntry`. Append to `add-resource.ts`:

```ts
// Republished so driving adapters can name the auth shape they must decode
// without importing domain/ (AGENTS.md).
export type { RepositoryAuth } from "../../domain/resource.ts";
```

### 2. `src/apps/http/body.ts` — the repository-auth readers

Append. `RepositoryAuth` now arrives from `app/`, so there is no second
declaration to drift:

```ts
import type { RepositoryAuth } from "../../app/resource/add-resource.ts";

export function requireBodyRepositoryAuth(
  body: unknown,
  field: string,
): RepositoryAuth {
  const auth = requireBodyObject(body, field);
  const kind = requireBodyString(auth, "kind");
  if (kind === "ambient") {
    return { kind: "ambient" };
  }
  if (kind === "ssh-agent") {
    return { kind: "ssh-agent" };
  }
  if (kind === "https-token") {
    return {
      kind: "https-token",
      credentialId: requireBodyString(auth, "credentialId"),
    };
  }
  throw new InvalidInputError(
    field,
    'kind must be "ambient", "https-token" or "ssh-agent"',
  );
}

export function optionalBodyRepositoryAuth(
  body: unknown,
  field: string,
): RepositoryAuth | undefined {
  const raw = bodyRecord(body, field)[field];
  if (raw === undefined) {
    return undefined;
  }
  return requireBodyRepositoryAuth(body, field);
}
```

### 3. `src/apps/http/routes.ts` — four annotated create decoders

A create's `type` must keep its literal type. Annotating each decoder's return
type as `AddResourceInput` makes the literals contextually typed, so no `as` and
no `as const` is needed. Place these four functions directly above `ROUTES`,
beside the existing `resourceCollectionRoute` helper (`routes.ts:100-127`).

One new import (`RouteInput` is declared in `routes.ts` itself at `:33`, so it
needs no import):

```ts
import type { AddResourceInput } from "../../app/resource/add-resource.ts";
```

```ts
/**
 * The four typed resource creates (decision 5). Each decoder's return type is
 * ANNOTATED so `type` and `provider` keep their literal types without a cast,
 * and each `type` is bound literally here — never read from the body.
 */
function decodeRepositoryCreate({
  params,
  body,
}: RouteInput): AddResourceInput {
  return {
    type: "repository",
    projectId: requirePathParam(params, "id"),
    name: requireBodyString(body, "name"),
    remoteUrl: requireBodyString(body, "remoteUrl"),
    branch: requireBodyString(body, "branch"),
    // AddResource derives the home path from remoteUrl when path is ""
    // (add-resource.ts:102-109).
    path: optionalBodyString(body, "path") ?? "",
    auth: requireBodyRepositoryAuth(body, "auth"),
  };
}

function decodeCredentialCreate({
  params,
  body,
}: RouteInput): AddResourceInput {
  return {
    type: "credential",
    projectId: requirePathParam(params, "id"),
    name: requireBodyString(body, "name"),
    provider: requireBodyString(body, "provider"),
    // The only secret 021 carries. It travels in the body because the CLI's
    // --value-file has no HTTP twin, and it is never presented back.
    value: requireBodyString(body, "value"),
  };
}

function decodeNotificationCreate({
  params,
  body,
}: RouteInput): AddResourceInput {
  const provider = requireBodyString(body, "provider");
  if (provider !== "slack" && provider !== "telegram") {
    throw new InvalidInputError("provider", 'must be "slack" or "telegram"');
  }
  return {
    type: "notification",
    projectId: requirePathParam(params, "id"),
    name: requireBodyString(body, "name"),
    provider,
    destination: requireBodyString(body, "destination"),
  };
}

function decodeFilesystemCreate({
  params,
  body,
}: RouteInput): AddResourceInput {
  return {
    type: "filesystem",
    projectId: requirePathParam(params, "id"),
    name: requireBodyString(body, "name"),
    path: requireBodyString(body, "path"),
  };
}
```

### 4. `src/apps/http/deps.ts` — six fields

```ts
import type { AddResource } from "../../app/resource/add-resource.ts";
import type { UpdateRepository } from "../../app/resource/update-repository.ts";
import type { UpdateCredential } from "../../app/resource/update-credential.ts";
import type { UpdateNotification } from "../../app/resource/update-notification.ts";
import type { UpdateFilesystem } from "../../app/resource/update-filesystem.ts";
import type { ImportResources } from "../../app/resource/import-resources.ts";
...
  readonly addResource: AddResource;
  readonly updateRepository: UpdateRepository;
  readonly updateCredential: UpdateCredential;
  readonly updateNotification: UpdateNotification;
  readonly updateFilesystem: UpdateFilesystem;
  readonly importResources: ImportResources;
```

### 5. `src/apps/cli/commands/serve.ts` — populate them

```ts
      addResource: deps.addResource,
      updateRepository: deps.updateRepository,
      updateCredential: deps.updateCredential,
      updateNotification: deps.updateNotification,
      updateFilesystem: deps.updateFilesystem,
      importResources: deps.importResources,
```

### 6. `src/apps/http/routes.ts` — nine rows appended to `ROUTES`

| id                            | method | path                            | status | use case             | cliCommands               |
| ----------------------------- | ------ | ------------------------------- | ------ | -------------------- | ------------------------- |
| `project.repository.create`   | POST   | `/api/project/:id/repository`   | 201    | `AddResource`        | `["create repository"]`   |
| `project.credential.create`   | POST   | `/api/project/:id/credential`   | 201    | `AddResource`        | `["create credential"]`   |
| `project.notification.create` | POST   | `/api/project/:id/notification` | 201    | `AddResource`        | `["create notification"]` |
| `project.filesystem.create`   | POST   | `/api/project/:id/filesystem`   | 201    | `AddResource`        | `["create filesystem"]`   |
| `repository.patch`            | PATCH  | `/api/repository/:id`           | 200    | `UpdateRepository`   | `["update repository"]`   |
| `credential.patch`            | PATCH  | `/api/credential/:id`           | 200    | `UpdateCredential`   | `["update credential"]`   |
| `notification.patch`          | PATCH  | `/api/notification/:id`         | 200    | `UpdateNotification` | `["update notification"]` |
| `filesystem.patch`            | PATCH  | `/api/filesystem/:id`           | 200    | `UpdateFilesystem`   | `["update filesystem"]`   |
| `project.resource.create`     | POST   | `/api/project/:id/resource`     | 200    | `ImportResources`    | `["import resource"]`     |

The four creates all point `Location` at `/api/resource/<id>` — a DIFFERENT
resource than the collection posted to, which is exactly why `location` is a
declared function and never derived from `path`.

```ts
  defineRoute({
    id: "project.repository.create",
    method: "POST",
    path: "/api/project/:id/repository",
    successStatus: 201,
    kind: "json",
    cliCommands: ["create repository"],
    decode: decodeRepositoryCreate,
    run: async (deps, input) => deps.addResource.execute(input),
    present: (result) => idView(result),
    location: (result) => `/api/resource/${result}`,
  }),
  defineRoute({
    id: "project.credential.create",
    method: "POST",
    path: "/api/project/:id/credential",
    successStatus: 201,
    kind: "json",
    cliCommands: ["create credential"],
    decode: decodeCredentialCreate,
    run: async (deps, input) => deps.addResource.execute(input),
    present: (result) => idView(result),
    location: (result) => `/api/resource/${result}`,
  }),
  defineRoute({
    id: "project.notification.create",
    method: "POST",
    path: "/api/project/:id/notification",
    successStatus: 201,
    kind: "json",
    cliCommands: ["create notification"],
    decode: decodeNotificationCreate,
    run: async (deps, input) => deps.addResource.execute(input),
    present: (result) => idView(result),
    location: (result) => `/api/resource/${result}`,
  }),
  defineRoute({
    id: "project.filesystem.create",
    method: "POST",
    path: "/api/project/:id/filesystem",
    successStatus: 201,
    kind: "json",
    cliCommands: ["create filesystem"],
    decode: decodeFilesystemCreate,
    run: async (deps, input) => deps.addResource.execute(input),
    present: (result) => idView(result),
    location: (result) => `/api/resource/${result}`,
  }),
  defineRoute({
    id: "repository.patch",
    method: "PATCH",
    path: "/api/repository/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["update repository"],
    readRow: "resource.get",
    decode: ({ params, body }) => {
      const name = optionalBodyString(body, "name");
      const branch = optionalBodyString(body, "branch");
      const path = optionalBodyString(body, "path");
      const remoteUrl = optionalBodyString(body, "remoteUrl");
      const auth = optionalBodyRepositoryAuth(body, "auth");
      const reclone = optionalBodyBool(body, "reclone");
      // `type` is the ONE immutable probe forwarded — see Constraints.
      const type = optionalBodyString(body, "type");
      return {
        id: requirePathParam(params, "id"),
        ...(name !== undefined ? { name } : {}),
        ...(branch !== undefined ? { branch } : {}),
        ...(path !== undefined ? { path } : {}),
        ...(remoteUrl !== undefined ? { remoteUrl } : {}),
        ...(auth !== undefined ? { auth } : {}),
        ...(reclone !== undefined ? { reclone } : {}),
        ...(type !== undefined ? { type } : {}),
      };
    },
    run: async (deps, input) => deps.updateRepository.execute(input),
  }),
  defineRoute({
    id: "credential.patch",
    method: "PATCH",
    path: "/api/credential/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["update credential"],
    readRow: "resource.get",
    decode: ({ params, body }) => {
      const name = optionalBodyString(body, "name");
      const value = optionalBodyString(body, "value");
      const type = optionalBodyString(body, "type");
      return {
        id: requirePathParam(params, "id"),
        ...(name !== undefined ? { name } : {}),
        ...(value !== undefined ? { value } : {}),
        ...(type !== undefined ? { type } : {}),
      };
    },
    run: async (deps, input) => deps.updateCredential.execute(input),
  }),
  defineRoute({
    id: "notification.patch",
    method: "PATCH",
    path: "/api/notification/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["update notification"],
    readRow: "resource.get",
    decode: ({ params, body }) => {
      const name = optionalBodyString(body, "name");
      const destination = optionalBodyString(body, "destination");
      const type = optionalBodyString(body, "type");
      return {
        id: requirePathParam(params, "id"),
        ...(name !== undefined ? { name } : {}),
        ...(destination !== undefined ? { destination } : {}),
        ...(type !== undefined ? { type } : {}),
      };
    },
    run: async (deps, input) => deps.updateNotification.execute(input),
  }),
  defineRoute({
    id: "filesystem.patch",
    method: "PATCH",
    path: "/api/filesystem/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["update filesystem"],
    readRow: "resource.get",
    decode: ({ params, body }) => {
      const name = optionalBodyString(body, "name");
      const path = optionalBodyString(body, "path");
      const type = optionalBodyString(body, "type");
      return {
        id: requirePathParam(params, "id"),
        ...(name !== undefined ? { name } : {}),
        ...(path !== undefined ? { path } : {}),
        ...(type !== undefined ? { type } : {}),
      };
    },
    run: async (deps, input) => deps.updateFilesystem.execute(input),
  }),
  defineRoute({
    id: "project.resource.create",
    method: "POST",
    path: "/api/project/:id/resource",
    successStatus: 200,
    kind: "json",
    cliCommands: ["import resource"],
    decode: ({ params, body }) => ({
      projectId: requirePathParam(params, "id"),
      entries: requireBodyObjectArray(body, "entries"),
    }),
    run: async (deps, input) => deps.importResources.execute(input),
    present: (result) => idsView(result),
  }),
```

Extend the `./body.ts` import with `requireBodyObjectArray`,
`requireBodyRepositoryAuth`, `optionalBodyRepositoryAuth`, and the
`./views/shared.ts` import with `idsView`.

### 7. `src/apps/http/routes.test.ts` — the row count

```ts
test("ROUTES holds exactly 40 rows: 31 after the planning writes, plus the 9 resource-write rows", () => {
  assert.equal(ROUTES.length, 40);
});
```

### 8. `src/apps/http/cli-coverage.test.ts` — nine more claimed leaves

Add `"create repository"`, `"create credential"`, `"create notification"`,
`"create filesystem"`, `"update repository"`, `"update credential"`,
`"update notification"`, `"update filesystem"`, `"import resource"`.

## Constraints

- **Each PATCH decoder forwards exactly ONE immutable-field probe: `type`.**
  This is deliberate and load-bearing. The runtime guard in each use case fires on
  `field in input` (e.g. `update-credential.ts:26-30`), so without the probe a
  client that posts `{"type":"credential"}` would be silently ignored and
  `ImmutableFieldError` → `409 immutable_field` would be unreachable — the exact
  case the EPIC registers and Proof phase E asserts. `type` is the ONLY probe
  because it is the only immutable field the Proof exercises; `projectId`, and
  `provider` on credential/notification, are deliberately NOT accepted, so a body
  naming them is ignored exactly like any other unlisted field. That is a known
  asymmetry, recorded here rather than fixed by inference: widening the probe set
  would be a new HTTP contract derived from implementation details, which the
  EPIC does not authorise. Raise it with the human if the UI needs it.
- **The probe is value-sensitive, and decode must NOT pre-empt it.** The guard
  compares the posted value with the STORED value, so `{"type":"repository"}` on
  a repository is a no-op success, not an error. Decode cannot know the stored
  value, so it forwards and lets the app layer decide — never a `400` of its own.
  `id` is NOT read from the body; it always comes from the path, so it always
  equals the stored value and never trips the guard. The probe is read with
  `optionalBodyString` and spread conditionally, so an absent probe is an absent
  key.
- All four PATCH rows use `readRow: "resource.get"` — `GET /api/resource/:id` is
  the single, type-agnostic representation (020 decision 6). `readRow` names a
  ROW, not a path, so it works from the typed PATCH paths.
- **No response ever carries a credential `value`.** The 020 credential view has
  no `value` field (`views/resource.ts:60-68`) and neither does the app-layer view
  (`src/app/resource/resource-view.ts:63-73`). Do not add one, and do not present
  the PATCH input.
- `path` on a repository create defaults to `""` (not omitted): `AddResource`
  derives the home path from `remoteUrl` for `""` and resolves a relative path
  otherwise (`add-resource.ts:102-109`).
- `provider` on a notification is narrowed by an explicit `if`, not a cast.
- No shared factory for the four creates: their field sets differ, and 020's
  `resourceCollectionRoute` worked only because the four read rows were
  identical apart from `type`.
- `project.resource.create` answers `200` with `{ ids: [...] }` and **no**
  `Location` — a bulk create has no single created resource (decision 6).
  It is not a `201`, so it must NOT declare `location`.
- `entries` elements are passed through untyped
  (`Array<Record<string, unknown>>`), exactly as `ImportResources` expects
  (`import-resources.ts:40-43`); `buildResource` validates each one and the row
  maps its failure to `400 import_validation`.
- No `as` cast in any row.

## Verify

- New `src/apps/http/routes.write-resource.test.ts` (supertest + fakes):
  - each of the four creates: `201`, `Location: /api/resource/<id>`, body
    `{ data: { id } }`, and the fake `addResource.execute` received the EXACT
    input object — asserted with `assert.deepEqual`, including
    `type: "repository"` / `"credential"` / `"notification"` / `"filesystem"`
    bound literally and, for repository, `path: ""` when the body omits `path`.
  - repository create with `{"auth":{"kind":"https-token","credentialId":"c1"}}`
    → the fake received that exact auth object; with
    `{"auth":{"kind":"bogus"}}` → `400 invalid_input`; with `auth` missing →
    `400 invalid_input`; with `{"auth":{"kind":"https-token"}}` (no
    `credentialId`) → `400 invalid_input`.
  - notification create with `{"provider":"email"}` → `400 invalid_input`
    naming `provider`, and `addResource.execute` was never called.
  - credential create: the fake received `value: "s3cret"`, and the RESPONSE body
    JSON does not contain the string `"s3cret"`
    (`assert.equal(JSON.stringify(res.body).includes("s3cret"), false)`).
  - repository create where the fake throws
    `new EmbeddedCredentialError("https://u:p@h/r.git")` → `400
embedded_credential`; where it throws
    `new DuplicateNameError("resource","p1","x")` → `409 duplicate_name`.
  - each of the four PATCHes: the `428` (no `If-Match`) / `412` (stale) / `200`
    (matching) triple, with the write use case's spy counter `0` on the first two
    and `1` on the third; the `200` body is the re-read `resource.get` DTO and its
    `ETag` differs from the sent one.
  - `PATCH /api/credential/c1` with `{"name":"gh-2"}` → the fake received exactly
    `{ id: "c1", name: "gh-2" }`.
  - `PATCH /api/credential/c1` with `{"name":"gh-2","type":"credential"}` → the
    fake received `{ id: "c1", name: "gh-2", type: "credential" }` (the `type`
    probe IS forwarded).
  - `PATCH /api/credential/c1` with `{"name":"gh-2","provider":"github"}` → the
    fake received exactly `{ id: "c1", name: "gh-2" }` — `provider` is NOT
    forwarded and is silently ignored, and the response is `200`. This pins the
    known asymmetry so a later widening is a deliberate, test-breaking change.
  - `PATCH /api/repository/r1` with `{"type":"repository"}` (the SAME value the
    fake's stored resource carries) → `200`, not `409`: the guard is
    value-sensitive and decode must not pre-empt it.
  - `PATCH /api/repository/r1` with `{"type":"credential"}` where the fake throws
    `new ImmutableFieldError("type")` → `409 immutable_field`.
  - `PATCH /api/repository/r1` with `{"type":5}` → `400 invalid_input` naming
    `type`, and the write use case was never called.
  - `PATCH /api/credential/c1` with `{"value":"rotated"}` → `200` and the
    response body JSON does not contain `"rotated"`, even when the fake
    `getResource` returns an object that DOES carry `value: "rotated"` (cast
    through `as unknown as` in the test) — proving the view drops it.
  - `PATCH /api/repository/r1` with `{"remoteUrl":"x"}` where the fake throws
    `new CacheConflictError("r1")` → `409 cache_conflict`.
  - `POST /api/project/p1/resource` with two entries → `200`, body
    `{ data: { ids: ["a","b"] } }`, **no** `Location` header
    (`assert.equal(res.headers.location, undefined)`), and the fake received
    `{ projectId: "p1", entries: [ … ] }`.
  - the same where the fake throws `new ImportValidationError(1, "dup")` →
    `400 import_validation`; with `{"entries":"x"}` → `400 invalid_input`; with
    `{"entries":[1]}` → `400 invalid_input`.
  - `present`/`location` per row: the four creates give `["id"]` and the exact
    `/api/resource/<id>` string; `project.resource.create` gives `["ids"]` and
    `location === undefined`; the four PATCHes have `present === undefined` and
    `location === undefined`.
- `src/apps/http/body.test.ts` — add: `requireBodyRepositoryAuth` for all three
  kinds returns exactly the declared key set; an unknown kind, a missing
  `credentialId`, a non-object `auth` and an absent `auth` each throw
  `InvalidInputError`; `optionalBodyRepositoryAuth` returns `undefined` when
  absent and delegates otherwise.
- `node --test src/apps/http/routes.write-resource.test.ts src/apps/http/body.test.ts src/apps/http/routes.test.ts src/apps/http/routes.resource.test.ts src/apps/http/cli-coverage.test.ts` passes.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-writes-proof.sh` phases A through E in full (phase F
  is the first failure after this story).

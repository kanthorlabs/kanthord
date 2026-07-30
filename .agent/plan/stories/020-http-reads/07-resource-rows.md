# Story S7 — resource rows

Epic: `.agent/plan/epics/020-http-reads.md` (decision 6)
Depends on: Story S3 (`ListResources` `name` filter), S4 (`optionalQueryString`).

Five rows: four typed project sub-collections plus one type-agnostic item.

## Change

### 1. `src/apps/http/views/shared.ts` — add the `RepositoryAuth` mirror

`RepositoryAuth` lives in `src/domain/resource.ts:13-16`:

```ts
export type RepositoryAuthView =
  | { readonly kind: "ambient" }
  | { readonly kind: "https-token"; readonly credentialId: string }
  | { readonly kind: "ssh-agent" };

export function repositoryAuthView(auth: {
  readonly kind: string;
  readonly credentialId?: string;
}): RepositoryAuthView {
  if (auth.kind === "https-token") {
    return { kind: "https-token", credentialId: auth.credentialId as string };
  }
  if (auth.kind === "ssh-agent") {
    return { kind: "ssh-agent" };
  }
  return { kind: "ambient" };
}
```

An unrecognised `kind` maps to `{ kind: "ambient" }` — the least-privileged
value, and a value the UI can render. Do not throw here.

### 2. `src/apps/http/views/resource.ts` (new)

`ResourceView` (`src/app/resource/resource-view.ts:14-55`) is an `app/` type →
`import type`. It is a discriminated union on `type`; the view switches on it and
emits a literal field list per variant, exactly mirroring
`toResourceView`'s own field lists (`resource-view.ts:61-110`):

- `type: "credential"` → `type`, `id`, `projectId?` (conditional spread),
  `name`, `provider`. **`value` must never appear** — it is not on the input
  type and must not be reintroduced.
- `type: "repository"` → `type`, `id`, `projectId?`, `name`, `remoteUrl`,
  `branch`, `path`, `auth: repositoryAuthView(r.auth)`,
  `publication: r.publication === null ? null : { state: r.publication.state,
remoteOID: r.publication.remoteOID }`.
- `type: "notification"` → `type`, `id`, `projectId?`, `name`, `provider`,
  `destination`.
- `type: "filesystem"` → `type`, `id`, `projectId?`, `name`, `path`.

Export `resourceView(result: ResourceView): ResourceDtoView` where
`ResourceDtoView` is the union of the four literal interfaces. The `switch` must
be exhaustive with no `default` branch (so a new variant is a typecheck error).

### 3. `src/apps/http/views/resource.ts` — the type vocabulary

`ResourceType` lives in `src/domain/resource.ts:11` and may not be imported;
`src/apps/cli/resource.ts:16-17` already mirrors it in the CLI. Declare the HTTP
mirror here:

```ts
/** Mirrors ResourceType (src/domain/resource.ts:11); apps/ may not import domain/. */
export type HttpResourceType =
  "repository" | "credential" | "notification" | "filesystem";
```

Each row binds its own literal value in `decode` — no `type` query parameter
exists, and `ListResources.type` stays required.

### 4. `src/apps/http/deps.ts` — `listResources: ListResources`, `getResource: GetResource`.

### 5. `src/apps/cli/commands/serve.ts:39` — populate both.

### 6. `src/apps/http/routes.ts` — five rows

The four collections are built by one local helper placed directly above
`ROUTES`, so the four rows cannot drift apart:

```ts
function resourceCollectionRoute(
  type: HttpResourceType,
  cliCommands: readonly string[],
): Route {
  return defineRoute({
    id: `project.${type}.list`,
    method: "GET",
    path: `/api/project/:id/${type}`,
    successStatus: 200,
    kind: "json",
    cliCommands,
    decode: ({ params, query }) => {
      const name = optionalQueryString(query, "name");
      return {
        projectId: requirePathParam(params, "id"),
        type,
        ...(name !== undefined ? { name } : {}),
      };
    },
    run: async (deps, input) => deps.listResources.execute(input),
    present: (result) => result.map(resourceView),
  });
}
```

Rows in `ROUTES`, in this order:

| id                          | path                            | cliCommands                              |
| --------------------------- | ------------------------------- | ---------------------------------------- |
| `project.repository.list`   | `/api/project/:id/repository`   | `["list repository", "find resource"]`   |
| `project.credential.list`   | `/api/project/:id/credential`   | `["list credential", "find resource"]`   |
| `project.notification.list` | `/api/project/:id/notification` | `["list notification", "find resource"]` |
| `project.filesystem.list`   | `/api/project/:id/filesystem`   | `["list filesystem", "find resource"]`   |

plus the item row:

```ts
  defineRoute({
    id: "resource.get",
    method: "GET",
    path: "/api/resource/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["get resource", "get repository"],
    decode: ({ params }) => ({ id: requirePathParam(params, "id") }),
    run: async (deps, input) => deps.getResource.execute(input.id),
    present: (result) => resourceView(result),
  }),
```

## Constraints

- `GetResource.execute` takes a POSITIONAL string
  (`src/app/resource/get-resource.ts:24`) — hence `input.id`, not `input`.
- `ListResources.execute` takes an object with a required `type`
  (`src/app/resource/list-resources.ts:16`); do not make it optional.
- `find resource` legitimately appears in four rows' `cliCommands`
  (`src/apps/http/cli-coverage.test.ts` asserts no uniqueness — EPIC 019
  dropped that assumption).
- `resourceView` never spreads the input.

## Verify

- New `src/apps/http/views/resource.test.ts`:
  - credential variant — inject `value: "sekret"` through
    `as unknown as ResourceView`; assert `Object.keys(view).sort()` is exactly
    `["id","name","projectId","provider","type"]` and
    `(view as Record<string, unknown>).value === undefined`. Repeat with
    `projectId` absent and assert the key is ABSENT.
  - repository variant — `auth: { kind: "https-token", credentialId: "c1" }`
    round-trips with exactly two keys; `auth: { kind: "ambient" }` gives exactly
    one key; an unknown `kind` gives `{ kind: "ambient" }`;
    `publication: null` stays `null`; a populated publication has exactly
    `["remoteOID","state"]`.
  - notification and filesystem variants — exact key sets, injected extra
    dropped.
- New `src/apps/http/routes.resource.test.ts` (supertest + fake deps):
  - each of the four collection paths passes the RIGHT literal `type` to the
    fake: `/repository` → `{ projectId: "p1", type: "repository" }`, and the
    same for `credential`, `notification`, `filesystem`.
  - `?name=home` adds `name`; `?name=` (blank) → `400 invalid_input`.
  - `GET /api/resource/r1` → the fake received the STRING `"r1"` (not an
    object) — assert with a recorded argument.
  - unknown id → `404 unknown_reference`.
  - a credential row returned by the fake with a `value` field never appears in
    the HTTP response body (assert on `JSON.stringify(res.body)`).
- `node --test src/apps/http/views/resource.test.ts src/apps/http/routes.resource.test.ts src/apps/http/routes.test.ts src/apps/http/cli-coverage.test.ts` passes.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-reads-proof.sh` phase D in full.

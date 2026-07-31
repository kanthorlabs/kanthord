# Story 1 — the shared lib layer: four payload builders, the resource error table, three write helpers, three invalidation rows

Epic: `.agent/plan/epics/026.5-ui-resource-writes.md` (decision 1, decision 8)
Depends on: EPIC 026.4 (`api-client.ts` write transport, `invalidation.ts`,
`write-errors.ts`), EPIC 026.2 (`ui/src/lib/dto.ts`, `ui/src/lib/query-keys.ts`).

This story adds no component. It is the only layer the four resource modules
share (decision 1).

## Change

### New file `ui/src/lib/resource-payloads.ts`

Imports `type { RepositoryAuthDto, ResourceTypeKey }` from `@/lib/dto` and
nothing else. No React, no query client, no `api-client`.

```ts
export const AUTH_KINDS = ["ambient", "ssh-agent", "https-token"] as const;
export type AuthKind = (typeof AUTH_KINDS)[number];

export const NOTIFICATION_PROVIDERS = ["slack", "telegram"] as const;
export type NotificationProvider = (typeof NOTIFICATION_PROVIDERS)[number];

export interface RepositoryDraft {
  readonly name: string;
  readonly remoteUrl: string;
  readonly branch: string;
  readonly path: string; // "" means "no value" — never sent
  readonly authKind: AuthKind;
  readonly credentialId: string; // "" unless authKind === "https-token"
}
export interface CredentialDraft {
  readonly name: string;
  readonly provider: string;
  readonly value: string;
}
export interface CredentialMetadataDraft {
  readonly name: string;
}
export interface NotificationDraft {
  readonly name: string;
  readonly provider: NotificationProvider;
  readonly destination: string;
}
export interface NotificationEditDraft {
  readonly name: string;
  readonly destination: string;
}
export interface FilesystemDraft {
  readonly name: string;
  readonly path: string;
}

export const EMPTY_REPOSITORY_DRAFT: RepositoryDraft;
export const EMPTY_CREDENTIAL_DRAFT: CredentialDraft;
export const EMPTY_NOTIFICATION_DRAFT: NotificationDraft;
export const EMPTY_FILESYSTEM_DRAFT: FilesystemDraft;

/** Field names whose required value is blank after trim, in the given order. */
export function blankFields(
  draft: Readonly<Record<string, string>>,
  required: readonly string[],
): readonly string[];

export const REPOSITORY_CREATE_REQUIRED = [
  "name",
  "remoteUrl",
  "branch",
] as const;
export const REPOSITORY_EDIT_REQUIRED = ["name", "branch"] as const;
export const CREDENTIAL_CREATE_REQUIRED = [
  "name",
  "provider",
  "value",
] as const;
export const CREDENTIAL_EDIT_REQUIRED = ["name"] as const;
export const NOTIFICATION_CREATE_REQUIRED = ["name", "destination"] as const;
export const NOTIFICATION_EDIT_REQUIRED = ["name", "destination"] as const;
export const FILESYSTEM_CREATE_REQUIRED = ["name", "path"] as const;
export const FILESYSTEM_EDIT_REQUIRED = ["name", "path"] as const;

/** `["credentialId"]` when https-token has no credentialId, else `[]`. */
export function authIssues(
  draft: Pick<RepositoryDraft, "authKind" | "credentialId">,
): readonly string[];

/** Throws when https-token has no credentialId — a partial auth is impossible. */
export function repositoryAuthOf(
  draft: Pick<RepositoryDraft, "authKind" | "credentialId">,
): RepositoryAuthDto;

export function repositoryCreateBody(
  draft: RepositoryDraft,
): Record<string, unknown>;
export function repositoryPatchBody(
  draft: RepositoryDraft,
): Record<string, unknown>;
export function remoteUrlPatchBody(
  remoteUrl: string,
  reclone: boolean,
): Record<string, unknown>;

export function credentialCreateBody(
  draft: CredentialDraft,
): Record<string, unknown>;
export function credentialPatchBody(
  draft: CredentialMetadataDraft,
): Record<string, unknown>;
export function credentialRotationBody(value: string): Record<string, unknown>;

export function notificationCreateBody(
  draft: NotificationDraft,
): Record<string, unknown>;
export function notificationPatchBody(
  draft: NotificationEditDraft,
): Record<string, unknown>;

export function filesystemCreateBody(
  draft: FilesystemDraft,
): Record<string, unknown>;
export function filesystemPatchBody(
  draft: FilesystemDraft,
): Record<string, unknown>;
```

Pinned rules — the same three for every builder, no exceptions:

1. **Trim, then omit.** Every string value is `value.trim()`. A key whose trimmed
   value is `""` is **absent from the returned object** — never `""`, never
   `null`, never `undefined` as a present key (index F2).
2. **`type` on every patch, never on a create.** Each `*PatchBody` and
   `credentialRotationBody` and `remoteUrlPatchBody` includes
   `type: "<the type>"` (decision 8). No `*CreateBody` includes `type` — the
   server binds it from the path (index F3).
3. **`provider` never appears in a patch body** (decision 1, index F10).

Per-builder content, exhaustively:

| builder                  | keys, when non-blank                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `repositoryCreateBody`   | `name`, `remoteUrl`, `branch`, `path`, `auth`                                                        |
| `repositoryPatchBody`    | `name`, `branch`, `path`, `auth`, `type:"repository"`                                                |
| `remoteUrlPatchBody`     | `remoteUrl`, `type:"repository"`, and `reclone: true` **only when** the `reclone` argument is `true` |
| `credentialCreateBody`   | `name`, `provider`, `value`                                                                          |
| `credentialPatchBody`    | `name`, `type:"credential"`                                                                          |
| `credentialRotationBody` | `value`, `type:"credential"`                                                                         |
| `notificationCreateBody` | `name`, `provider`, `destination`                                                                    |
| `notificationPatchBody`  | `name`, `destination`, `type:"notification"`                                                         |
| `filesystemCreateBody`   | `name`, `path`                                                                                       |
| `filesystemPatchBody`    | `name`, `path`, `type:"filesystem"`                                                                  |

- `repositoryPatchBody` carries **no `remoteUrl` and no `reclone`** — those two
  belong to `remoteUrlPatchBody` alone (Story 5 owns that flow).
- `remoteUrlPatchBody(url, false)` has exactly the keys `remoteUrl` and `type`;
  `reclone: false` is never sent.
- `auth` is built by `repositoryAuthOf` and is either a complete object or
  absent — `repositoryAuthOf` throws
  `new Error("https-token needs a credentialId")` when `authKind` is
  `"https-token"` and `credentialId.trim() === ""` (decision 6, index F9).
  `authKind` `"ambient"` → `{kind:"ambient"}`; `"ssh-agent"` →
  `{kind:"ssh-agent"}`; `"https-token"` →
  `{kind:"https-token", credentialId: credentialId.trim()}`.

### Edit `ui/src/lib/write-errors.ts` (026.4 story 07)

Append below the dependency table; change nothing above it.

```ts
export const RESOURCE_ERROR_CODES = [
  "duplicate_name",
  "cache_conflict",
  "immutable_field",
  "embedded_credential",
  "invalid_input",
  "unknown_reference",
] as const;
export type ResourceErrorCode = (typeof RESOURCE_ERROR_CODES)[number];
export const RESOURCE_ERROR_MESSAGE: Readonly<
  Record<ResourceErrorCode, string>
>;
export function resourceErrorMessage(error: ApiError): string;
```

Pinned sentences, one per code, all six distinct:

| code                  | sentence                                                         |
| --------------------- | ---------------------------------------------------------------- |
| `duplicate_name`      | `That name is already used by another resource in this project.` |
| `cache_conflict`      | `This repository already has a cached local home.`               |
| `immutable_field`     | `That field cannot be changed after create.`                     |
| `embedded_credential` | `Put the token in a credential, not in the URL.`                 |
| `invalid_input`       | `The server rejected a field. Check the values and try again.`   |
| `unknown_reference`   | `That resource no longer exists.`                                |

Resolution order, identical in shape to `dependencyErrorMessage`:
(1) `RESOURCE_ERROR_MESSAGE[error.code]` for a known code; (2) else
`error.message` when non-blank; (3) else
`` `The server refused this change (${error.status}).` ``. No sentence mentions
`reclone` (decision 7).

### Edit `ui/src/lib/api-client.ts`

Append three helpers after 026.4's typed helpers. Reuse the 026.4 transport —
add no `fetch` call, set no header (R3).

```ts
export async function fetchResourceWithEtag(
  id: string,
): Promise<Etagged<ResourceDto>>;
// apiGetWithEtag(`/api/resource/${encodeURIComponent(id)}`)

export async function createResource(
  projectId: string,
  type: ResourceTypeKey,
  body: unknown,
): Promise<Created<{ id: string }>>;
// apiPostCreated(`/api/project/${encodeURIComponent(projectId)}/${type}`, body)

export async function patchResource(
  type: ResourceTypeKey,
  id: string,
  body: unknown,
  ifMatch: string,
): Promise<Etagged<ResourceDto>>;
// apiPatch(`/api/${type}/${encodeURIComponent(id)}`, body, ifMatch)
```

`type` is interpolated raw — it is a `ResourceTypeKey`, a closed union of four
literals, so it is not user input and must not be encoded.

### Edit `ui/src/lib/invalidation.ts` (026.4 story 03)

Three edits, nothing else:

1. Extend `MutationName` with `"resource.create" | "resource.edit" |
"credential.rotate"`.
2. Extend `InvalidationContext` with `readonly resourceType?: ResourceTypeKey;`.
3. Add three rows to `INVALIDATION_MATRIX`, built from the `query-keys.ts`
   factories, never hand-written arrays:

| MutationName        | targets                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| `resource.create`   | `{ queryKey: projectKeys.resources(projectId, resourceType), exact: false }`            |
| `resource.edit`     | the `resource.create` target, plus `{ queryKey: resourceKeys.detail(id), exact: true }` |
| `credential.rotate` | `[]` — nothing observable changes (decision 5, index F5)                                |

`exact: false` on the collection target is load-bearing: it also refreshes the
`["project", p, "resource", type, {name}]` search variants. A missing
`projectId`, `resourceType` or `id` throws
``new Error(`invalidation ${mutation} needs ctx.${field}`)`` exactly as the
existing rows do. `credential.rotate` requires no context field and reads none.

## Constraints

- `resource-payloads.ts` imports only types from `@/lib/dto`. No import of
  `api-client`, `invalidation`, React or TanStack Query.
- No builder validates a URL, a branch name, a path or a provider string beyond
  blank-checking. The server owns validation; the UI invents no rule (decision 6).
- Do not touch `ui/src/lib/query-keys.ts` — `projectKeys.resources` and
  `resourceKeys.detail` already cover this epic.
- Do not change `dependencyErrorMessage`, `DEPENDENCY_ERROR_MESSAGE` or any
  026.4 invalidation row.

## Verify

- New `ui/src/lib/resource-payloads.test.ts` —
  `npm run test --workspace ui -- src/lib/resource-payloads.test.ts`:
  - `repositoryCreateBody({name:" r ",remoteUrl:" https://h/x.git ",branch:" main ",path:"",authKind:"ambient",credentialId:""})`
    → `Object.keys(...).sort()` is exactly `["auth","branch","name","remoteUrl"]`
    (no `path`, no `type`), and `name === "r"`, `remoteUrl === "https://h/x.git"`,
    `branch === "main"`.
  - the same draft with `path: "   "` still omits `path`; with `path: " /m/r "`
    includes `path === "/m/r"`.
  - `JSON.stringify(repositoryCreateBody(...))` for every draft above does **not**
    match `/:\s*""/` — the regex the Proof uses at `ui-resources-proof.sh:123`.
  - `repositoryPatchBody` on a full draft: keys sorted are exactly
    `["auth","branch","name","path","type"]`, `type === "repository"`, and
    `"remoteUrl" in body === false` and `"reclone" in body === false`.
  - `remoteUrlPatchBody("https://h/two.git", false)` → keys sorted exactly
    `["remoteUrl","type"]`; with `true` → exactly
    `["reclone","remoteUrl","type"]` and `reclone === true`.
  - `credentialCreateBody({name:"c",provider:"github",value:"s"})` → keys sorted
    exactly `["name","provider","value"]`, no `type`.
  - `credentialPatchBody({name:"c2"})` → exactly `{name:"c2",type:"credential"}`
    and `"provider" in body === false`.
  - `credentialRotationBody(" s ")` → exactly `{value:"s",type:"credential"}`;
    `credentialRotationBody("   ")` → `Object.keys` is exactly `["type"]`.
  - `notificationCreateBody({name:"n",provider:"slack",destination:"#c"})` →
    keys sorted exactly `["destination","name","provider"]`;
    `notificationPatchBody({name:"n",destination:"#c"})` → keys sorted exactly
    `["destination","name","type"]`, `type === "notification"`, and
    `"provider" in body === false`.
  - `filesystemCreateBody` → exactly `["name","path"]`; `filesystemPatchBody` →
    exactly `["name","path","type"]` with `type === "filesystem"`.
  - `NOTIFICATION_PROVIDERS` is exactly `["slack","telegram"]` and
    `AUTH_KINDS` is exactly `["ambient","ssh-agent","https-token"]`.
  - `repositoryAuthOf({authKind:"https-token",credentialId:"  "})` throws
    `/https-token needs a credentialId/`;
    `repositoryAuthOf({authKind:"https-token",credentialId:" c1 "})` →
    `{kind:"https-token",credentialId:"c1"}`;
    `authKind:"ambient"` → `{kind:"ambient"}` with `Object.keys` length 1;
    `authKind:"ssh-agent"` → `{kind:"ssh-agent"}` with `Object.keys` length 1.
  - `authIssues({authKind:"https-token",credentialId:""})` is `["credentialId"]`;
    `authIssues({authKind:"ambient",credentialId:""})` is `[]`.
  - `blankFields({name:"a",path:"  "},["name","path"])` is `["path"]`;
    `blankFields({name:"",path:""},["name","path"])` is `["name","path"]` in that
    order.
- New/extended `ui/src/lib/write-errors.test.ts` —
  `npm run test --workspace ui -- src/lib/write-errors.test.ts`:
  - `RESOURCE_ERROR_CODES.length === 6` and
    `new Set(Object.values(RESOURCE_ERROR_MESSAGE)).size === 6`.
  - `resourceErrorMessage(new ApiError(409,"duplicate_name","a resource named x already exists in p"))`
    returns the pinned duplicate-name sentence, not the server text.
  - an unknown code with a non-blank message returns the message verbatim; an
    unknown code with `""` returns
    `The server refused this change (500).` for status 500.
  - no value of `RESOURCE_ERROR_MESSAGE` matches `/reclone/i`.
  - the existing dependency assertions still pass unchanged.
- Extended `ui/src/lib/api-client.test.ts` —
  `npm run test --workspace ui -- src/lib/api-client.test.ts`:
  - `fetchResourceWithEtag("a/b")` fetches `/api/resource/a%2Fb` and
    `Object.keys(headers)` is exactly `["accept"]`.
  - `createResource("p 1","credential",{name:"c"})` fetches
    `/api/project/p%201/credential` with method `POST` and
    `Object.keys(headers)` exactly `["accept","content-type"]`.
  - `patchResource("repository","r 1",{name:"x"},'"e"')` fetches
    `/api/repository/r%201` with method `PATCH`, `Object.keys(headers)` exactly
    `["accept","content-type","if-match"]`, and `headers["if-match"] === '"e"'`
    byte-identical.
  - none of the three ever sets `authorization` (R3 regression guard).
- Extended `ui/src/lib/invalidation.test.ts` —
  `npm run test --workspace ui -- src/lib/invalidation.test.ts`:
  - `invalidateFor(client,"resource.create",{projectId:"p1",resourceType:"credential"})`
    calls `invalidateQueries` once with
    `{queryKey:["project","p1","resource","credential"],exact:false}`, and a
    seeded `["project","p1","resource","credential",{name:"k"}]` entry reports
    `isInvalidated === true`.
  - `resource.edit` with `{projectId:"p1",resourceType:"repository",id:"r1"}`
    invalidates both the collection prefix and `["resource","r1"]` with
    `exact: true`.
  - `credential.rotate` with `{}` calls `invalidateQueries` **zero** times and
    resolves.
  - `resource.create` with no `resourceType` throws
    `/invalidation resource\.create needs ctx\.resourceType/`.
  - every 026.4 row still returns the same targets.
- `npm run verify` exits 0.
- Proof: no phase directly. This story is the precondition for the body
  assertions in phases C (`ui-resources-proof.sh:123`), D (`:141-144`),
  E (`:158-160`) and F (`:179-181`).

# Story S3 — the lifecycle rows: `default` `PUT`, `credential` `DELETE`, item `DELETE`

Epic: `.agent/plan/epics/024-ai-provider-writes.md` (decisions 3, 4, 5)
Depends on: Story S1 (`optionalQueryBool`, the 24 codes, the `default` segment)
and EPIC 023 (`HttpMethod` accepts `"PUT"`, `PUT_ROWS` exists, `allowMethods`
advertises `PUT`).

Lands 3 rows. `ROUTES.length` 65 → 68. This is the story that makes 023's `PUT`
admission carry a second row.

## Change

**1. `src/apps/http/routes.ts`** — append three rows. All answer `204`, so NONE
declares `present` and none carries an `ETag`:

```
id: "ai-provider.default.put", method: "PUT", path: "/api/ai-provider/default",
successStatus: 204, kind: "json", cliCommands: ["set-default ai-provider"]
decode: ({ body }) => requireBodyString(body, "providerId")
run:    async (deps, id) => deps.setDefaultAiProvider.execute(id)
```

```
id: "ai-provider.credential.delete", method: "DELETE",
path: "/api/ai-provider/:id/credential",
successStatus: 204, kind: "json", cliCommands: ["logout ai-provider"]
decode: ({ params, query }) => ({
  id: requirePathParam(params, "id"),
  options: { …replacement?, …confirmNoDefault? },   // conditional spreads
})
run:    async (deps, i) => deps.logoutAiProvider.execute(i.id, i.options)
```

```
id: "ai-provider.delete", method: "DELETE", path: "/api/ai-provider/:id",
successStatus: 204, kind: "json", cliCommands: ["remove ai-provider"]
decode: ({ params, query }) => ({
  id: requirePathParam(params, "id"),
  options: { …replacement?, …confirmNoDefault?, …cascade? },
})
run:    async (deps, i) => deps.removeAiProvider.execute(i.id, i.options)
```

**Why these three shapes differ, so nobody "tidies" them:**

- `SetDefaultAiProvider.execute(id: string)` takes a POSITIONAL string
  (`set-default-ai-provider.ts:480`). So the row's `Input` IS `string` and
  `decode` returns the string. Do not wrap it in an object.
- `LogoutAiProvider.execute(id, options?)` and
  `RemoveAiProvider.execute(id, options?)` take an id plus an options object
  (`logout-ai-provider.ts:516-519`, `remove-ai-provider.ts:623-630`). `decode`
  returns `{id, options}` and `run` destructures in one expression. That is still
  a pure mapping in `decode` and no logic in `run`.

**2. The query flags** — read with S1's `optionalQueryBool` and the existing
`optionalQueryString`, built with **conditional spreads** so an absent flag leaves
the key ABSENT:

| row                             | parameters                                                     |
| ------------------------------- | -------------------------------------------------------------- |
| `ai-provider.credential.delete` | `?replacement=<id>`, `?confirmNoDefault=true`                  |
| `ai-provider.delete`            | `?replacement=<id>`, `?confirmNoDefault=true`, `?cascade=true` |

`replacement` is `optionalQueryString`; the two booleans are `optionalQueryBool`.
**Never default either to `false`** — the use cases reject a flag that cannot
apply, and `confirmNoDefault: false` would read as "passed" at
`logout-ai-provider.ts:549`.

**3. Wiring, all in this story:**

- `src/apps/http/deps.ts` — `import type` and `readonly` fields for
  `SetDefaultAiProvider`, `LogoutAiProvider`, `RemoveAiProvider`.
- `src/apps/cli/commands/serve.ts` — `setDefaultAiProvider: deps.setDefaultAiProvider,`
  `logoutAiProvider: deps.logoutAiProvider,` `removeAiProvider: deps.removeAiProvider,`.
- `src/composition.ts` — **no change**.

**4. `src/apps/http/routes.test.ts`** — row count 68; add the three ids to the
expected-id array; **add `"ai-provider.default.put"` to `PUT_ROWS`** (024's one
reviewed entry, per 023 decision 2) and leave 023's negative control intact.

**5. `src/apps/http/routes.test.ts`** — add the shadow assertions for
`/api/ai-provider/default` (see Constraints): `PUT` there matches exactly one row,
and no `PUT /api/ai-provider/:id` row exists.

## Constraints

- **`/api/ai-provider/default` shadows `GET /api/ai-provider/:id`.**
  `matchSegments` binds any segment to `:id` (`router.ts:40-46`) and `matchRoute`
  then selects by method (`:75`). So `PUT` there resolves to the new row, and
  `GET /api/ai-provider/default` resolves to the ITEM row with `id="default"` and
  answers `404 unknown_reference`. That is accepted, because ids are 26-character
  ULIDs and can never equal `default`. Do NOT add a `GET`, `POST`, `PATCH` or
  `DELETE` row at `/api/ai-provider/default`, and do not reorder `ROUTES` to
  "fix" the shadow — the method already disambiguates.
- **The row id must match its `PUT_ROWS` entry character for character**, or the
  policy test fails.
- **`PUT` and not `POST`** for the default (epic decision 4): the pointer is a
  singleton whose whole representation is replaced, and `PUT` states the
  idempotence in the protocol. Do not convert it to `POST`, and do not add a
  third `PUT_ROWS` entry for anything else.
- **The target id is in the BODY**, never the path — the RESTful ruling
  (Ulrich, 2026-07-30) that also shapes Story S4's assign row.
- A body-less `DELETE` needs no `Content-Type` (`app.ts:170-176` exempts
  `DELETE`), but the `PUT` DOES carry a body and must send
  `Content-Type: application/json`. Do not relax either gate.
- All three rows answer `204`: no `present`, no body, no `ETag`.
- No `If-Match` and no `readRow` on any of the three. `SetDefaultAiProvider`
  names an absolute target state; `logout` and `remove` are guarded by their own
  explicit escapes, not by a validator.
- **`DELETE /api/ai-provider/default` is NOT a row.** Clearing the default is
  reachable only through `logout`/`remove` with `confirmNoDefault`
  (`logout-ai-provider.ts:585`, `remove-ai-provider.ts:729`). Do not invent a use
  case.
- `logout` is idempotent ONLY with no flags (`logout-ai-provider.ts:539-556`).
  Do not "fix" that by swallowing `UnnecessaryReplacementError`.
- Leave all five use cases unchanged. They already 404 on an unknown id.

## Verify

- `node --test src/apps/http/routes.provider.test.ts` — add:
  - **default `decode`** returns the bare string `"aip-2"` for
    `{"providerId":"aip-2"}` (`assert.equal`, not `deepEqual`); a missing or blank
    `providerId` → `400 invalid_input`;
  - `PUT /api/ai-provider/default` with `Content-Type: application/json` calls
    `setDefaultAiProvider` exactly ONCE with `"aip-2"` and answers `204` with an
    empty body and NO `etag` header;
  - **two consecutive identical `PUT`s** both answer `204` and call the use case
    twice — protocol-level idempotence, one write each;
  - `PUT` with `Content-Type: text/plain` → `415`; with
    `Origin: http://127.0.0.1:1` → `403 origin_not_allowed`;
  - a fake raising `LoggedOutProviderError` → `409 logged_out_provider`; one
    raising `UnknownReferenceError` → `404 unknown_reference`;
  - **credential-delete `decode`** with no query → exactly
    `{id:"aip-1", options:{}}`; with `?replacement=aip-2` →
    `{id:"aip-1", options:{replacement:"aip-2"}}`; with `?confirmNoDefault=true`
    → `{id:"aip-1", options:{confirmNoDefault:true}}`; with
    `?confirmNoDefault=false` → `400 invalid_input`; assert with `deepEqual` so an
    unexpected `confirmNoDefault: undefined` key fails;
  - `run` calls `logoutAiProvider.execute` once with `("aip-1", {…})` — assert
    BOTH arguments;
  - fakes raising `DefaultNeedsReplacementError`, `UnnecessaryReplacementError`,
    `ConflictingDefaultChoiceError` and `CorruptDefaultPointerError` map to their
    S1 codes and statuses;
  - **item-delete `decode`** with `?cascade=true&replacement=x` →
    `{id, options:{replacement:"x", cascade:true}}`, and the fake's
    `AmbiguousFlagsError` surfaces as `400 ambiguous_options`; a fake raising
    `AssignedProviderError` → `409 assigned_provider`;
  - `DELETE` with NO `Content-Type` answers `204` (the gate exempts `DELETE`);
  - `GET /api/ai-provider/default` → `404 unknown_reference` (the shadow, proved
    harmless);
  - `POST /api/ai-provider/default` → `405` with an `Allow` header containing
    `PUT` and `GET` (the router's sorted `allow`, `router.ts:84-86`).
- `node --test src/apps/http/app.test.ts` — the `OPTIONS` preflight test 023 added
  still passes; extend it (or add one) asserting
  `access-control-allow-methods` contains `PUT` for
  `/api/ai-provider/default`.
- `node --test src/apps/http/routes.test.ts` — row count 68; `PUT_ROWS` holds
  exactly `initiative.suspension.put` and `ai-provider.default.put`; 023's
  negative control still rejects an unlisted `PUT` row; the three new segments
  pass the allowlist.
- `npm run verify` exits 0.
- Proof: unblocks phases **F** and **I** of
  `scripts/e2e/http-provider-writes-proof.sh`.

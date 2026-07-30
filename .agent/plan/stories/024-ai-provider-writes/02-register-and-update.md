# Story S2 — `ai-provider.create` (`201` + `Location`) and `ai-provider.patch` (`If-Match`)

Epic: `.agent/plan/epics/024-ai-provider-writes.md` (decisions 1, 2, 3, 9)
Depends on: Story S1 (the 24 codes, `optionalBodyNumber`) and EPIC 021's
`location` / `readRow` dispatch.

Lands 2 rows. `ROUTES.length` 63 → 65.

## Change

**1. `src/apps/http/routes.ts`** — append two rows:

```
id: "ai-provider.create", method: "POST", path: "/api/ai-provider",
successStatus: 201, kind: "json", cliCommands: ["register ai-provider"]
decode: ({ body }) => …            // see the field table below
run:    async (deps, input) => deps.registerAiProvider.execute(input)
present: (id) => ({ id })
location: (id) => `/api/ai-provider/${id}`
```

```
id: "ai-provider.patch", method: "PATCH", path: "/api/ai-provider/:id",
successStatus: 200, kind: "json", cliCommands: ["update ai-provider"],
readRow: "ai-provider.get"
decode: ({ params, body }) => …
run:    async (deps, input) => deps.updateAiProvider.execute(input)
// NO `present` — the DTO comes from the readRow (021 decision 3)
```

`RegisterAiProvider.execute` returns the new id **string**
(`register-ai-provider.ts:78`), so `present` wraps it and `location` reads the
same string. Both are synchronous use cases; `run` stays `async` regardless.

**2. `decode` field mapping** — every field named literally:

`ai-provider.create` body →
`{name, provider, model, value, baseUrl?, effort?, api?, customProviderId?, contextWindow?, maxTokens?, allowInsecure?}`

- `name`, `model`, `value` — `requireBodyString`.
- `api` — `optionalBodyString`, passed through unvalidated; the allowlist check is
  `validateCustomProviderConfig`'s job (`config-validation.ts:41-47`) and its
  `InvalidApiFlavorError` is registered. Do NOT validate it in `decode`.
- **`provider` — required unless `api` is present.** When `api` is present,
  `decode` sets `provider` to the `customProviderId` it read; when `api` is
  absent, `provider` is `requireBodyString`. This keeps
  `RegisterAiProviderInput.provider` a required `string` at the call site
  (`register-ai-provider.ts:40`) — do NOT make it optional.
- `customProviderId` — `optionalBodyString`. Required-ness for the custom path is
  `validateCustomProviderConfig`'s job (`MissingCustomProviderIdError`).
- `baseUrl`, `effort` — `optionalBodyString`.
- `contextWindow`, `maxTokens` — `optionalBodyNumber` (S1).
- `allowInsecure` — `optionalBodyBool`. Never defaulted to `true`.

`ai-provider.patch` → `{id, model?, baseUrl?, effort?, api?, contextWindow?, maxTokens?, value?, allowInsecure?}`

- `id` — `requirePathParam(params, "id")`.
- everything else optional, same helpers. **No `name` and no `provider`** —
  `UpdateAiProviderInput` has neither (`update-ai-provider.ts:199-210`), and the
  CLI rejects them as unknown options (`update.test.ts:213-238`). Do not add them.
- The empty patch is NOT rejected in `decode`; `NoUpdateFieldsError`
  (`update-ai-provider.ts:253`) owns that, and S1 registered it.

**3. Wiring, all in this story** (see index.md's table):

- `src/apps/http/deps.ts` — `import type { RegisterAiProvider } …` and
  `import type { UpdateAiProvider } …`; fields
  `readonly registerAiProvider: RegisterAiProvider;` and
  `readonly updateAiProvider: UpdateAiProvider;`.
- `src/apps/cli/commands/serve.ts` — `registerAiProvider: deps.registerAiProvider,`
  and `updateAiProvider: deps.updateAiProvider,`.
- `src/composition.ts` — **no change** (both already constructed at `:262-273`
  with `modelCatalog` passed).

**4. `src/apps/http/routes.test.ts`** — row count 65; add `"ai-provider.create"`
and `"ai-provider.patch"` to the expected-id array.

## Constraints

- **`value` is never presented.** `present` on the create row returns `{id}` and
  nothing else. The patch row has NO `present`; its body is the `ai-provider.get`
  DTO, whose literal list (`views/ai-provider.ts:15-25`) has no `value`. Add no
  field to that view.
- **The `201` body is exactly `{"id":"…"}`** inside the 019 envelope. Do not
  present the whole provider — the use case never read it back.
- `readRow` is exactly the string `"ai-provider.get"`, an existing 020 row
  (`routes.ts:320-328`). The dispatcher resolves it by row id, not by path.
- `If-Match` is REQUIRED on the patch: absent → `428`, stale → `412`. That is
  021's dispatcher; this story adds no precondition logic and no logic in `run`.
- Do NOT surface `UpdateAiProvider`'s `changed` array. The response is the re-read
  DTO (epic decision 3, with the consequence recorded).
- `/api/ai-provider` already exists as a `GET` row (`routes.ts:309-317`). Adding a
  `POST` on the same path is correct; `matchRoute` separates by method
  (`router.ts:75`). Do not touch the `GET` row.
- The `PATCH` path `/api/ai-provider/:id` also matches the existing `GET` item
  row. Same rule; do not touch it.
- No `PUT`, no new `PUT_ROWS` entry.

## Verify

- `node --test src/apps/http/routes.provider.test.ts` — extend the existing file
  using its `makeDeps()` fake pattern:
  - **create `decode`**: a full custom body maps to the exact input object with
    `assert.deepEqual`, including `provider` taking the `customProviderId` value
    when `api` is present; a builtin body (no `api`) requires `provider` and a
    missing one → `400 invalid_input`; `contextWindow: "8"` →
    `400 invalid_input`; `allowInsecure` absent means the key is ABSENT from the
    input, not `false`;
  - **create `run`**: calls `registerAiProvider` exactly once with that input;
  - **create response**: `201`, body `data` is exactly `{id}` (assert
    `Object.keys` equals `["id"]`), and `location` is
    `/api/ai-provider/<returned id>`;
  - **no secret**: a fake `registerAiProvider` that returns an id while the
    paired `getAiProvider` fake returns a record carrying
    `value: "sk-LEAK"` — the `201` body and the followed read DTO both lack
    `value`, and `"sk-LEAK"` appears in neither;
  - **patch `decode`**: `{model:"m2"}` maps to `{id:"aip-1", model:"m2"}` exactly;
    a blank `:id` → `400 invalid_input`; `{}` maps to `{id:"aip-1"}` and the
    fake's `NoUpdateFieldsError` surfaces as `400 no_update_fields`;
  - **patch preconditions**: no `If-Match` → `428 precondition_required` and
    `updateAiProvider` called ZERO times; a wrong validator → `412` and ZERO
    calls; the matching validator → `200`, ONE call, a body equal to the
    `ai-provider.get` DTO and an `etag` header different from the one sent;
  - **patch never leaks**: with `{value:"sk-NEW"}` in the request, the `200` body
    contains neither `"sk-NEW"` nor a `value` key;
  - each registered error class raised by a fake maps to its S1 code:
    `EmptyValueError` → `400 empty_value`, `UnknownModelError` →
    `400 unknown_model`, `InsecureEndpointError` → `400 insecure_endpoint`,
    `StaleCredentialError` → `409 stale_credential`,
    `BuiltinProviderFieldError` → `400 builtin_provider_field`,
    `LoggedOutProviderError` → `409 logged_out_provider`;
  - `POST /api/ai-provider` with `Content-Type: text/plain` → `415`; with
    `Origin: http://127.0.0.1:1` → `403 origin_not_allowed`.
- `node --test src/apps/http/routes.test.ts` — row count 65; both ids present;
  `location` is a function iff `successStatus === 201`; `readRow` is set iff
  `method === "PATCH"` and names a real `GET` row; `present` is absent on the
  patch row and present on the create row.
- `npm run verify` exits 0.
- Proof: unblocks phase **C** of `scripts/e2e/http-provider-writes-proof.sh` and
  the `PATCH` half of phase **G**. Phases D-F and I still fail — expected.

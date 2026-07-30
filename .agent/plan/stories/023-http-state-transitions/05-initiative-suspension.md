# Story S5 — the initiative suspension singleton (`PUT` / `DELETE`)

Epic: `.agent/plan/epics/023-http-state-transitions.md`
Depends on: Story S1 (`HttpMethod` accepts `PUT`, `PUT_ROWS` exists, the
`suspension` segment is allowlisted, `allowMethods` advertises `PUT`).

Lands 2 rows. `ROUTES.length` 61 → 63. This is the story that makes S1's `PUT`
admission load-bearing.

## Change

**1. `src/apps/http/routes.ts`** — append two rows before the closing `];`. Both
answer `204`, so NEITHER declares `present`, and neither has a body:

```
id: "initiative.suspension.put", method: "PUT",
path: "/api/initiative/:id/suspension", successStatus: 204, kind: "json",
cliCommands: ["pause initiative"]
decode: ({ params }) => ({ initiativeId: requirePathParam(params, "id") })
run:    async (deps, input) => deps.pauseInitiative.execute(input)
```

```
id: "initiative.suspension.delete", method: "DELETE",
path: "/api/initiative/:id/suspension", successStatus: 204, kind: "json",
cliCommands: ["resume initiative"]
decode: ({ params }) => ({ initiativeId: requirePathParam(params, "id") })
run:    async (deps, input) => deps.resumeInitiative.execute(input)
```

The row id `initiative.suspension.put` must match the single entry of `PUT_ROWS`
(`routes.test.ts`, added in S1) character for character, or the policy test fails.

Input shape source: `PauseInitiative.execute({ initiativeId })`
(`src/app/initiative/pause-initiative.ts:21`) and `ResumeInitiative.execute`
(`resume-initiative.ts:21`). Both take `initiativeId`, NOT `id`.

**2. Wiring, all in this story:**

- `src/apps/http/deps.ts` —
  `import type { PauseInitiative } from "../../app/initiative/pause-initiative.ts";`
  and `import type { ResumeInitiative } from "../../app/initiative/resume-initiative.ts";`;
  fields `readonly pauseInitiative: PauseInitiative;` and
  `readonly resumeInitiative: ResumeInitiative;`.
- `src/apps/cli/commands/serve.ts` — `pauseInitiative: deps.pauseInitiative,` and
  `resumeInitiative: deps.resumeInitiative,` (already on `CliDeps` at
  `src/apps/cli/deps.ts:186-187`).
- `src/composition.ts` — **no change**.

**3. `src/apps/http/routes.test.ts`** — row count 63; add
`"initiative.suspension.put"` and `"initiative.suspension.delete"` to the
expected-id array.

## Constraints

- `PUT` appears on this row and nowhere else. Do not convert any 021 dependency
  row to `PUT`, do not add a second `PUT_ROWS` entry, and do not delete S1's
  negative control.
- Both rows answer `204`: no `present`, no body, no `ETag`.
- No `If-Match` and no `readRow`. Pausing names an ABSOLUTE target state, so
  last-write-wins is the accepted semantics (epic decision 2, with the risk
  recorded). Do not add a precondition.
- The suspension has NO representation in this epic: do NOT add
  `GET /api/initiative/:id/suspension`. The state is read as `paused` on
  `GET /api/initiative/:id` (`src/apps/http/views/initiative.ts:14,34`).
- `PauseInitiative` / `ResumeInitiative` are unchanged. They already 404 on an
  unknown id and 400 on a wrong kind (`pause-initiative.ts:22-27`), whose codes
  019 and 021 registered.
- A body-less `PUT` still requires `Content-Type: application/json`
  (`app.ts:170`); `DELETE` is exempt (`app.ts:170-176`). Do not relax either.

## Verify

- `node --test src/apps/http/routes.initiative.test.ts` — add, using the file's
  existing `makeDeps()` fake pattern:
  - `decode` for both rows produces exactly `{ initiativeId: "i1" }`
    (`assert.deepEqual`), and a blank `:id` → `400 invalid_input`;
  - `PUT /api/initiative/i1/suspension` with `Content-Type: application/json` and
    body `{}` calls `pauseInitiative` exactly ONCE, calls `resumeInitiative` zero
    times, and answers `204` with an empty body and NO `etag` header;
  - two consecutive `PUT`s both answer `204` and call `pauseInitiative` twice
    (idempotent at the protocol level, one write in the use case);
  - `DELETE /api/initiative/i1/suspension` with NO `Content-Type` answers `204`
    and calls `resumeInitiative` once;
  - two consecutive `DELETE`s both answer `204`;
  - `PUT` with `Content-Type: text/plain` → `415 unsupported_media_type`;
  - `PUT` with `Origin: http://127.0.0.1:1` → `403 origin_not_allowed`;
  - a fake raising `UnknownReferenceError` → `404 unknown_reference`; one raising
    `WrongTypeReferenceError` → `400 wrong_type_reference`;
  - `POST /api/initiative/i1/suspension` → `405` with an `Allow` header
    containing both `DELETE` and `PUT` (the router's sorted `allow`,
    `router.ts:80-86`).
- `node --test src/apps/http/app.test.ts` — add ONE test: an `OPTIONS` preflight
  for `PUT` (`.options("/api/initiative/i1/suspension")` with
  `Origin: http://127.0.0.1:4100` and
  `Access-Control-Request-Method: PUT`) has `access-control-allow-methods`
  containing `PUT`. This is the only guard on `app.ts:153`; without it the
  `allowMethods` edit is untested.
- `node --test src/apps/http/routes.test.ts` — row count 63; the `PUT` policy test
  now passes with a REAL `PUT` row present, and the negative control still
  rejects a second one.
- `npm run verify` exits 0.
- Proof: unblocks phase **G** of `scripts/e2e/http-transitions-proof.sh`, and the
  unauthenticated-`PUT` assertion in phase **I**.

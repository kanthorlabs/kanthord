# Story S4 — the project chain: assign (`POST` + `rank`) and unassign (`DELETE`)

Epic: `.agent/plan/epics/024-ai-provider-writes.md` (decision 7)
Depends on: Story S1 (`optionalBodyNumber`, `duplicate_assignment`,
`invalid_rank`).

Lands 2 rows. `ROUTES.length` 68 → 70.

## Change

**1. `src/apps/http/routes.ts`** — append two rows, both `204`, neither with
`present`:

```
id: "project.ai-provider.create", method: "POST",
path: "/api/project/:id/ai-provider",
successStatus: 204, kind: "json", cliCommands: ["assign ai-provider"]
decode: ({ params, body }) => ({
  projectId: requirePathParam(params, "id"),
  providerId: requireBodyString(body, "providerId"),
  ...(rank !== undefined ? { rank } : {}),        // optionalBodyNumber
})
run:    async (deps, input) => deps.assignAiProvider.execute(input)
```

```
id: "project.ai-provider.delete", method: "DELETE",
path: "/api/project/:id/ai-provider/:providerId",
successStatus: 204, kind: "json", cliCommands: ["unassign ai-provider"]
decode: ({ params }) => ({
  projectId: requirePathParam(params, "id"),
  providerId: requirePathParam(params, "providerId"),
})
run:    async (deps, input) => deps.unassignAiProvider.execute(input)
```

Input shape source: `AssignAiProvider.execute({projectId, providerId, rank?})`
(`assign-ai-provider.ts:359-363`) and
`UnassignAiProvider.execute({projectId, providerId})`
(`unassign-ai-provider.ts:425-428`). Both take `projectId` and `providerId`, NOT
`id` and `provider`. Both are synchronous and return `void`.

**2. The asymmetry is deliberate — do not "fix" it** (epic decision 7, Ulrich
2026-07-30). `POST` adds a member that does not exist yet, so the member id
travels in the **body**; naming it in the path is `PUT`'s idiom. `DELETE`
addresses a member that already exists, so it names it in the **path**. `:id` in
the `POST` path is the parent project. Do not add
`POST /api/project/:id/ai-provider/:providerId`, and do not move `providerId`
out of the `DELETE` path.

**3. Wiring, all in this story:**

- `src/apps/http/deps.ts` — `import type` and `readonly` fields for
  `AssignAiProvider` and `UnassignAiProvider`.
- `src/apps/cli/commands/serve.ts` — `assignAiProvider: deps.assignAiProvider,`
  and `unassignAiProvider: deps.unassignAiProvider,`.
- `src/composition.ts` — **no change**.

**4. `src/apps/http/routes.test.ts`** — row count 70; add
`"project.ai-provider.create"` and `"project.ai-provider.delete"` to the
expected-id array.

## Constraints

- `/api/project/:id/ai-provider` already exists as a `GET` row
  (`routes.ts:331-342`, `project.ai-provider.list`). Adding a `POST` on the same
  path is correct — 021 does the same for `/api/project` — and `matchRoute`
  separates them by method (`router.ts:75`). Do not touch the `GET` row; it is
  how the chain is read back, including its order.
- Both rows answer `204`: no `present`, no body, no `ETag`. An assignment has no
  representation of its own, so a `201` + `Location` would point at a path that
  404s (the 021 decision-4 exception, applied).
- `rank` is an OPTIONAL body number. Omitted, `AssignAiProvider` appends at
  `maxRank + 1` (`assign-ai-provider.ts:400-401`); supplied, it shifts and
  inserts (`:409-410`). `decode` passes it through — the negative-rank rejection is
  `InvalidRankError`'s job (`:404-406`), registered in S1. Do not range-check in
  `decode`, and do not default `rank` to `0`.
- **Re-ranking an existing assignment is NOT supported.** A second `POST` for the
  same pair raises `DuplicateAssignmentError` (`:395-397`) → `409`. Do not add an
  upsert, and do not add an `UpdateAssignment` use case; moving a provider is
  `DELETE` then `POST` with the new rank (epic non-goal).
- **`DELETE` is idempotent** — `UnassignAiProvider` no-ops on a missing row and
  then compacts ranks (`unassign-ai-provider.ts:459-461`). A repeated `DELETE`
  answers `204` again. Do not add a 404 for "not assigned".
- Both use cases validate the project AND the provider
  (`assign-ai-provider.ts:385-392`), so a bad id in either position is
  `404 unknown_reference` — already registered by 019.
- No `PUT` row, no `PUT_ROWS` entry, no bulk reorder (epic non-goal: no use case
  takes an ordered list).
- Leave both use cases unchanged.

## Verify

- `node --test src/apps/http/routes.provider.test.ts` — add:
  - **assign `decode`** with `{"providerId":"aip-1"}` → exactly
    `{projectId:"p1", providerId:"aip-1"}` (`deepEqual`, so a stray
    `rank: undefined` fails); with `{"providerId":"aip-1","rank":0}` → the same
    plus `rank: 0` (proving `0` is carried, not treated as absent);
  - a missing or blank `providerId` → `400 invalid_input`; a blank `:id` →
    `400 invalid_input`; `{"providerId":"a","rank":"0"}` → `400 invalid_input`;
  - `run` calls `assignAiProvider` exactly ONCE with that input and
    `unassignAiProvider` zero times;
  - the response is `204` with an empty body and NO `etag` header;
  - **unassign `decode`** → exactly `{projectId:"p1", providerId:"aip-1"}`; a
    blank `:providerId` → `400 invalid_input`;
  - two consecutive `DELETE`s both answer `204` and call the use case twice;
  - `DELETE` with NO `Content-Type` answers `204`;
  - a fake raising `DuplicateAssignmentError` → `409 duplicate_assignment`; one
    raising `InvalidRankError` → `400 invalid_rank` whose message contains no
    `--`; one raising `UnknownReferenceError` → `404 unknown_reference`;
  - `POST` with `Content-Type: text/plain` → `415`; with
    `Origin: http://127.0.0.1:1` → `403 origin_not_allowed`;
  - `PUT /api/project/p1/ai-provider` → `405` with an `Allow` header containing
    `GET` and `POST` (proves no `PUT` row was added here).
- `node --test src/apps/http/routes.test.ts` — row count 70; both ids present;
  the no-plural and verb-ban assertions pass over both paths; `PUT_ROWS` still
  holds exactly two entries.
- `npm run verify` exits 0.
- Proof: unblocks phase **E** of `scripts/e2e/http-provider-writes-proof.sh`,
  including the ordered-chain readback and the `source` flip from `default` to
  `assigned` that phase E asserts against `GET /api/project/:id/readiness`.

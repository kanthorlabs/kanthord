# Story S5 — `initiative.patch` accepts `paused`

Epic: `.agent/plan/epics/025-serve-hosted-daemon.md` (Decisions 5, 7, 14)
Depends on: Story S4 (the row calls `UpdateInitiative`)

## Change

### 1. `src/apps/http/routes.ts:545-558` — replace the row body

Keep `id`, `method`, `path`, `successStatus`, `kind`, `readRow` exactly as they
are. Change `cliCommands`, `decode`, `run`:

```ts
  defineRoute({
    id: "initiative.patch",
    method: "PATCH",
    path: "/api/initiative/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["rename initiative", "pause initiative", "resume initiative"],
    readRow: "initiative.get",
    decode: ({ params, body }) => {
      const name = optionalBodyString(body, "name");
      const paused = optionalBodyBool(body, "paused");
      return {
        id: requirePathParam(params, "id"),
        ...(name !== undefined ? { name } : {}),
        ...(paused !== undefined ? { paused } : {}),
      };
    },
    run: async (deps, input) => deps.updateInitiative.execute(input),
  }),
```

`optionalBodyString` and `optionalBodyBool` are already imported by this file
(`optionalBodyBool` is used by `project.initiative.create` at `:537`). The
conditional-spread idiom matches `repository.patch:686-695`.

`decode` validates **shape only**. The empty patch is rejected by
`UpdateInitiative` with `NoUpdateFieldsError` → `400 no_update_fields` (Story S4),
which is EPIC 024's convention and gives the CLI the same guard.

Behaviour this pins, all already true of the decoders:

- `paused: null` → `optionalBodyBool` throws `InvalidInputError` (`body.ts:74-76`);
- `paused: "yes"` → same;
- `name: "   "` → `optionalBodyString` trims and rejects blank;
- an absent field is left out of the input entirely, so `UpdateInitiative` leaves
  it unchanged. Never coerced to `false`.

### 2. `src/apps/http/deps.ts` — add the dependency

Import beside `RenameInitiative` (`:24`); field beside `renameInitiative` (`:75`):

```ts
  readonly updateInitiative: UpdateInitiative;
```

`renameInitiative` **stays** on `HttpDeps`. No row uses it after this change, but
removing it is out of scope and would touch `serve.ts` twice. Leave it.

### 3. `src/apps/cli/commands/serve.ts:63` — add the field

Insert after `renameInitiative: deps.renameInitiative,`:

```ts
          updateInitiative: deps.updateInitiative,
```

### 4. `src/apps/http/cli-coverage.test.ts` — apply the delta

This row claims two more leaves, so the uncovered count drops by **2**. At
authoring the assertion at `:143-150` is `26`, making it `24`; if 022–025 ran
first it will be lower — apply the delta to whatever is asserted, and update the
comment on `:148` to name 025's claims. S6 takes it down one more.

## Constraints

- `ROUTES.length` does NOT change in this story — no row is added. Leave the
  assertion at `routes.test.ts:299-300` alone; S6 applies the `+1`.
- Do not add a `present` — the route-policy test forbids it on a `readRow` row
  (`routes.test.ts:180-192`).
- Do not add a path segment. `pause` and `resume` are in `BANNED_VERBS`
  (`routes.test.ts:19-20`); the PATCH row is the only sanctioned shape.
- Do not touch the dispatcher. `If-Match`, the `200` and the fresh `ETag` come
  from `src/apps/http/app.ts:222-247` unchanged, and `initiativeView` already
  emits `paused` so the validator moves on its own.

## Verify

- `node --test src/apps/http/routes.write-planning.test.ts` — extend `makeDeps()`
  with an `updateInitiativeRec` recorder and mutable local `paused` state so the
  read row's DTO (and its ETag) reflects a write. Mirror the triple at `:340-377`.
  New cases, each with a CURRENT `If-Match` unless stated:
  - no `If-Match` + `{"paused":false}` → **428**, recorder calls 0;
  - stale `If-Match` → **412**, recorder calls 0;
  - unknown id, no `If-Match` → **404** (the pre-read runs first — locks the order);
  - `{}` → **400** with code `no_update_fields`, thrown by the fake use case
    (the recorder IS called — the guard is in the use case, not `decode`);
  - `{"paused":null}` → **400** `invalid_input`, recorder calls 0 (shape, in
    `decode`); `{"paused":"yes"}` → same;
  - `{"name":"   "}` → **400** `invalid_input`, recorder calls 0;
  - `{"paused":false}` → **200**, recorder received exactly `{id, paused:false}`
    with no `name` key, response ETag differs from the sent one;
  - `{"name":"x"}` → **200**, recorder received exactly `{id, name:"x"}` with no
    `paused` key;
  - `{"name":"x","paused":true}` → **200**, recorder received all three keys;
  - repeated `{"paused":true}` → **200** both times.
- `node --test src/apps/http/routes.test.ts` — the policy suite passes unchanged
  and `ROUTES.length` is unchanged by this story.
- `node --test src/apps/http/cli-coverage.test.ts` — every claimed leaf exists in
  the Commander tree (the walker produces exactly `"pause initiative"` and
  `"resume initiative"`), and the uncovered count dropped by 2.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-execution-proof.sh` phases **D**, **D2**, **E**, **F**, **G**.

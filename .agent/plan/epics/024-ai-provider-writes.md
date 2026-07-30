# EPIC 024 — ai-provider writes: a project can reach `configured` over HTTP

> Authored 2026-07-30, on top of EPIC 021 (planning writes, 52 rows), EPIC 022
> (event feed, commit `5dd1374`, 54 rows) and EPIC 023 (state transitions, +9 →
> 63 rows). 024 adds writes only: EPIC 020 already shipped
> `GET /api/ai-provider`, `GET /api/ai-provider/:id`,
> `GET /api/project/:id/ai-provider` and `src/apps/http/views/ai-provider.ts`.
>
> **Why this precedes the job API (EPIC 026).** When the resolved provider chain
> is empty, `run-next-task` does not attempt the task at all — it fails it with
> `no_provider_available` before calling the runner
> (`src/app/task/run-next-task.ts:289-295`). And `ai_provider` is one of the four
> blocking config checks (`src/app/project/project-readiness.ts:45-50`,
> `evalAiProvider` at :277-305). A UI that can start the daemon (026) but cannot
> register a provider starts a daemon that fails every task on the first tick.
> Setup precedes execution. This is why `retirement.md`'s old "Target 024 —
> high-impact operations" is split: the provider writes land here as Target 024,
> and `land repository` / `publish repository` become Target 027 (delivery).
> The roadmap order is 024 provider writes → 025 frontend host → 026 job API →
> 027 delivery (Ulrich, 2026-07-30).

## Goal

The running `kanthord serve` program answers every **ai-provider write**:
register a provider with a URL and an API key, edit its config, rotate or delete
its secret, repoint the global default, put a provider into a project's ordered
chain, take it out again, delete it, probe it for readiness, and send it a real
prompt to read the model's own answer back. After 024 an operator can take a
fresh database from empty to
`GET /api/project/:id/readiness` reporting `configured: true` without touching a
terminal — the last configuration gate the UI could not pass. The provider
secret travels in the request body exactly as 021's `create credential` does and
is never presented back, in any response or any log line.

## Decisions (binding; do not re-open at build time)

### 0. What 024 inherits and may NOT re-open

Everything 019/020/021/022/023 settled. Named, so no story re-derives it:

- **Singular path segments** and the `PATH_SEGMENTS` allowlist with the
  `NOT_PLURAL` escape hatch (`src/apps/http/routes.test.ts:42-68`).
  `ai-provider` and `credential` are already allowlisted; 024 adds three
  segments (decision 8).
- **`defineRoute` / `RouteDefinition<Input, Output>`** (`routes.ts:52-96`). No
  per-row `as` cast, no `route.present!`.
- **`POST` on a collection → `201` + `location?: (result) => string`** pointing
  at a real readable route; **`PATCH` on an item → `readRow?: string`,
  `If-Match` REQUIRED** (`428` absent, `412` stale), answering `200` with the
  re-read DTO and a fresh `ETag`; **a sub-resource toggle → `204`**, no body, no
  `ETag`; **`DELETE` → `204`**.
- **Every `200` `kind:"json"` response carries `ETag`** (`src/apps/http/etag.ts`,
  added by 021).
- **One view module per resource** with a LITERAL field list, no `domain/`
  import, no object spread.
- **The error registry holds only what a row can raise** (019 decision 11).
- The 019 envelope, Basic auth and the eight middleware in their existing order.
  024 adds no middleware and reorders none.
- **`PUT` is legal only for a row with its own reviewed entry in `PUT_ROWS`**
  (`src/apps/http/routes.test.ts`, created by 023 holding
  `initiative.suspension.put`). 024 adds exactly one `PUT` row and therefore
  exactly one `PUT_ROWS` entry — see decision 4. It edits no 023 plan file: the
  allowlist is a test const, and adding to it in 024's own story IS the
  discipline 023 asked for.

### 1. Registration is URL + key. The OAuth device flow is NOT in this epic

`RegisterAiProvider.execute` takes `{name, provider, model, value, baseUrl?,
effort?, api?, customProviderId?, contextWindow?, maxTokens?, allowInsecure?}`
and returns the new id synchronously (`register-ai-provider.ts:78-179`). It has
one credential input: `value`, a string. Nothing in it talks to an OAuth
endpoint, opens a browser, or polls a device code. The custom
OpenAI-compatible path (`008.1-custom-openai-compatible-provider.md`) is the
same shape with `api` + `customProviderId` + `baseUrl`.

**Binding boundary:** `POST /api/ai-provider` covers `register ai-provider` in
full and nothing else. `login provider` — the OAuth device flow — is EPIC 026's
problem, because it is a long-lived interactive flow with no request/response
shape, and `retirement.md` still records it as "deliberately unresolved: whether
it can run behind the API at all". 024 does not register
`NonOAuthProviderError`: only `LoginProvider` throws it
(`src/app/auth/login-provider.ts`), and no 024 row calls that use case.

### 2. The credential path: `value` in the body, never on the way back

Mirrors 021's `project.credential.create` exactly.

- `value` is a request-body field on `POST /api/ai-provider` (required) and on
  `PATCH /api/ai-provider/:id` (optional — the rotation path,
  `update-ai-provider.ts:332-340`). The CLI reads it from `--value-file
<path|->`, which has no HTTP twin.
- **It is never presented.** The app-layer view has no `value` field
  (`src/app/ai-provider/ai-provider-view.ts` — the header comment says so
  explicitly), and the HTTP view's literal list is exactly **`id`, `name`,
  `provider`, `model`, `baseUrl`, `effort`, `state`, `isDefault`**
  (`src/apps/http/views/ai-provider.ts:15-25`). 024 adds no field to either.
  There is nothing to remove and nothing to add — the guarantee is that this
  list stays literal and unchanged.
- The Proof asserts the registered secret and the rotated secret appear in **no
  response body and no log line** (phase J). This is an assertion, not an
  assumption: `src/apps/http/logger.ts` has no redactor, so the guarantee comes
  from the logger never logging request bodies, and the Proof is what proves it.

### 3. The nine rows, and why each has the shape it has

| id                              | path                                       | method | status | use case               | claims CLI leaf           |
| ------------------------------- | ------------------------------------------ | ------ | ------ | ---------------------- | ------------------------- |
| `ai-provider.create`            | `/api/ai-provider`                         | POST   | 201    | `RegisterAiProvider`   | `register ai-provider`    |
| `ai-provider.patch`             | `/api/ai-provider/:id`                     | PATCH  | 200    | `UpdateAiProvider`     | `update ai-provider`      |
| `ai-provider.delete`            | `/api/ai-provider/:id`                     | DELETE | 204    | `RemoveAiProvider`     | `remove ai-provider`      |
| `ai-provider.default.put`       | `/api/ai-provider/default`                 | PUT    | 204    | `SetDefaultAiProvider` | `set-default ai-provider` |
| `ai-provider.credential.delete` | `/api/ai-provider/:id/credential`          | DELETE | 204    | `LogoutAiProvider`     | `logout ai-provider`      |
| `ai-provider.probe.create`      | `/api/ai-provider/:id/probe`               | POST   | 200    | `ProbeAiProvider`      | —                         |
| `ai-provider.completion.create` | `/api/ai-provider/:id/completion`          | POST   | 200    | `TestAiProvider`       | `test ai-provider`        |
| `project.ai-provider.create`    | `/api/project/:id/ai-provider`             | POST   | 204    | `AssignAiProvider`     | `assign ai-provider`      |
| `project.ai-provider.delete`    | `/api/project/:id/ai-provider/:providerId` | DELETE | 204    | `UnassignAiProvider`   | `unassign ai-provider`    |

Nine rows, nine use cases, one `run` line each. `kind` is `"json"` on every row
(the five `204` rows send no body; `kind` still declares the envelope family for
the error path).

**`ai-provider.create` → `201` + `Location: /api/ai-provider/<id>`.**
`RegisterAiProvider.execute` returns only the new id string
(`register-ai-provider.ts:78`), so the body is the identity DTO `{"id":"…"}`,
exactly as 021 decision 1 fixed it. The `Location` points at the 020 row
`ai-provider.get`, which is a real readable route.

**`ai-provider.patch` uses `readRow: "ai-provider.get"` and requires
`If-Match`.** `UpdateAiProvider.execute` returns `{id, changed: string[]}`
(`update-ai-provider.ts:213`), but the response is the **re-read DTO**, not that
object — 021 decision 3 made the PATCH response come from the paired GET row, and
a PATCH row declares no `present` of its own. **Consequence, stated so nobody is
surprised: the `changed` array is not on the wire.** That is acceptable: `changed`
exists so the CLI can print `ai-provider updated: aip-1 (model)`; an HTTP client
gets the whole new representation plus a new `ETag`, which strictly dominates a
list of field names.

**`ai-provider.delete` → `204`, and its three escapes are QUERY parameters.**
`RemoveAiProvider.execute(id, {replacement?, confirmNoDefault?, cascade?})`
needs them (`remove-ai-provider.ts:623-757`). A `DELETE` request body is poorly
supported across clients and proxies, and 019's content-type gate exempts
`DELETE` (`app.ts:170-176`) precisely because it is body-less. So:
`DELETE /api/ai-provider/:id?replacement=<id>&confirmNoDefault=true&cascade=true`.
`decode` reads them with the existing `optionalQueryString` and a strict
`optionalQueryBool` helper that accepts only the literal `"true"` — **never a
default**, per `retirement.md`'s rule that a human-gated operation keeps its
`--yes`-equivalent as an explicit request field. Absent means absent, so
`UnnecessaryReplacementError` and `DefaultNeedsReplacementError` stay reachable
and keep protecting the caller.

**`ai-provider.probe.create` is a `POST` returning `200`** — see decision 6.

### 4. `set-default` is a `PUT` on the default-pointer singleton

`set-default` is in `BANNED_VERBS` (`routes.test.ts:34`), so it can never be a
path segment. The shape is:

```
PUT /api/ai-provider/default   → 204   body {"providerId": "<id>"}
```

**`PUT`, and the target id is in the body** (Ulrich, 2026-07-30). Two rules meet
here and both point the same way:

1. A request that names the affected member in the path and carries an empty
   body is `PUT`'s idiom, not `POST`'s — so the provider id belongs in the body.
2. `/api/ai-provider/default` is a **singleton whose whole representation is
   "which provider is default"**. Replacing that representation wholesale is the
   textbook `PUT`: idempotent, and idempotent _in the protocol_ where clients,
   retries and intermediaries can see it — not merely idempotent by accident in
   `SetDefaultAiProvider.execute` (`set-default-ai-provider.ts:480-489`). This is
   the same argument 023 accepted for `PUT …/suspension`, applied to a singleton
   that carries a body rather than one whose mere existence is the state.

**The `PUT_ROWS` entry is 024's own.** 023 admits `PUT` gated by an allowlist in
`routes.test.ts`, requiring "a human adds a reviewed entry" per row. 024 adds
exactly one: `ai-provider.default.put`. That allowlist is a **test const**, so no
023 plan file is edited and the two epics never contend for a file. 023 also
already widens `@koa/cors`'s `allowMethods` to include `PUT` (`app.ts:153`) and
confirms `requiresJsonContentType` / `requiresOriginCheck` already list `PUT`
(`app.ts:26-39`) — this row carries a body, so the media-type gate is satisfied
naturally.

Rejected alternatives, each on a rule rather than on taste:

- **`POST /api/ai-provider/:id/default` with an empty body** — the form rule 1
  rules out. The member id belongs in the body.
- **`POST /api/ai-provider/default` with the id in the body** — legal and it was
  024's shape until this decision. Rejected because it hides the idempotence rule
  2 names: repointing the default twice with the same body is one outcome, and
  `PUT` says so.
- **`isDefault: true` as a `PATCH /api/ai-provider/:id` field** —
  `UpdateAiProvider` has no `isDefault` input and deliberately never touches the
  default pointer, so the row's `run` would have to choose between
  `UpdateAiProvider` and `SetDefaultAiProvider` at request time. That is logic
  inside `run`, which `RouteDefinition` forbids (`routes.ts:62-68`), and no
  app-layer facade may launder it — a use case never calls a use case (AGENTS.md).
  This is the same rejection 023 made for `PATCH …{"paused":true}`.

**The path shadow, verified in `router.ts` and not assumed.**
`/api/ai-provider/default` also matches `GET /api/ai-provider/:id`, because
`matchSegments` binds any segment to `:id` (`router.ts:40-46`). `matchRoute`
then selects by method (`router.ts:75`), so:

- `PUT /api/ai-provider/default` resolves to this row — no `PUT
/api/ai-provider/:id` row exists to compete.
- `GET /api/ai-provider/default` resolves to the item row with `id="default"`
  and answers `404 unknown_reference`. Harmless, because ids are 26-character
  ULIDs and can never equal `default`.

A route-policy test asserts both: that `PUT /api/ai-provider/default` matches
exactly one row, and that no other row shares that method and path shape.

**`DELETE /api/ai-provider/default` is deliberately NOT a row.** Clearing the
default is not a standalone use case: `clearDefault` is only reachable through
`logout`/`remove` with `confirmNoDefault` (`logout-ai-provider.ts:585`,
`remove-ai-provider.ts:729`), and inventing a use case for it here is out of
scope.

### 5. `logout` is `DELETE …/credential`, not a state PATCH

Given 012's explicit-activation semantics, `logout` means exactly one thing: the
stored secret is dropped and the record survives with `state:"logged_out"`
(`logout-ai-provider.ts:591`). That is the deletion of a sub-resource — the
credential — with the parent left in place. So:

`DELETE /api/ai-provider/:id/credential?replacement=<id>&confirmNoDefault=true`
→ `204`.

- **Rejected — `PATCH /api/ai-provider/:id` with `state: "logged_out"`.**
  `UpdateAiProvider` _refuses_ a `logged_out` row outright
  (`update-ai-provider.ts:262-265`) and has no `state` field; the PATCH row
  would again need two use cases behind one `run`. Same rule as decision 4.
- A `DELETE` naming an existing member in the path is correct REST — decision 4's
  ruling is about `POST`, and here the credential already exists.
- **The symmetry is the argument for the path.** `PATCH /api/ai-provider/:id`
  with `{"value":"…"}` _rotates_ the credential; `DELETE
/api/ai-provider/:id/credential` _removes_ it. One noun, two verbs in the
  method. `credential` is already an allowlisted segment; it means the same thing
  here as in `/api/project/:id/credential` — a stored secret — so reusing it is
  correct, not a collision.
- The two escapes are query parameters for the same reason as decision 3, and
  `LogoutAiProvider` is idempotent **only when called with no flags**
  (`logout-ai-provider.ts:539-556`) — a flag that cannot apply is rejected, by
  design. The HTTP surface inherits that, unchanged.

### 6. Two outbound rows, because a readiness probe and a model test are opposite contracts

These are the **only two routes in the whole HTTP surface allowed to make a real
outbound call**. 021 deliberately did not expose `check project --probe-*` for
exactly this reason (021 decision 6), and these rows are where that debt is paid.

```
POST /api/ai-provider/:id/probe        → 200  {"id","status":"ok"|"failed","detail"}
POST /api/ai-provider/:id/completion   → 200  {"id","prompt","reply"}      body {"prompt"?: "…"}
```

In both, `:id` is the **parent** provider and the segment names the created
child — the ordinary `POST /parent/:id/child` form, which 023's nine transition
rows also use (`POST /api/task/:id/approval`). Decision 4's ruling does not
reach either: no member id is named in a path (Ulrich confirmed the scope,
2026-07-30).

**Why two rows and not one** (Ulrich, 2026-07-30: "turn `test ai-provider` into
an API too"). One row cannot serve both, and the reason is a contract conflict,
not a preference:

|                     | `…/probe` (`ProbeAiProvider`)                | `…/completion` (`TestAiProvider`)                               |
| ------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| prompt              | fixed `PROVIDER_PROBE_PROMPT`                | caller's, defaulting to the CLI's `"What is today's datetime?"` |
| success body        | fixed `"provider answered the probe prompt"` | **the model's reply, verbatim**                                 |
| failure             | never throws → `200 {status:"failed"}`       | throws → mapped, see below                                      |
| secret in a failure | redacted, first line, 300-char cap           | must be redacted by the same means                              |
| audience            | the readiness screen, called on every visit  | the operator's "does this key work" button                      |

Serving both from one row would mean `run` choosing a use case from whether a
`prompt` arrived — the logic `RouteDefinition.run` forbids (`routes.ts:62-68`) —
and no app-layer facade may launder it, since a use case never calls a use case
(AGENTS.md). It is the same rejection decision 4 and 5 already made twice.

**`…/probe` keeps every safety property**, and the code argues for it
(`src/app/project/probe-ai-provider.ts:9-16`): it never throws, so _a probe that
fails is a successful probe with a negative result, not a `500`_, needing no
error-registry entry for a dead endpoint or a bad key; it redacts the resolved
secret from the failure detail (`makeRedactor`, :72), takes the first line only,
and caps it at 300 characters, so a provider that echoes the key into an error
message cannot leak it.

**`…/completion` returns the reply verbatim, and that forces two requirements:**

1. **A registered failure code, with a fixed message.** `TestAiProvider.execute`
   delegates straight to `ProviderProbe.probe` (`test-ai-provider.ts:777-779`)
   and does not catch, so a dead endpoint or a rejected key throws. Unmapped, it
   would answer `500 internal`. 024 registers
   `ProviderCallFailedError` → `provider_call_failed` → **`502`**, with an
   explicit registry `message` — never the raw error text, which can carry the
   Authorization header.
2. **The same redaction as the probe, in the app layer.** `TestAiProvider` has no
   redactor today. 024 gives it the same `ProviderSecretOf` accessor
   `ProbeAiProvider` already takes (`probe-ai-provider.ts:36,48`) and wraps its
   failure in `ProviderCallFailedError` with a redacted, first-line,
   300-char-capped message. The reply on the success path is NOT capped — an
   operator asking a model a question wants the answer — but it is **never
   logged**, and the Proof asserts that.

   The accessor already exists inline in the composition root as
   `(id) => aiProviderRegistry.get(id)?.value ?? null` (`composition.ts:303`,
   feeding `ProbeAiProvider`), and `TestAiProvider` is constructed one line above
   it (`:301`) — so the change is to pass the same arrow to both. It stays an
   **arrow wrapper**, never a bare method reference: AGENTS.md forbids the latter
   because it loses `this` and crashes on the adapter's `#private` fields.

**The reply is returned verbatim and uncapped. Stated as a known cost:** a model
that answers with megabytes produces a megabyte response. Acceptable, because
this row is an operator action on a settings screen, not a hot path, and capping
the answer would defeat the leaf it exists to cover. Revisit if it ever backs a
UI that calls it unattended.

**Timeout — the app-layer change 024 needs, now on both use cases.**
`ProviderProbe.probe`
(`src/agent-runner/port.ts:7-9`) has no timeout and no `AbortSignal`, so a hung
endpoint would hold an HTTP request open forever. 024 adds an optional second
argument: `ProbeAiProvider.execute(providerId, options?: {timeoutMs?: number})`,
racing the tester against a timer and returning
`{status:"failed", detail:"probe timed out after 30s"}` when the timer wins. The
HTTP row binds `timeoutMs: 30000` literally in `decode` (Ulrich confirmed the
value, 2026-07-30) — **not** caller-supplied, so no client can hold a server
request open for an hour. `TestAiProvider` gets the identical option and the
identical 30 s literal, so `…/completion` cannot outlive `…/probe`; there a
timeout raises `ProviderCallFailedError` rather than returning a negative
result, because this row has no negative-result shape. `CheckProject`'s existing
call site passes no options and is unchanged.

- **The 30 s cost, recorded:** a cold-start model behind a proxy can exceed it
  and be reported as `failed` (probe) or `502` (completion) while actually
  alive. Accepted as the settings-screen trade.

- **Known limitation, stated not hidden:** losing the race does not _cancel_ the
  underlying call — `ProviderProbe` has no cancellation. The in-flight request
  finishes in the background and its result is discarded. Adding an
  `AbortSignal` to the port reaches into the pi session adapter; it is a
  **non-goal** here.

**Hermetic Proof.** `scripts/e2e/mock-openai-completions.mjs` already exists and
already serves `POST /v1/chat/completions` with SSE, printing its **full** base
URL (`http://127.0.0.1:<port>/v1` — already including `/v1`, so nothing is
appended to it). The Proof registers a **custom** provider
(`api:"openai-completions"`, `customProviderId:"qwen-token-plan"`,
`baseUrl:<mock>`, `allowInsecure:true`) pointed at it — the exact recipe
`008.1-custom-openai-compatible-provider.md` already proves from the CLI. No
model, no billable call, loopback only. The mock logs nothing, so no assertion
inspects its output; the live probe is proved by `status:"ok"` and the dead
probe by killing the mock. The same mock proves `…/completion`: it streams the
marker `DATETIME-OK 2026-07-24`
(`scripts/e2e/mock-openai-completions.mjs:22`), so the Proof asserts that exact
string comes back as the `reply` — which is the whole point of the row, and is
something the probe row can never show.

### 7. The project chain: `POST` to the collection with the id in the BODY, `DELETE` on the member

```
POST   /api/project/:id/ai-provider               → 204   body {"providerId": "<id>", "rank"?: n}
DELETE /api/project/:id/ai-provider/:providerId   → 204
```

**The asymmetry is deliberate and is the RESTful reading** (Ulrich,
2026-07-30). A `POST` adds a member that does not exist yet, so the member
travels in the **body**; naming it in the path is `PUT`'s idiom. A `DELETE`
addresses a member that already exists, so it names it in the **path**. `:id` in
the `POST` path is the parent project, not the new member.

`/api/project/:id/ai-provider` already exists as a `GET` row
(`routes.ts:331-342`); adding a `POST` on the same path is what 021 already does
for `/api/project`, and `matchRoute` separates them by method (`router.ts:75`).

**`204`, not `201` + `Location`** — the same exception 021 decision 4 made for
dependency edges: an assignment has no representation of its own (there is no
`GET …/ai-provider/:providerId` row and none is planned; the chain is visible as
`GET /api/project/:id/ai-provider`), and both use cases return `void`
(`assign-ai-provider.ts:380`, `unassign-ai-provider.ts:445`). A `Location`
pointing at a path that 404s would be a lie.

**Order IS expressible, partially.** `AssignAiProvider.execute` accepts
`rank?: number`; omitted, it appends at `maxRank + 1`; supplied, it calls
`shiftRanksFrom(projectId, rank)` and inserts there
(`assign-ai-provider.ts:399-410`). So `{"providerId":"…","rank":0}` means "put
this provider at the head of the chain". The Proof proves an insert at rank 0
reorders `GET /api/project/:id/ai-provider`.

**What is NOT expressible, and is a non-goal:**

- **Re-ranking an already-assigned provider.** A second `POST` for the same pair
  throws `DuplicateAssignmentError` (`assign-ai-provider.ts:395-397`). Moving a
  provider means `DELETE` then `POST` with the new rank — two requests, with no
  atomicity across them. There is no `UpdateAssignment` use case and 024 does not
  invent one.
- **Bulk reorder** (replacing the whole ordered chain in one request). No use
  case takes an ordered list, and 024 adds no `PUT` row (decision 0).

`DELETE` is idempotent by design — `UnassignAiProvider` no-ops on a missing row
and then compacts ranks (`unassign-ai-provider.ts:459-461`) — so a repeated
`DELETE` answers `204` again. Both use cases validate that the project exists
and that the provider exists, so a bad id in either position is
`404 unknown_reference`.

### 8. Three new path segments

`PATH_SEGMENTS` gains **`default`**, **`probe`** and **`completion`**.
`credential` and `ai-provider` are already there. None of the three is plural, so
`NOT_PLURAL` is untouched. None is in `BANNED_VERBS`, and all three are read as
nouns: `default` names the default-pointer, `probe` names the probe result the
`POST` produces, `completion` names the model completion it produces. Note
particularly that the segment is `completion`, **not `test`** — `test` is the CLI
verb, and the created noun is what the path names. Note what never appears as a
segment: `register`, `update`, `assign`,
`unassign`, `set-default`, `logout`, `remove`, `test`, `login` — all nine are
already banned, and the verbs live in the method.

### 9. `decode` details that are easy to get wrong

- **`provider` is required unless `api` is set.** `RegisterAiProviderInput.provider`
  is a required `string` (`register-ai-provider.ts:40`) and MUST NOT be weakened
  to optional (AGENTS.md). On the custom path `customProviderId` overrides it
  (`:98`), so `decode` requires `provider` when `api` is absent and, when `api`
  is present, defaults `provider` to `customProviderId`. That coercion belongs in
  `decode`, which exists to turn HTTP-flavoured input into a use-case input.
  (The CLI is looser here — `--provider` is optional and can reach the use case
  as `undefined`. 024 does not change the CLI; the HTTP row is simply stricter.)
- **`contextWindow` / `maxTokens` are numbers in JSON**, not the CLI's strings.
  `optionalBodyNumber` (a new `body.ts` helper, sibling of 021's set) rejects a
  non-number with `400 invalid_input` naming the field, so
  `InvalidNumericFlagError` is reachable only for a number that is present and
  non-positive.
- **`allowInsecure` is an explicit body boolean**, never defaulted true. It is
  the opt-in that lets the Proof point at a loopback mock; a UI that omits it
  gets `InsecureEndpointError`.
- The query booleans (`confirmNoDefault`, `cascade`) accept only the literal
  string `"true"`; anything else is `400 invalid_input`. An absent parameter is
  absent, not `false` — the use cases distinguish the two.

### 10. Error registry additions (019 decision 11: only what a row can raise)

Every entry below was found at a `throw` site reachable from one of the eight
rows. All live in `src/app/ai-provider/errors.ts` unless noted.

| class                             | code                         | status | raised by                                                                               |
| --------------------------------- | ---------------------------- | ------ | --------------------------------------------------------------------------------------- |
| `EmptyValueError`                 | `empty_value`                | 400    | register :79, update :333                                                               |
| `UnknownProviderError`            | `unknown_provider`           | 400    | register :122, update :293                                                              |
| `UnknownModelError` (app)         | `unknown_model`              | 400    | register :124, update :295                                                              |
| `InvalidEffortError`              | `invalid_effort`             | 400    | register :131, config-validation :54                                                    |
| `InvalidApiFlavorError`           | `invalid_api_flavor`         | 400    | config-validation :46                                                                   |
| `MissingCustomProviderIdError`    | `missing_custom_provider_id` | 400    | config-validation :62                                                                   |
| `MissingBaseUrlError`             | `missing_base_url`           | 400    | config-validation :66                                                                   |
| `InvalidBaseUrlError`             | `invalid_base_url`           | 400    | config-validation :74/:77/:115/:118                                                     |
| `InvalidNumericFlagError`         | `invalid_numeric_field`      | 400    | config-validation :86, :93                                                              |
| `InsecureEndpointError`           | `insecure_endpoint`          | 400    | config-validation :106                                                                  |
| `NoUpdateFieldsError`             | `no_update_fields`           | 400    | update :253                                                                             |
| `BuiltinProviderFieldError`       | `builtin_provider_field`     | 400    | update :285                                                                             |
| `StaleCredentialError`            | `stale_credential`           | 409    | update :339                                                                             |
| `LoggedOutProviderError` (domain) | `logged_out_provider`        | 409    | update :264, set-default :486, logout :581, remove :725                                 |
| `DuplicateAssignmentError`        | `duplicate_assignment`       | 409    | assign :396                                                                             |
| `InvalidRankError`                | `invalid_rank`               | 400    | assign :405                                                                             |
| `DefaultNeedsReplacementError`    | `default_needs_replacement`  | 409    | logout :587, remove :677/:731                                                           |
| `SelfReplacementError`            | `self_replacement`           | 400    | logout :572, remove :658                                                                |
| `CorruptDefaultPointerError`      | `corrupt_default_pointer`    | 409    | logout :562                                                                             |
| `UnnecessaryReplacementError`     | `unnecessary_replacement`    | 400    | logout :547/:550, remove :706/:709/:738/:745                                            |
| `ConflictingDefaultChoiceError`   | `conflicting_default_choice` | 400    | logout :533, remove :644                                                                |
| `AssignedProviderError`           | `assigned_provider`          | 409    | remove :671                                                                             |
| `AmbiguousFlagsError`             | `ambiguous_options`          | 400    | remove :648                                                                             |
| `ProviderCallFailedError` (new)   | `provider_call_failed`       | 502    | `TestAiProvider`, wrapping any `ProviderProbe` failure or the 30 s timeout — decision 6 |

Already registered and reused unchanged: `UnknownReferenceError`
(`unknown_reference`, 404) and `EmbeddedCredentialError` (`embedded_credential`,
400 — added by 021).

**`502` must be added to `ALLOWED_STATUSES`** in
`src/apps/http/error-registry.test.ts:17-19`, which today lists
`400, 401, 403, 404, 405, 409, 412, 413, 415, 500` — no `502`. That one-line,
reviewed edit is the intended discipline, the same as 021 adding `428`.

**Nine of these carry CLI-flavoured messages that must not reach an HTTP
client.** `mapError` falls back to `err.message` unless the mapping supplies one
(`error-registry.ts:113-117`), and messages such as `"--context-window is only
valid for a custom provider (registered with --api)"`, `"pass --allow-insecure
…"` and `"Use --cascade or --replacement"` name CLI flags a browser has never
seen. `ProviderCallFailedError` needs one for a stronger reason still: its own
message is built from a provider's error text, so the registry message is fixed
(`"the provider call failed"`) and the redacted detail reaches the log, never the
client. So `ProviderCallFailedError`, `InvalidNumericFlagError`,
`BuiltinProviderFieldError`,
`InsecureEndpointError`, `DefaultNeedsReplacementError`,
`UnnecessaryReplacementError`, `ConflictingDefaultChoiceError`,
`AssignedProviderError`, `AmbiguousFlagsError` and `InvalidRankError` each supply
an explicit `message` in the mapping, naming the JSON field or query parameter
instead. A hermetic test asserts no registered message for a 024 code contains
`"--"`.

**Deliberately NOT registered, with the reason:** `NonOAuthProviderError` (only
`LoginProvider` throws it — EPIC 026); `IncompatibleProviderCredentialError` (no
production module throws it — 021 already recorded this); the probe raises
nothing at all (decision 6).

### 11. Claimed CLI leaves: eight. Row count: 72

024 claims exactly the eight write leaves: `register ai-provider`,
`update ai-provider`, `assign ai-provider`, `unassign ai-provider`,
`set-default ai-provider`, `logout ai-provider`, `remove ai-provider`,
`test ai-provider`. **`get ai-provider` and `list ai-provider` were already
claimed by EPIC 020** (`cli-coverage.test.ts:65-93`), so the epic's net effect on
the inventory is +8. The "uncovered set is non-empty" assertion at
`cli-coverage.test.ts:53-63` still holds afterwards and is **not** touched.
EPIC 026 (the job API) and EPIC 027 (delivery) hold the last uncovered leaves, so
**027 is the epic that flips it** — 025 is the frontend host and claims no leaf.

**`test ai-provider` is claimed in FULL, with no narrowing** (Ulrich,
2026-07-30). `ai-provider.completion.create` takes the caller's `prompt` and
returns the model's reply, so the leaf has a complete HTTP twin — unlike 021's
`check project`, whose `--probe-*` flags stayed CLI-only. `…/probe` claims no
leaf at all: it is a new capability the readiness screen needs, not a CLI verb,
and `cliCommands` is `[]` for it (legal — `RouteMeta.cliCommands` "May be
empty", `routes.ts:48`).

`ROUTES` goes from **63 rows to 72** (021's 52 + 022's 2 + 023's 9 + 024's 9);
`routes.test.ts`'s row-count assertion becomes `72`, updated in the story that
lands the last row.

## Verification Gate

Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).

Hermetic coverage required beyond the Proof:

- **Route contract in `routes.test.ts`:** the three new `PATH_SEGMENTS` entries
  with `NOT_PLURAL` unchanged; 021's write contract (`location` iff `201`,
  `readRow` iff `PATCH` naming a real `GET` row, `present` unless `204` or
  `readRow`) passing over all nine new rows; the verb ban passing; the row count
  is `72`; the `PUT_ROWS` allowlist gains `ai-provider.default.put` and its
  negative control (a second unlisted `PUT` row still fails) still passes; and
  decision 4's shadow test — `PUT /api/ai-provider/default` matches exactly one
  row, and `GET /api/ai-provider/default` matches the item row.
- **Per row, three unit tests with fakes** (020/021's rule): `decode` maps params
  - query + body to the exact use-case input — including the
    `provider`/`customProviderId` rule, the numeric coercions, the literal
    `timeoutMs: 30000`, `optionalQueryBool` accepting only `"true"`, and
    `requirePathParam` rejecting a blank id; `run` calls the injected fake once
    with that input; `present` (on the two rows that have one) returns an object
    whose `Object.keys()` equal the declared literal list, asserted key by key.
- **No secret ever presented, with the right test target.**
  `RegisterAiProvider` returns a bare id string, so `ai-provider.create` has no
  record to strip: its test asserts the `201` body is exactly `{id}`.
  `ai-provider.patch` presents through `readRow: "ai-provider.get"`, so its test
  seeds the **`ai-provider.get` fake** with a secret-bearing internal record and
  asserts the view drops it. `aiProviderView`'s key list is asserted verbatim.
- **The timeout and redaction on BOTH use cases (the app-layer change):** for
  `ProbeAiProvider`, a fake tester that never resolves yields
  `{status:"failed"}` with a timeout detail and does not reject; a fake that
  resolves inside the window yields `{status:"ok"}` with the fixed detail; a fake
  that throws an error containing the secret yields a detail with the secret
  redacted. For `TestAiProvider`, the same three cases yield a thrown
  `ProviderCallFailedError` on timeout and on failure — with the secret redacted,
  first line only, capped at 300 characters — and the model's reply **verbatim
  and uncapped** on success. `CheckProject`'s existing probe tests still pass
  with no options passed.
- **Registry hygiene** — the ONE test that iterates `DOMAIN_ERROR_MAPPINGS`
  (`error-registry.test.ts:21-42`) passes with the 24 new codes and with `502`
  added to `ALLOWED_STATUSES`. There is no one-class-per-code test to extend, so
  each new mapping gets a per-class `mapError` test in the style of `:44-68`,
  plus the "no registered 024 message contains `--`" assertion.
- **CLI-retirement inventory:** the eight claimed leaves all name real Commander
  leaves, and the uncovered set is still non-empty.
- **Boundary lint:** no file under `src/apps/http/` imports `src/domain/` or
  `src/apps/cli/`.

Proof: `scripts/e2e/http-provider-writes-proof.sh` — deterministic, no real
model, no outbound network beyond loopback, no server and no mock left running.
Written and run in this authoring session. Run from the repo root:

```bash
scripts/e2e/http-provider-writes-proof.sh
```

It must print `024 ok: …`. It reuses `http-writes-proof.sh`'s machinery — the
same `node:http` request helper (not `fetch`, so `Host` stays settable), the same
`eq`/`ne`/`contains`/`absent` assertions, the same `listening`-log port read, an
isolated `KANTHORD_DB` and an isolated working directory with its own `.env`.
Phases:

- **A** — migrate a temp database; start `mock-openai-completions.mjs` and read
  its base URL **verbatim** (it already ends in `/v1`); start `serve --port 0`
  and read the bound port from the `listening` log line; `/healthz` answers
  `200`.
- **PREREQ** — a single `POST /api/project` probe. 024 builds its fixture over
  the 021 planning-write rows, so if those are absent the script reports
  `PREREQ MISSING` and exits **2** — a dependency gap can never be mistaken for a
  024 gap (which exits 1).
- **B** — the project a readiness check needs, built entirely over 021 rows:
  project, repository, initiative, objective and **one task** — the initiative
  check needs a `building`, unpaused initiative with at least one incomplete task
  (`project-readiness.ts:341-343`), so the objective and task are fixture, not
  decoration. Then `GET /api/project/:id/readiness` shows `database ok`,
  `initiative ok`, `repository unverified` (not blocking — `unverified` is not in
  `NOT_CONFIGURED_STATUSES`), `ai_provider missing` and **`configured: false`** —
  the exact gap this epic closes.
- **C** — `POST /api/ai-provider` with the custom body → `201`,
  `Location: /api/ai-provider/<id>`, followed to a `200` whose DTO has exactly
  the eight literal keys, `state:"active"`, `isDefault:true` (first-wins) and
  **no `value`**. Then the failure paths: no `allowInsecure` →
  `400 insecure_endpoint`; no `value` → `400 invalid_input`; `"value":""` →
  `400 empty_value`; `"api":"nope"` → `400 invalid_api_flavor`; `api` with no
  `customProviderId` → `400 missing_custom_provider_id`; a builtin with an
  unknown model → `400 unknown_model`; an unknown provider kind →
  `400 unknown_provider`.
- **D** — **`configured` flips to true**, through the global default, with no
  assignment at all (registration sets the default first-wins,
  `register-ai-provider.ts:173`). The `ai_provider` detail carries the
  default-suffix, showing the chain resolved through the default pointer.
- **E** — the chain, and the assign write's part in the configured path:
  `POST /api/project/:id/ai-provider` with `{"providerId":…}` → `204`, the chain
  lists it, and the readiness detail **loses** the default-suffix — the
  assignment now resolves the chain. Then a second provider assigned with
  `{"rank":0}` → `204` and the collection lists it **first** (order proved). A
  duplicate → `409 duplicate_assignment`; `"rank":-1` → `400 invalid_rank`; an
  unknown provider and an unknown project → `404 unknown_reference`.
  `DELETE …/ai-provider/:providerId` → `204`, gone, and a second `DELETE` →
  `204` (idempotent).
- **F** — `PUT /api/ai-provider/default` with `{"providerId":…}` → `204`, and
  `isDefault` moves from p1 to p2. **Repeating the identical `PUT` → `204`
  again with `isDefault` unchanged** — the protocol-level idempotence decision 4
  chose `PUT` for, proved rather than asserted. An unknown id →
  `404 unknown_reference`. `GET /api/ai-provider/default` → `404` (the shadow is
  harmless).
- **G** — `PATCH` under `If-Match`: the item `GET` carries an `ETag`; no
  `If-Match` → `428 precondition_required`; a stale validator →
  `412 precondition_failed`; the real one → `200` with the new model and a
  DIFFERENT `ETag`; **replaying with the old validator → `412`** (the lost
  update, proved); `{}` → `400 no_update_fields`; a builtin row patched with
  `baseUrl` → `400 builtin_provider_field`; a secret rotation whose response
  carries **neither** the old nor the new secret.
- **H** — the two outbound rows, and the contrast between them. The probe:
  `POST /api/ai-provider/:id/probe` → `200`, exactly three keys, `status:"ok"`
  and the fixed detail `"provider answered the probe prompt"` — **never the
  model's words**. The completion: `POST /api/ai-provider/:id/completion` with
  `{"prompt":"What is today's datetime?"}` → `200` whose `reply` contains the
  mock's marker **`DATETIME-OK`**, proving the caller's prompt reached a model
  and the model's own text came back — the thing the probe row can never show.
  Then the mock is killed: the probe answers **`200` with `status:"failed"`**,
  not `500`, while the completion answers **`502 provider_call_failed`** with a
  fixed message and no secret. An unknown provider → `404 unknown_reference` on
  both.
- **I** — logout and remove: `DELETE …/:id/credential` with no flags on a
  non-default provider → `204` and `state:"logged_out"`; again → `204`;
  set-default onto it → `409 logged_out_provider`; the default with no escape →
  `409 default_needs_replacement`; a logged-out replacement →
  `409 logged_out_provider`; both escapes at once →
  `400 conflicting_default_choice`; a valid replacement → `204` and the default
  moves. Then `DELETE /api/ai-provider/:id` while assigned →
  `409 assigned_provider`; `?cascade=true&replacement=…` →
  `400 ambiguous_options`; `?cascade=true` → `204`, gone, and out of the
  project's chain.
- **J** — no leak and a clean shutdown: the registered secret, the rotated
  secret, the `API_KEY` and **the model's reply text** appear in **no line of the
  server log**; `SIGTERM`
  shuts the server down and the port stops accepting. The mock logs nothing, so
  nothing asserts against it; the `EXIT` trap kills it.

**Ran against the CURRENT tree** (2026-07-30, commit `5dd1374`,
`ROUTES.length === 24`, with 021/022/023 planned but not built):

```
--- A: migrate, start the loopback model mock, then serve on an ephemeral port
    mock base URL: http://127.0.0.1:58991/v1
    bound port: 58993
PREREQ MISSING: POST /api/project answered 405, expected 201.
  EPIC 024's fixture is written over the EPIC 021 planning-write rows.
  Build 021 (and 022/023) first; then this proof's first failure moves
  to phase C, on POST /api/ai-provider — the capability 024 adds.
EXIT=2
```

Phase A passes in full — the migration runs, the mock binds, `serve` binds, and
an authenticated `/healthz` answers `200` — so the first failure is a missing
capability, not a broken fixture.

And the 024-specific gap, probed directly against `ROUTES` in the same session:

```
ROUTES.length = 24
method_not_allowed POST   /api/ai-provider
method_not_allowed PATCH  /api/ai-provider/:id
method_not_allowed DELETE /api/ai-provider/:id
method_not_allowed PUT    /api/ai-provider/default
not_found          DELETE /api/ai-provider/:id/credential
not_found          POST   /api/ai-provider/:id/probe
not_found          POST   /api/ai-provider/:id/completion
method_not_allowed POST   /api/project/:id/ai-provider
not_found          DELETE /api/project/:id/ai-provider/:providerId
```

All nine rows are absent. `method_not_allowed` rather than `not_found` on four
of them is the exactly right failure: those paths ARE routes today, as `GET`
only. The missing thing is the write row. It also confirms decision 4's shadow
analysis empirically: `PUT /api/ai-provider/default` reports
`method_not_allowed` because it matches `GET /api/ai-provider/:id` — once the
`PUT` row exists it wins on method. (Note that `PUT` is reported as
`method_not_allowed` rather than rejected outright: `matchRoute` compares
`route.method` as data (`router.ts:75`), so the current tree needs no change to
route a method it has no row for.)

## Stories

Each story keeps `npm run verify` green on its own. **Every row story wires its
own `HttpDeps` field in the same story** — the fields are required and
`readonly`, so adding one without populating the bundle breaks typecheck and
would leave the tree red mid-epic.

**`HttpDeps` is built in `src/apps/cli/commands/serve.ts:39-60`, not in
`composition.ts`** — verified, not assumed. All nine use cases are already
constructed and already exposed on `CliDeps` (`src/apps/cli/deps.ts`, including
`providerProbe: ProbeAiProvider` at `:250`), so a row story's wiring is three
edits: the `import type` and the `readonly` field in `src/apps/http/deps.ts`,
then one line in the `serve.ts` literal. **`composition.ts` needs exactly ONE
edit in the whole epic** — the new `secretOf` argument to `TestAiProvider`
(decision 6, Story S1).

- **S1 — the probe timeout and the registry.** `ProbeAiProvider.execute` gains
  the `{timeoutMs}` option with its tests; `body.ts` gains
  `optionalBodyNumber`; `decode.ts` gains `optionalQueryBool`; the 23 error
  mappings land with the nine `message` overrides and the "no `--` in a message"
  test. No row yet.
- **S2 — register and update.** `ai-provider.create` (`201` + `Location`) and
  `ai-provider.patch` (`readRow: "ai-provider.get"`, `If-Match`), their
  `HttpDeps` fields **and their composition wiring** — including a logger-backed
  `warn` for `RegisterAiProvider`, which today receives the CLI's stderr writer —
  the `provider`/`customProviderId` decode rule, and the no-secret assertions.
- **S3 — the lifecycle rows.** `ai-provider.default.put` (adding
  `ai-provider.default.put` to `PUT_ROWS` — 024's one reviewed entry, per 023
  decision 2 — plus the shadow test), `ai-provider.credential.delete` and
  `ai-provider.delete`, with their query-flag decoding, their composition
  wiring, and the `204`-with-no-`ETag` dispatch assertion.
- **S4 — the project chain.** `project.ai-provider.create` (with `rank`) and
  `project.ai-provider.delete`, wired.
- **S5 — the two outbound rows.** `ai-provider.probe.create` with
  `views/probe.ts` (literal `{id, status, detail}`) and
  `ai-provider.completion.create` with `views/completion.ts` (literal
  `{id, prompt, reply}`), both binding `timeoutMs: 30000`, both wired. Includes
  `ProviderCallFailedError` and its `502` mapping, and the assertion that the
  model reply is never logged.
- **S6 — the row count, the inventory and the Proof.** `routes.test.ts`'s row
  count becomes `72`; `cli-coverage.test.ts` records the eight claimed leaves;
  `scripts/e2e/http-provider-writes-proof.sh` (already written, already failing
  for the right reason) must print `024 ok: …`.

  **No story edits `retirement.md`.** `.agent/plan/**` is lane-forbidden to every
  role (`scripts/lane-check.sh:13-19`), so marking Target 024 covered — and
  recording that `test ai-provider` is claimed in FULL while
  `check project --probe-*` stays an operator CLI action — is a human follow-up.

## Non-goals

- **`login provider`'s OAuth device flow** — EPIC 026 (decision 1). 024's
  registration is URL + key only.
- **The daemon** (`run daemon`) and the async job API — EPIC 026.
- **`land repository` and `publish repository`** — EPIC 027 (delivery), split
  out of `retirement.md`'s original Target 024.
- **Any change to how the daemon folds a credential**, to `resolveProviderChain`,
  or to provider selection in `run-next-task`.
- **Lost-update protection on secret rotation.** The `ETag` hashes the presented
  DTO, which carries no credential field, so two clients holding the same
  validator can both rotate the secret and the second write wins silently.
  `UpdateAiProvider`'s `credentialVersion` CAS does not close this — it reads the
  version inside its own transaction. **Accepted: kanthord serves one operator**
  (Ulrich, 2026-07-30). Revisit only if the API ever serves more than one client;
  the fix then is to add `credentialVersion` (a number, not a secret) to the DTO
  so a rotation changes the validator.
- **Re-ranking an assigned provider in one request, and bulk chain reorder** —
  decision 7. `DELETE` + `POST` with a new rank is the supported path.
- **`DELETE /api/ai-provider/default`** (clearing the default on its own) — no
  use case exists; decision 4.
- **Any second `PUT` row.** 024 adds exactly one (`ai-provider.default.put`) and
  one matching `PUT_ROWS` entry. `PUT` on a provider item, on the chain, or as a
  bulk chain reorder is not in this epic — decision 0 and decision 7.
- **Cancelling an in-flight probe.** The timeout bounds the _response_, not the
  outbound call; `ProviderProbe` has no `AbortSignal` and adding one is a
  separate change — decision 6.
- **Capping or truncating the `…/completion` reply.** Returned verbatim, because
  an operator asking a model a question wants the answer; decision 6 records the
  megabyte-response cost. It is never logged.
- **Exposing `changed`** from `UpdateAiProvider` on the wire — decision 3.
- **A `GET` for the default pointer or for a single assignment.** `isDefault` is
  on the provider DTO and the chain is `GET /api/project/:id/ai-provider`;
  neither sub-resource needs a representation.
- **Actually retiring any CLI leaf.** 024 makes eight leaves retirable and
  updates the inventory; removal happens when the UI uses the routes.
- **Any UI work** — the Preact screens that consume these routes are EPIC 025,
  the frontend host, deliberately sequenced after this epic. Also no change to
  auth, CORS, the Host check, the CSRF gate,
  the middleware order, the logger or the envelope.

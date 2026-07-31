# EPIC 026.5 — resource writes — stories

Epic: `.agent/plan/epics/026.5-ui-resource-writes.md`
Prereq: EPIC 026.4 (sequence order). 026.1 gave `DangerConfirm` and
`ROLE_CLASS`; 026.2 gave the typed collection tabs, `dto.ts` and
`query-keys.ts`; 026.3 gave the resource workspace page; 026.4 gave
`useEditSession`, `ConflictPanel`, `invalidation.ts`, `write-errors.ts` and the
write transport in `api-client.ts`.

The operator can create and maintain all four resource types from the browser,
rotate a credential secret through an isolated control that never enters the
conflict layer, and change a repository's remote URL through a confirmation that
names exactly what the server does.

## Dispatch order

S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8, strictly. S1 is the shared lib layer
every other story imports. S2 builds the create shell that S4 and S6 reuse.
S3 and S5 are independent of each other. S7 edits files S2 and S4 created.
S8 is last and only touches `scripts/e2e/ui-resources-proof.sh`.

## Stories

- S1 — the shared lib layer: payload builders, resource error table, three write
  helpers, three invalidation rows → `01-payload-builders.md`
- S2 — the create shell + credential create + credential metadata edit →
  `02-credential-create-and-edit.md`
- S3 — the isolated rotation control → `03-secret-rotation.md`
- S4 — repository create/edit + the discriminated auth control →
  `04-repository-and-auth.md`
- S5 — the "Change remote URL" flow and its DangerConfirm continuation →
  `05-remote-url-change.md`
- S6 — notification + filesystem forms → `06-notification-and-filesystem.md`
- S7 — publication's four states + the permanence notice →
  `07-publication-and-permanence.md`
- S8 — make `scripts/e2e/ui-resources-proof.sh` print `026.5 ok: …` →
  `08-proof.md`

## Facts (needed for implementation)

- **F1 — the Proof script already exists.** `scripts/e2e/ui-resources-proof.sh`
  is 225 lines, committed, executable. S8 does not author it; it applies five
  named edits — two setup, two navigation, and one that repairs the vacuous
  lone-`reclone` check (F19). The three points where that departs from the epic's
  Story 8 wording are listed, and approved, in
  `08-proof.md` § _Sanctioned deviations_, so `/work` does not stop on them.
- **F2 — a blank string is rejected, not ignored.** `requireBodyString`
  (`src/apps/http/body.ts:20-30`) trims and throws `must not be blank`;
  `optionalBodyString` (`body.ts:32-41`) treats only `undefined` as absent, so
  `null` also 400s. Every builder in S1 therefore **omits** a key whose trimmed
  value is `""`.
- **F3 — create paths and patch paths differ.** Create is
  `POST /api/project/:projectId/<type>` → `201` + `Location`, body
  `{"data":{"id":…}}`, **no ETag** (`src/apps/http/routes.ts:679-716`). Patch is
  `PATCH /api/<type>/:id` → `200` + fresh ETag (`routes.ts:725,755,776,797`).
  The single read is `GET /api/resource/:id` (`routes.ts:450-459`) — type-agnostic
  path, so the UI branches on the returned `type` to pick the patch URL. `<type>`
  is exactly the `ResourceTypeKey` string.
- **F4 — every resource PATCH needs `If-Match`.** `app.ts:234-261` pre-reads
  `resource.get`, 404s if absent, then **428 `precondition_required`** when
  `If-Match` is missing and **412 `precondition_failed`** on mismatch, before the
  patch body is decoded. `etagOf` is `'"' + sha256(JSON.stringify(dto)) + '"'`
  (`src/apps/http/etag.ts:9-11`).
- **F5 — the credential `value` is not in any read DTO.** `toResourceView`
  (`src/app/resource/resource-view.ts:63-73`) lists fields explicitly and never
  emits `value`; `resourceView` (`src/apps/http/views/resource.ts:60-68`) does the
  same. A value-only rotation therefore leaves the ETag **unchanged**, so
  rotation cannot join the conditional-edit layer (epic decisions 2 and 5).
- **F6 — `reclone` does no git work.** `UpdateRepository`
  (`src/app/resource/update-repository.ts:47-70`) consults it only while
  `remoteUrl` is present: if the stored `path` is non-empty **and that path exists
  on disk** and `reclone` is not set → `CacheConflictError`; if `reclone` is set →
  `updated["path"] = ""`. Nothing is deleted, fetched or cloned. The wire message
  literally says `--reclone` (`update-resource.ts:54-56`) — the UI must not echo
  it.
- **F7 — the existence check is real `fs.access`.** `homePathExists` in
  `src/composition.ts:310-318` calls `access(path)`. The default path for a
  created repository is `join(homedir(), ".kanthord", "repos", <host>,
…<segments>)` (`src/app/resource/add-resource.ts:55-66,107-108`), and `homedir()`
  honours `$HOME`. This is the only `homedir()` call in `src/`
  — nothing else in `serve` reads the home directory.
- **F8 — error codes the UI will see.** `duplicate_name`/409,
  `cache_conflict`/409, `immutable_field`/409, `embedded_credential`/400,
  `invalid_input`/400, `unknown_reference`/404, `precondition_required`/428,
  `precondition_failed`/412 (`src/apps/http/error-registry.ts:48-74,93-154`).
  Envelope is exactly `{"error":{"code","message","requestId"}}`; there is **no
  per-field error channel** — no `field`, no `fields[]`, no `details`.
- **F9 — `auth` is complete or absent.** `requireBodyRepositoryAuth`
  (`body.ts:128-150`) accepts `{kind:"ambient"}`, `{kind:"ssh-agent"}`,
  `{kind:"https-token",credentialId}`. The server does **not** check that
  `credentialId` exists, is a credential, or belongs to the project, and
  `repositoryAuthView` (`views/shared.ts:93-104`) silently downgrades a
  `https-token` with no `credentialId` to `{kind:"ambient"}`.
- **F10 — provider enums.** notification `provider` is `"slack" | "telegram"`,
  enforced at the decoder (`routes.ts:213-216`) and **create-only**
  (`update-notification.ts:7`). credential `provider` is a free string
  (`src/domain/resource.ts:30`) and also create-only (`update-credential.ts:7`).
- **F11 — `type` in a patch body is a client-side defence only.** Every patch
  decoder reads it as `optionalBodyString`; the use case then compares it against
  the stored value and throws `ImmutableFieldError` on a mismatch. No route
  enforces its own type.
- **F12 — resource names are unique project-wide, not per type.**
  `AddResource` calls `resolveResourceByName(projectId, name)` with no type filter
  (`add-resource.ts:91-97`) → `DuplicateNameError`.
- **F13 — no delete route, no publish route** for any resource.
- **F14 — the collection row click opens a `DetailPane`, it does not navigate**
  (026.2 story 06, `06-resources-typed-tabs.md:89-94`). Epic decision 10 puts edit
  on the resource page, so S8 reaches the resource page by URL
  (`#/project/<p>/resource/<type>/<id>`), never by clicking a row.
- **F15 — `EntityWorkspace` has no `actions` slot.** Its only slot is
  `tabs[].panel` (026.3 story 01). Every 026.5 control therefore renders **inside
  the `summary` panel** of `ui/src/pages/entity-resource.tsx`, after the `<dl>`.
  The tab count stays **1**.
- **F16 — two sibling assertions must be relaxed, once, by S2.**
  `ui/src/pages/project-resources.test.tsx` asserts no control named
  `/new|create|rename|delete|rotate|reclone/i` (026.2 story 06 Verify), and
  `ui/src/pages/entity-resource.test.tsx` asserts no control named
  `/edit|rename|delete|rotate|reclone|publish|create|new/i` plus
  `document.querySelectorAll("form")` is empty (026.3 story 07 Verify). S2 replaces
  both with the narrower guards named in its Verify section; later stories keep
  them relaxed and add nothing back.
- **F17 — test conventions.** Vitest 4 + jsdom, `globals: false` (import
  `describe/test/expect/vi` explicitly), no auto-cleanup — every file owns
  `afterEach(() => { cleanup(); vi.clearAllMocks(); })`. **Nothing may be
  installed**: no `msw`, no `zod`, no `react-hook-form`; a missing package is an
  `OPEN:` blocker. Module tests stub with
  `vi.spyOn(globalThis, "fetch")` returning a real `Response`
  (`ui/src/lib/api-client.test.ts:12-49`); component tests use
  `vi.mock("@/lib/api-client", …)` over a `vi.importActual` spread. Single file:
  `npm run test --workspace ui -- <relative path>`.
- **F18 — no `useMutation` anywhere.** 026.4 calls the typed helper directly from
  `onSubmit`, then `await invalidateFor(...)`. 026.5 keeps that. This is also what
  keeps a secret out of the mutation cache.
- **F19 — the driver records no request body.** `scripts/e2e/ui-browser.mjs:72-82`
  records `{url, method, authorization, fromPage}` only, so the Proof's
  `lonelyReclone` filter at `ui-resources-proof.sh:183-192` reads a `postData` that
  is always `undefined` and can never fire. **No story adds `postData` to the
  driver** — that array would then hold the rotation secret (decision 3). S8 edit 5
  captures bodies inside the steps module for `PATCH /api/repository/*` **only**,
  which makes the check live and keeps every credential body out of it. S5 asserts
  the same invariant hermetically in Vitest, so it is covered on both sides.
- **F20 — `DangerConfirm` is portalled.** `danger-confirm-accept` is not a DOM
  descendant of the trigger (`ui/src/components/danger-confirm.test.tsx` asserts
  it). The Proof needs `[data-testid="cache-conflict-confirm"]
[data-testid="confirm"]`, so S5 adds three optional props to the component:
  `open`, `onOpenChange`, `bodyTestId`, `confirmInnerTestId`, and makes `trigger`
  optional. Defaults keep every 026.1 test green.
- **F21 — new test ids owned by this epic**, beyond the epic's contract table:
  `resource-edit-open`, `resource-edit-form`, `resource-edit-submit`,
  `resource-edit-error`, `resource-create-error`, `rotate-secret-submit`,
  `rotate-secret-status`, `remote-url-error`, `create-only-note`,
  `unique-name-note`.

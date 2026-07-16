# Story 04 — Provider session (pi-ai, API key + OAuth, `login`)

Epic: `.agent/plan/epics/006-real-agents-via-pi.md`

## Goal

AIProvider + Credential resources become a pi model/stream/credential
session behind an adapter-internal factory — the hermetic seam every agent
test fakes. Both D0 auth methods work out of the box: OpenAI-compatible API
key and OpenAI OAuth (obtained via `login`, refreshed via pi-ai, persisted
back).

## Acceptance Criteria

- `src/agent-runner/pi-session.ts` owns (pi types via `import type` — they
  never enter `port.ts`, per the D2 debate):
  - `ProviderSession = { model, streamFn, getApiKey }`;
  - `ProviderSessionFactory { for(aiProvider: AIProvider, credential:
    Credential): Promise<ProviderSession> }`;
  - `CredentialError { resourceName, provider }`,
    `UnknownModelError { provider, model }`.
- `PiProviderSessionFactory` ctor `{ saveCredentialValue: (credentialId,
  value) => void }`:
  - model lookup via pi-ai `createModels()` (exact surface verified against
    the installed `.d.ts` — reuse-first rule); `aiProvider.baseUrl`
    overrides the endpoint for OpenAI-compatible providers; unknown
    provider/model → `UnknownModelError`;
  - `credential.provider !== aiProvider.provider` → `CredentialError`
    (mismatch message; never contains `value`);
  - **credential kind discrimination (D0):** `value` JSON-parses to an
    OAuth credential → wire pi-ai's OAuth/CredentialStore path so refresh
    works; a refreshed credential is persisted back through
    `saveCredentialValue`; otherwise `value` is the API key
    (`getApiKey` returns it);
  - empty `value` → `CredentialError`.
- `src/agent-runner/fake-session.ts` `FakeSessionFactory`: scripted turns
  `Array<{ toolCalls?: Array<{ name; arguments }>; text?: string }>` → a
  `streamFn` the real pi `Agent` accepts (check pi-ai's faux provider
  first; mirror its message shapes if not directly reusable).
- CLI `login <provider> --project <ref> --name <name>`: runs pi-ai's OAuth
  flow for the provider (reuse the exported flow — grep
  `pi-ai/dist/auth`/`utils/oauth` before writing any of it) and creates or
  updates the named Credential resource with the serialized OAuth value.
  Providers without an OAuth flow → one-line error. Registered in
  `COMMANDS` (verb-first).

## Constraints

- No network in tests: the OAuth flow itself is exercised behind a faked
  flow function; only the real `login` command against a real provider is
  manual (epic Proof uses the API-key path).
- Secrets never appear in errors/logs/events — messages name resources and
  providers only.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — PiProviderSessionFactory

**Requires:** S01-T1 (Credential/AIProvider shapes).

**Input:** `src/agent-runner/pi-session.ts` (new, + test).

**Action — RED:** hermetic tests: (a) API-key credential + known
provider/model → a session whose `getApiKey` returns the value; (b) OAuth
JSON value → session built through the CredentialStore path; a scripted
refresh calls `saveCredentialValue` with the new serialized value; (c)
provider mismatch → `CredentialError`, message contains both provider
names and NOT the value; (d) empty value → `CredentialError`; (e) unknown
model → `UnknownModelError`; (f) `baseUrl` set → the session's model/
endpoint reflects it. Fails today: module absent.

**Action — GREEN:** implement on pi-ai exports (createModels, auth/
CredentialStore, env-independent).

**Action — REFACTOR:** none.

**Output:** the real session factory: both D0 auth methods, refresh
persisted back, everything named-error guarded.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — FakeSessionFactory driving a real Agent

**Requires:** T1.

**Input:** `src/agent-runner/fake-session.ts` (new, + test).

**Action — RED:** test: a pi `Agent` wired with the fake session
(`streamFn`), one recording echo tool in `state.tools`, `prompt('x')`,
`waitForIdle()` → the scripted tool call executed with its arguments, and
the final text is the last assistant message. No network, no timers. Fails
today: module absent.

**Action — GREEN:** implement the scripted `streamFn` (reuse/mirror pi-ai
faux provider shapes).

**Action — REFACTOR:** none.

**Output:** the load-bearing proof that scripted streams satisfy the real
agent loop — every later agent test builds on it.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T3 — `login <provider>` CLI

**Requires:** T1; EPIC 004 S01 (command table), S04 (resource persistence).

**Input:** `src/apps/cli/login.ts` (new, + test), `src/app/resource/`
(create-or-update through existing resource persistence).

**Action — RED:** handler tests with a faked OAuth flow function: (a)
`login openai --project <id> --name openai-oauth` → flow invoked, a
credential resource exists whose `value` is the serialized flow result,
stdout = the ULID; (b) running it again for the same name updates the
value (no duplicate); (c) a provider without a flow → exit 1 one line;
(d) unknown project → exit 1 one line. Fails today: module absent.

**Action — GREEN:** implement the handler + wire the real pi-ai flow in
the composition root; register `login` in `COMMANDS`.

**Action — REFACTOR:** none.

**Output:** OAuth credentials enter the DB the same way as everything else
— through a resource row.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

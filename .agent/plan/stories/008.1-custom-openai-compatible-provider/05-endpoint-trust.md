# Story E — Endpoint trust controls

Epic: `.agent/plan/epics/008.1-custom-openai-compatible-provider.md`
Depends on: Story B (custom register path).

## Change

- **Trust validation in the custom register path** — `src/app/ai-provider/register-ai-provider.ts`
  (custom branch, Story B), before persisting:
  - **embedded userinfo**: `if (hasEmbeddedUserinfo(baseUrl)) throw new
EmbeddedCredentialError(baseUrl)` (reuse `src/domain/resource.ts:118-129,91-98`).
  - **insecure endpoint**: reject a `baseUrl` that is plain `http://` **or** whose
    host is loopback/private (`127.0.0.1`, `localhost`, `::1`,
    `10.`/`192.168.`/`172.16-31.` ranges) **unless** `allowInsecure` is true →
    throw a typed `InsecureEndpointError(baseUrl)` whose message names
    `--allow-insecure`. Add a pure helper
    `isInsecureEndpoint(url): boolean` next to `hasEmbeddedUserinfo` (string
    checks only — no `new URL()` DNS).
  - `https://` public hosts pass without `--allow-insecure`.
- **Errors** — new `InsecureEndpointError` in `src/app/ai-provider/errors.ts`;
  `EmbeddedCredentialError` is already re-exported (`src/app/errors.ts`). Add
  `InsecureEndpointError` to the `instanceof` chain in `src/apps/cli/error-map.ts`.
- **CLI** — the `--allow-insecure` flag (added in Story B's flag list) is passed
  through `runRegisterAiProvider` as `allowInsecure` to the use case.
- **Endpoint visibility** — the custom `baseUrl` + `api` appear in the
  `AiProviderView` (008.1 view) for `get`/`list ai-provider` (already non-secret;
  the folded `value` stays omitted). Confirm the view carries `baseUrl`/`api`.

## Constraints

- These are guards, not full SSRF hardening — `--allow-insecure` is an explicit
  operator escape hatch (documented non-goal). No DNS/redirect defense.
- Guard applies only to the **custom** path (`--api` present); builtin providers
  have no operator baseUrl.

## Verify

- Extend `src/app/ai-provider/register-ai-provider.test.ts`: a plain-`http://` or
  `127.0.0.1` `baseUrl` without `allowInsecure` → `InsecureEndpointError`; with
  `allowInsecure:true` → succeeds; a `https://user:pass@host/v1` baseUrl →
  `EmbeddedCredentialError`; a public `https://` host → succeeds without the flag.
- Unit-test `isInsecureEndpoint` directly for http/loopback/private/https cases.
- Extend `src/apps/cli/ai-provider.test.ts`: `register --api … --base-url
http://127.0.0.1:…/v1` (no `--allow-insecure`) → exit 1 with `error:`
  mentioning `--allow-insecure`; adding `--allow-insecure` → exit 0.
- `npm run verify` exits 0.
- Proof (008.1-custom Proof): delivers **PASS E** (http/private base URL refused
  without `--allow-insecure`) and the **leak gate** (no api key in register/test
  output).

# Story A — Typed provider-error provenance + fake seam

Epic: `.agent/plan/epics/008.4-runtime-provider-failover.md`
Depends on: EPIC 008.3 (runner takes a resolved provider).

## Change

- **TaskResult signal** — `src/agent-runner/port.ts`, extend the `failed` variant
  (:29-34): add `providerError?: boolean; reasonCode?: string`.
- **Classify provider errors in the runner** — `src/agent-runner/pi.ts`:
  - session-creation failure (`sessions.for` catch, :417-423): return
    `{ outcome:"failed", providerError:true, reasonCode:<code>, reason }` where
    `<code>` is derived from the error type: `CredentialError` → `"auth"`,
    `UnknownModelError` → `"invalid_model"`, else `"provider_unavailable"`.
  - classified stream errors: when the agent loop surfaces a rate-limit / overload
    error from the session adapter (`429`/`503`), map to `providerError:true,
reasonCode:"429"|"503"`. Errors from git/workspace/db/verification and
    task-level outcomes (budget, verify fail, escalation) keep
    `providerError` **unset** (they are task-level).
- **Fake seam** — `src/agent-runner/fake-session.ts`:
  `fakeSessionFactoryFromTurns(turns, opts?: { failProviders?: string[] })`; when
  `opts.failProviders` includes the `aiProvider`'s name (or `provider`), `.for()`
  throws a typed provider error (reuse `CredentialError` or a dedicated
  `FakeProviderError` classified as `provider_unavailable`). `src/main.ts:35-43`:
  read `process.env.KANTHORD_FAKE_FAIL_PROVIDERS` (comma-split, trimmed) and pass
  as `failProviders`.

## Constraints

- Provider errors are identified by **origin/type** (session-adapter typed
  errors), never by matching `"network"`/`"timeout"` strings.
- The runner still never throws — the classification only sets fields on the
  returned `{outcome:"failed"}`.

## Verify

- Extend `src/agent-runner/pi.test.ts` (or `agent-smoke`): a `sessions.for` that
  throws `CredentialError` → result `{outcome:"failed", providerError:true,
reasonCode:"auth"}`; `UnknownModelError` → `reasonCode:"invalid_model"`; a
  verify-command failure → `providerError` unset.
- Extend `src/agent-runner/fake-session.test.ts`: `.for()` throws for a listed
  provider name and succeeds otherwise.
- `npm run verify` exits 0.
- Proof (008.4 Proof block): no dedicated `PASS` line — provides the
  `providerError`/`reasonCode` signal + `KANTHORD_FAKE_FAIL_PROVIDERS` seam that
  Stories B/C/D's Proof lines consume.

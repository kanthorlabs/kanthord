# Story G — Credential-version CAS + running-task contract

Epic: `.agent/plan/epics/008.3-daemon-auto-resolve-provider.md`
Depends on: Story A (resolved provider carries `id` + `credentialVersion`),
EPIC 008.1 (`ai_providers.state` / `credentialVersion`).

## Change

- **Registry CAS write-back** — add to `AiProviderRegistry`
  (`src/storage/port.ts`) + `SqliteAiProviderRegistry`:
  `updateCredentialCAS(id: string, expectedVersion: number, value: string):
{ applied: true; newVersion: number } | { applied: false }`. SQL:
  `UPDATE ai_providers SET value=?, credentialVersion=credentialVersion+1 WHERE
id=? AND state='active' AND credentialVersion=?` then check `changes`; if 1,
  return the new version (re-SELECT), else `{applied:false}`.
- **Session carries the expected version** — `src/agent-runner/pi.ts` (Story A
  build): when constructing the OAuth path, pass `provider.credentialVersion` as
  the session's `expectedVersion`, and route the write-back through the registry
  CAS instead of the resource `saveCredentialValue`.
- **Rewire the write-back** — `src/agent-runner/pi-session.ts:157-178`
  `credentialStore.modify`: replace the unconditional
  `saveFn(credId, JSON.stringify(result))` with a CAS call
  `registry.updateCredentialCAS(providerId, expectedVersion, JSON.stringify(result))`;
  on `{applied:true}` adopt `newVersion` as the new `expectedVersion` for the
  session; on `{applied:false}` (a concurrent `logout`/`remove`/re-login/another
  refresh bumped the version or cleared `active`) **do nothing** — keep serving
  `current` in-memory and do NOT fail the running attempt. Inject the registry +
  `expectedVersion` via `PiProviderSessionFactory` options
  (`composition.ts:338-340`) instead of the resource `saveCredentialValue` for the
  AI credential. (`saveCredentialValue` on the `resources` table stays only for
  any non-AI credential still using it, if any.)
- **Running-task contract**: no code change beyond the above — an already-started
  attempt keeps its captured in-memory `current`; only a _new_ task resolution
  (next daemon iteration) sees the new `state` (logged-out excluded, 008.2).

## Constraints

- Same-kind isolation preserved: the CAS is keyed by the provider **record id**
  (`providerId` from the resolved provider), never by provider kind.
- The write-back must never throw into the agent loop; a failed CAS is a silent
  no-op for the in-flight attempt.

## Verify

- Extend `src/storage/sqlite/ai-provider-registry.test.ts`:
  `updateCredentialCAS` with the matching version + `state='active'` applies and
  bumps the version; with a stale version → `{applied:false}` and no row change;
  with `state='logged_out'` → `{applied:false}`.
- New `src/agent-runner/pi-session.cas.test.ts` (fake registry): the `modify`
  closure calls `updateCredentialCAS(providerId, expectedVersion, …)`; on
  `{applied:false}` the in-memory `current` still serves and no throw propagates;
  on `{applied:true}` the session adopts `newVersion`.
- `npm run verify` exits 0.
- Proof (008.3 Proof block): no dedicated shell `PASS` line — the version-bump /
  stale-refresh-rejection is verified by the unit tests above (not observable from
  the shell Proof).

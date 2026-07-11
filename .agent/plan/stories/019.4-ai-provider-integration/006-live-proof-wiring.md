# Story 006 - live-proof wiring (runnable `kanthord login` + provider smoke)

Epic: `.agent/plan/epics/019.4-ai-provider-integration.md`

## Goal

Make the maintainer live proof actually runnable. Two pieces the hermetic build
left unbuilt: (1) a **runnable `kanthord login` entrypoint** that binds pi-ai's
real device-code logins to `runLoginCommand` (Story 002) + the Story 001
registry/store — this **supersedes the skipped Story 002 Task T3**; and (2) a
`test/live/provider-smoke.ts` that, per shipped provider kind, resolves a session
and makes **one real call**. Neither adds provider logic; they assemble the
Story 001–004 core into a runnable shell + a maintainer script.

## Acceptance Criteria

- Running the login entrypoint with `--help` (or with no/unknown positional
  kind) exits 0 for help and non-zero for a bad invocation, and prints the
  supported kinds `openai` / `openai-codex`, `github-copilot`, `openai-compatible`
  — with **no network** and **no credential written**.
- The production login-deps factory binds the **real** pi-ai device-code logins
  (`loginOpenAICodexDeviceCode` for `openai-codex`, `loginGitHubCopilot` for
  `github-copilot`) as the per-kind login seam, and a real registry/store rooted
  at a caller-given data root, as the sink. This is assertable hermetically: the
  factory returns a deps object whose supported-kind→loginFn map has entries for
  `openai-codex` and `github-copilot` (bound to the real pi-ai functions, not a
  fake), plus a registry and store — constructed without any network call.
- `test/live/provider-smoke.ts` exists and is **excluded from `npm test`** (the
  `src/**/*.test.ts` glob does not match `test/live/**`, and no test imports it),
  so the hermetic gate and the zero-network guard stay green with no credentials
  present.
- When a maintainer runs the smoke inside Podman with stored credentials, it
  makes **one real call per shipped kind** (`openai-codex`, `openai-compatible`,
  `github-copilot`), asserts a returned marker, observes cost, and records each
  run in `.agent/plan/feedback/019.4-ai-provider-integration/provider-live-proof.md`.

## Constraints

- **Real logins via pi-ai `/oauth`** — `loginGitHubCopilot` /
  `loginOpenAICodexDeviceCode` (`@earendil-works/pi-ai/oauth`); no reimplemented
  OAuth (Story 002 Constraint; gold standard pi coding-agent `AuthStorage.login`).
- **DI split (Epic 019.2 `buildRealDeps` pattern)** — the entrypoint is a thin
  shell over `runLoginCommand` (Story 002) plus a `buildLoginDeps` factory that
  binds the real seam; the hermetic test asserts the factory's wiring, the real
  flow is the live proof. No new login logic here (Ulrich correction — 026/027
  add no logic; this is the same principle for the CLI shell).
- **Live smoke lives under `test/live/`** so the `src/**/*.test.ts` glob and the
  `no-network-guard` import never pick it up — mirror `test/live/pi-session-smoke.ts`
  (EPIC Verification Gate: zero-network automated gate; live proof is separate).
- **Session built from Story 003/004 core** — the smoke uses `buildProviderSession`
  (+ `resolveOrBindAccount` where a binding is exercised) and reads credentials
  from the Story 001 store; it runs against an **isolated credential copy** inside
  Podman (live-proof runbook).
- **Redaction invariant** — neither the entrypoint nor the smoke prints a raw
  token; the smoke logs only a marker + cost.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the new `login-deps` hermetic
  test passes and the pre-existing suites (852 baseline) show no regression; the
  zero-network guard stays green (the live smoke is outside the test glob and
  imported by no test).
- `node src/cli/login.ts --help` exits 0 and lists the three supported kinds.
- Maintainer live proof: after `kanthord login <kind> --account`,
  `node test/live/provider-smoke.ts` inside Podman makes one real call per shipped
  kind and the `provider-live-proof.md` table is filled (this closes the EPIC's
  live-proof clause).

### Task T1 - runnable `kanthord login` entrypoint + real-seam deps factory

**Input:** `src/cli/login.ts`, `src/cli/login-deps.ts`, `src/cli/login-deps.test.ts`

**Action - RED:** a hermetic test asserts `buildLoginDeps({ dataRoot })` returns a
deps object whose supported-kind login map binds the **real** pi-ai
`loginOpenAICodexDeviceCode` (for `openai-codex`) and `loginGitHubCopilot` (for
`github-copilot`) — asserted by identity against the imported pi-ai functions —
and exposes a registry + credential store rooted at `dataRoot`; constructed with
no network call. (Argument parsing + kind mapping + device-code printing are
already covered by Story 002 T2, so this task tests only the real-seam wiring.)

**Action - GREEN:** implement `buildLoginDeps` binding the real pi-ai logins +
the Story 001 registry/store, and add a runnable `main(argv)` shell in
`src/cli/login.ts` that reads `process.argv`, builds the deps via the factory,
calls `runLoginCommand`, and exits with its code (help/usage on `--help` or a
missing/unknown kind). Executed only when the module is run directly.

**Action - REFACTOR:** none.

**Verify:** `node --test src/cli/login-deps.test.ts` green; `node src/cli/login.ts
--help` exits 0 and lists `openai`/`openai-codex`, `github-copilot`,
`openai-compatible`. Supersedes Story 002 T3.

### Task T2 - `test/live/provider-smoke.ts` maintainer live smoke (GREEN-only)

**Input:** `test/live/provider-smoke.ts`

**Action - RED:** none - GREEN-only. The smoke makes real network calls and needs
real credentials; it is excluded from `npm test` and covered by the maintainer
live proof, not an automated test (mirrors `test/live/pi-session-smoke.ts`). The
resolver/session logic it exercises is covered hermetically by Stories 003–004.

**Action - GREEN:** write the smoke script — for each shipped kind
(`openai-codex`, `openai-compatible`, `github-copilot`): read the stored
credential/config for a named account, build a session via `buildProviderSession`,
make one real model call, assert a returned marker, capture the observed cost,
and append a per-kind row to `provider-live-proof.md`. It must not run under
`npm test` (path outside `src/**/*.test.ts`) and must print no raw token.

**Action - REFACTOR:** none.

**Verify:** `npm test` does not execute it (glob mismatch) and stays green; a
maintainer runs `node test/live/provider-smoke.ts` inside Podman against an
isolated credential copy and records one real call per shipped kind in the
runbook.

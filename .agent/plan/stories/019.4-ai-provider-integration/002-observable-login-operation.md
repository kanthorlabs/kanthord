# Story 002 - observable device-code login operation

Epic: `.agent/plan/epics/019.4-ai-provider-integration.md`

## Goal

Authenticating an account is a **core operation with observable state**, not a terminal
side effect: it exposes `user code + verification URL → pending → complete/failed` so a
terminal renders it now and a UI (Epic 027, wiring only) renders+polls it later. The
`kanthord login <providerKind> --account <label>` CLI drives that operation and, on
success, registers the account (Story 001) with its credential.

## Acceptance Criteria

- Starting a login for `github-copilot` (and `openai`, i.e. openai-codex) produces a
  login-operation handle whose observable state first carries the **user code +
  verification URL**, then `pending` while polling, then `complete` (with the account
  id) or `failed` (with a reason). The state is queryable without blocking — a caller
  can poll it (the shape a UI later renders).
- On `complete`, a `{type:"oauth", access, refresh, expires, ...}` credential is written
  to the Story 001 store keyed by the **new account id**, and the account appears in the
  registry with the given `providerKind` + `label`.
- `kanthord login <kind> --account <label>` runs that operation, prints the user code +
  URL, waits for completion, and exits 0 on success; an unknown/unsupported kind exits
  non-zero with a typed error and registers nothing.
- A cancelled or timed-out login ends the operation in `failed` and writes **nothing**
  (no partial account, no credential).

## Constraints

- **Real login via pi-ai `/oauth`** — device flows `loginGitHubCopilot` /
  `loginOpenAICodexDeviceCode` (`@earendil-works/pi-ai/oauth`); no reimplemented OAuth
  (gold standard: pi coding-agent `AuthStorage.login`).
- **Injected login seam** — the operation takes an injectable `login(kind, callbacks)`;
  the hermetic test drives a **fake** that emits the device-code callback and resolves a
  canned credential; the CLI shell binds the real pi-ai logins (Epic 019.2 DI split). No
  network in the automated gate.
- **Observable operation, not a blocking call** — the login exposes state a non-terminal
  caller can poll, because Epic 026/027 (wiring only) must observe it; the CLI is one
  such caller, a UI is another. The operation object + its states are **core logic here**
  (Ulrich correction — 026/027 add no logic).
- **Persist only on success** via the Story 001 registry/store; a failed login performs
  no write; tokens are never printed (redaction invariant).

## Verification Gate

- `npm test` green for the login-operation + CLI suites; typecheck 0; zero-network guard
  green.
- Copilot and openai success (observable states + account/credential written), the
  unknown-kind error, and the cancel/timeout no-write path are asserted against the fake
  seam and a temp registry/store.

### Task T1 - observable login operation writes an account on success

**Input:** `src/agent/login-operation.ts`, `src/agent/login-operation.test.ts`

**Action - RED:** a test starts the operation for `github-copilot` with a fake seam that
(a) emits `onDeviceCode(userCode, url)` and (b) resolves a canned credential; asserts the
observable state transitions device-code → pending → complete, and that the account is
registered with a fresh id + the credential is stored under that id. A second case for
`openai` (openai-codex). A cancel case: the seam rejects → state `failed`, registry/store
untouched.

**Action - GREEN:** implement the login operation exposing an observable state machine,
driving the injected seam and persisting via the Story 001 registry/store only on
completion.

**Action - REFACTOR:** none.

**Verify:** `node --test src/agent/login-operation.test.ts` — T1 cases green.

### Task T2 - `kanthord login` CLI over the operation

**Input:** `src/cli/login.ts`, `src/cli/login.test.ts`

**Action - RED:** a test invokes the CLI for `openai --account work` with the fake seam,
asserts it surfaces the user code + URL and exits 0 with the account written; an unknown
kind exits non-zero with a typed error and no write.

**Action - GREEN:** implement the CLI parsing `<kind> --account <label>`, running the
login operation, printing device-code state, and mapping the supported kinds; reject
others.

**Action - REFACTOR:** none.

**Verify:** `node --test src/cli/login.test.ts` — T2 cases green.

### Task T3 - real login seam wired in the CLI shell (GREEN-only)

**Input:** `src/cli/login.ts`

**Action - RED:** none - GREEN-only. The real pi-ai logins hit the network; covered by
the maintainer live proof, not an automated test. Operation logic is covered by T1/T2 via
the fake seam.

**Action - GREEN:** the CLI shell binds `loginGitHubCopilot` /
`loginOpenAICodexDeviceCode` as the real seam and the Story 001 registry/store as the
sink.

**Action - REFACTOR:** none.

**Verify:** `node src/cli/login.ts --help` exits 0 and lists the supported provider
kinds; the real device flow is exercised by the maintainer live proof.

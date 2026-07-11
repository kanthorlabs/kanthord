# Story 003 - account-scoped resolver + durable per-task binding

Epic: `.agent/plan/epics/019.4-ai-provider-integration.md`

## Goal

Run a session against a **specific account**, and **durably bind** that account (+
model) to the task so every spawn/respawn/restart resolves the same account.
`buildProviderSession({ accountId, modelId })` builds `{ model, streamFn }` and threads
it into the real `Agent`; a daemon-owned binding records `task → {accountId, modelId}`
as the authoritative source the resolver reads on each spawn. The **switch** itself
(triggers, tier rules, notification) is **not** here — Epic 043 owns it and will update
this binding.

## Acceptance Criteria

- `buildProviderSession({accountId, modelId}, deps)` resolves the account (Story 001),
  registers its pi-ai provider instance at the boundary, and returns a `model` whose
  runtime `provider` maps to that account id and `model.id === modelId`, plus a
  `streamFn`; an unknown account id or a model id not offered by the account is a typed
  error naming it.
- A session spawned through `PiSurface.spawnAgent` for an account hands the real `Agent`
  (via `makeAgentOpts`) that `model` + `streamFn` and **no** `getApiKey` (asserted on the
  captured AgentOptions via `agentFactory`).
- **Durable binding:** when a task first selects an account, a daemon-owned record
  `task → {accountId, modelId, boundAt}` is written; a subsequent spawn **and** a
  respawn **and** a spawn after a simulated daemon restart all resolve that same account
  from the binding (not from in-memory state, not from `STATE.md`). The binding is the
  authoritative source-of-truth Epic 043's switch will later update.
- For a `github-copilot` account whose token encodes an **enterprise** `proxy-ep`, the
  resolved base URL is the enterprise host derived from the token, not the individual
  default (asserted against a fake token — no network).
- Spawn-time selection: given a slot config naming an account for the repo, the first
  spawn selects that account and writes the binding; absent config falls back to a
  configured default account with a typed error if none exists.

## Constraints

- **Durable binding is daemon-owned metadata, not `STATE.md`** — the active
  account/model for a task lives in daemon run/task metadata (scheduler/task store),
  because it affects billing + audit and must not be agent-authored prompt text
  (Decision Anchor: debate finding). It survives teardown + daemon restart.
- **Models-backed `streamFn`, no `getApiKey`** — delegate to `Models.streamSimple`
  (`createModels(...)`), which resolves auth (headers + OAuth base URL). Setting the
  Agent's `getApiKey` → api-key branch → skips OAuth base-URL derivation → `421`
  (Decision Anchor: spike [[copilot-provider-wiring]]).
- **Account→pi-ai instance mapping at the boundary only** — register the account's
  provider instance (via `createProvider`/`registerOAuthProvider`) under an id derived
  from the account id; the domain keeps kind/account separate (Story 001).
- **Thread through the existing seam** — extend `makeAgentOpts` to accept `streamFn`;
  extend `PiSurface.spawnAgent` opts + `PiSpawnOpts`/`PiRespawnOpts` to carry `model` +
  `streamFn`; construct the account session in `buildRealDeps`. No new session mechanism.
- **No switch here** — this story only *resolves* and *binds* one account per run.
  Switching accounts mid-task (trigger, tier rules, capability/window guards,
  notification) is **Epic 043**; it will update the binding this story writes. 019.4 does
  not promise automatic or mid-session switching (Non-Goal).
- **Automated gate uses a pi-ai `Models` double / captured AgentOptions** — no real
  model call; the real call is the maintainer live proof.

## Verification Gate

- `npm test` green for the resolver + binding + threaded run-deps/pi-session suites;
  typecheck 0; zero-network guard green.
- Resolver shape, "Agent gets model + streamFn and no getApiKey", the durable binding
  surviving respawn + a simulated restart, the enterprise base URL, and the typed errors
  are asserted on captured/durable state, no network.

### Task T1 - buildProviderSession resolves an account to {model, streamFn}

**Input:** `src/agent/provider-session.ts`, `src/agent/provider-session.test.ts`

**Action - RED:** with a registry/store holding a `github-copilot` account, assert
`buildProviderSession({accountId, modelId})` returns a `model` whose runtime provider maps
to the account and a callable `streamFn`; unknown account id and unknown model id each
assert a typed error; a fake enterprise `proxy-ep` token resolves the enterprise base URL.

**Action - GREEN:** implement `buildProviderSession` over `createModels` + the registry/
store + pi-ai provider factories, registering the account's instance at the boundary and
building a `Models.streamSimple`-backed `streamFn`.

**Action - REFACTOR:** remove the superseded `buildCopilotSession`
(`src/agent/copilot-provider.ts`) once callers move over.

**Verify:** `node --test src/agent/provider-session.test.ts` — T1 cases green.

### Task T2 - thread model + streamFn into the Agent seam

**Input:** `src/agent/pi-agent-adapter.ts`, `src/agent/pi-agent-adapter.test.ts`,
`src/agent/pi-session.ts`, `src/agent/pi-session.test.ts`

**Action - RED:** assert `makeAgentOpts({..., model, streamFn})` yields AgentOptions
carrying `model` + `streamFn` and **no** `getApiKey`; a pi-session test asserts
`spawnPiSession` forwards a provided `model` + `streamFn` into the `spawnAgent` opts
(captured via a fake `PiSurface`).

**Action - GREEN:** add `streamFn` to `AgentAdapterOpts`/`makeAgentOpts` (and stop
setting `getApiKey` when `streamFn` is present); add `model` + `streamFn` to
`PiSpawnOpts`/`PiRespawnOpts` and pass them into the spawn.

**Action - REFACTOR:** none.

**Verify:** `node --test src/agent/pi-agent-adapter.test.ts src/agent/pi-session.test.ts`
green.

### Task T3 - durable per-task account binding survives respawn + restart

**Input:** `src/agent/account-binding.ts`, `src/agent/account-binding.test.ts`,
`src/cli/run-deps.ts`, `src/cli/run-deps.test.ts`

**Action - RED:** a test selects an account for a task (writing the binding via daemon
metadata over a temp store), then asserts a second spawn, a respawn, and a spawn after a
simulated restart (fresh in-memory state, same durable store) all resolve the **same**
account from the binding; a task with no binding and a slot naming an account writes the
binding on first spawn; no binding + no slot account + no default asserts a typed error.

**Action - GREEN:** implement the daemon-owned account binding (`task → {accountId,
modelId, boundAt}`) with read/write over the task/scheduler store, and have
`buildRealDeps`/the resolver read it on every spawn and write it on first selection.

**Action - REFACTOR:** none.

**Verify:** `node --test src/agent/account-binding.test.ts src/cli/run-deps.test.ts` —
T3 cases green.

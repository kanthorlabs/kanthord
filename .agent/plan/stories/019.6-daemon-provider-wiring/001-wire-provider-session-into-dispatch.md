# Story 001 - wire provider session into daemon dispatch

Epic: `.agent/plan/epics/019.6-daemon-provider-wiring.md`

## Goal

Make the live daemon spawn pi sessions backed by a logged-in provider account.
Resolve the account to a `{ model, streamFn }` session at boot and inject it as
the default `model`/`streamFn` for every session `buildRealDeps` spawns, so the
run path no longer falls through to the `getApiKey` path. Fail closed with a
`kanthord login` hint when no account resolves.

## Acceptance Criteria

- A boot-time resolver, given a data root that holds a logged-in `openai-codex`
  account and an explicit model id, returns a session whose `model.provider`
  equals the account's provider kind (`"openai-codex"`), whose `model.id` equals
  the requested model, and whose `streamFn` is a function — built with **no
  network call** (the real call happens only when `streamFn` is later invoked).
- Account selection: when a label is supplied, the account with that label is
  chosen; when no label is supplied and exactly one account exists, it is chosen;
  when no account exists, or a label matches none, or no label is given but
  several accounts exist, the resolver **fails closed** with a typed error whose
  message names the fix (`kanthord login` for "none"; `--account <label>` for
  "ambiguous"). The error carries **no raw token** and writes no credential.
- Model selection: the explicit model id wins; absent it, the account's
  `defaultModel` is used; absent both, the resolver fails closed with an error
  naming `--model <id>`.
- With a resolved session threaded into `buildRealDeps`, a spawned agent that does
  **not** itself specify a model receives the resolved `model` and `streamFn`
  (observed through the injectable agent factory: the factory is called with a
  model whose `provider === "openai-codex"` and a defined `streamFn`). A spawn
  that **does** specify its own `model`/`streamFn` keeps the caller's values
  (resolved session is a default, not an override).
- `node src/cli/run.ts --help` exits 0 and documents `--account <label>` and
  `--model <id>`; booting the live path resolves the account against the same
  data root that `kanthord login` writes to (`KANTHORD_DATA`, default
  `~/.kanthord`).

## Constraints

- **Reuse the 019.4 engine unchanged** — resolution uses `buildProviderSession`
  (`src/agent/provider-session.ts`) plus `createProviderAccountRegistry` /
  `createProviderCredentialStore` (Epic 019.4 Story 001/003/004). No new provider
  logic, no reimplemented OAuth. Mirror the account/model precedence already shown
  in `test/live/provider-smoke.ts`.
- **DI split (Epic 019.2)** — the async account resolution lives in its own
  module; `buildRealDeps` stays synchronous and gains only optional
  `providerModel` / `providerStreamFn` inputs used as spawn defaults; `run.ts` is
  the thin shell that reads flags, computes the data root, awaits the resolver,
  and threads the result into `buildRealDeps`.
- **Zero-network at build** — the resolver and `buildRealDeps` make no network
  call; the streamFn is lazy (`Models.streamSimple`-backed). The new hermetic
  tests run under the existing no-network guard.

## Verification Gate

- `npm run typecheck` exits 0.
- `npm test` green: the new resolver + `buildRealDeps`-default tests pass and the
  existing suite shows no regression; the zero-network guard stays green.
- `node src/cli/run.ts --help` exits 0 and lists `--account` and `--model`.
- Live proof is owned by the Epic Verification Gate (maintainer run), not this
  Story's automated gate.

### Task T1 - boot-time account→session resolver

**Input:** `src/cli/daemon-provider-session.ts`,
`src/cli/daemon-provider-session.test.ts`

**Action - RED:** a hermetic test seeds a temp data root using the real
`createProviderAccountRegistry` / `createProviderCredentialStore`: add one
`openai-codex` account and write a fake OAuth credential for it. It then asserts
`resolveDaemonProviderSession({ dataRoot, accountLabel, modelId: "gpt-5.5" })`
resolves to a session with `model.provider === "openai-codex"`,
`model.id === "gpt-5.5"`, and `typeof streamFn === "function"`, with no network
call. Further cases: an empty data root rejects with an error message containing
`kanthord login` and writes no credential; two accounts with no label reject with
an error naming `--account`; an account without `defaultModel` and no `modelId`
rejects with an error naming `--model`.

**Action - GREEN:** implement `resolveDaemonProviderSession({ dataRoot,
accountLabel?, modelId? })` in `src/cli/daemon-provider-session.ts`: build the
registry + store rooted at `dataRoot`, select the account (by label, else the
sole account, else fail closed), resolve the model id (explicit → account
`defaultModel` → fail closed), call `buildProviderSession`, and return
`{ model, streamFn }`. Errors are typed and redaction-safe.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/cli/daemon-provider-session.test.ts` green.

### Task T2 - buildRealDeps injects the resolved session as spawn default

**Input:** `src/cli/run-deps.ts`, `src/cli/run-deps.test.ts`

**Action - RED:** a hermetic test calls `buildRealDeps` with a stub agent factory
and new optional inputs `providerModel` (a model with `provider:"openai-codex"`)
and `providerStreamFn` (a stub function). It asserts that calling the returned
`spawnAgent` with opts that omit `model`/`streamFn` invokes the agent factory with
that `providerModel` and `providerStreamFn`; and that when `spawnAgent` opts do
carry their own `model`/`streamFn`, the caller's values are used instead.

**Action - GREEN:** add optional `providerModel` / `providerStreamFn` to
`BuildRealDepsOpts` and, in the `spawnAgent` closure, default the spawned model
and streamFn to them (`spawnOpts.model ?? providerModel`,
`spawnOpts.streamFn ?? providerStreamFn`). No other behavior change.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/cli/run-deps.test.ts` green (existing cases still pass).

### Task T3 - run.ts flags + data root + resolver wiring

**Input:** `src/cli/run.ts`

**Action - RED:** none - GREEN-only. `run.ts` is the thin real-adapter shell
(Epic 019.2 pattern); its argument parsing is verified by `--help` and its
resolution/injection behavior is covered by T1 and T2. No hermetic test may make
the real model call this shell exists to enable.

**Action - GREEN:** add `--account <string>` and `--model <string>` to the
`parseArgs` options and to `USAGE`; compute `dataRoot = process.env.KANTHORD_DATA
?? join(homedir(), ".kanthord")`; `await resolveDaemonProviderSession({ dataRoot,
accountLabel: values.account, modelId: values.model })`; pass the resulting
`model` / `streamFn` into `buildRealDeps` as `providerModel` / `providerStreamFn`.
A resolver failure prints its message to stderr and exits non-zero before the
daemon starts.

**Action - REFACTOR:** none.

**Verify:** `npm run typecheck` exits 0; `node src/cli/run.ts --help` exits 0 and
lists `--account` and `--model`.

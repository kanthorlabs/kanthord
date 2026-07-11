# AI providers — multi-account engine

kanthord runs tasks on AI-provider **accounts**. You can hold many accounts —
including many of the **same** kind (for example ten Codex subscriptions, one per
repo) — pick one per run, and kanthord **durably binds** that account to the task
so every spawn, respawn, and daemon restart keeps running on the same account.

All provider work goes through `@earendil-works/pi-ai`. Credentials stay in
**kanthord custody** (a 0600 file keyed by account id), never in `~/.pi`.

> Scope: this page covers the **core engine** built in Epic 019.4 and its CLI.
> Epic 026 exposes these same core operations over the control-plane API and
> Epic 027 wires the dashboard UI — **both are wiring only, no logic**. The CRUD,
> the login operation, the resolver, and the durable binding are all owned here.
> *Switching* a running task from one account to another is **Epic 043**, which
> updates the binding this engine writes (see [Switching](#switching-epic-043)).

## Provider kinds

Three kinds ship. Claude is **deferred** (see [Claude](#claude-deferred)).

| Kind | Auth | Notes |
| --- | --- | --- |
| `openai-codex` | OpenAI OAuth, device-code | headless-friendly login |
| `github-copilot` | GitHub OAuth, device-code | supports the **enterprise host** (base URL derived from the token's `proxy-ep`) |
| `openai-compatible` | api-key in custody | custom `baseUrl` + `api` type + model (local proxy, vLLM, Azure-style) |

The domain separates **provider kind** from **provider account**. An account is
`{ id, providerKind, label, credentialKey, defaultModel? }` — a stable opaque id
(`acct_<uuid>`), a human label (`work`, `repo-a-1`), and a credential under
kanthord custody. The account id maps to a pi-ai provider-instance id **only at
the pi-ai boundary**; the domain never uses `openai-codex/work`-style slugs.

## Managing accounts from the CLI

The registry (`createProviderAccountRegistry`, `src/agent/provider-account-registry.ts`)
gives full CRUD. Multiple accounts of one kind coexist.

- **add** — `registry.add({ providerKind, label, defaultModel? })` → a new
  `ProviderAccount` with a fresh `acct_<uuid>` id.
- **get** — `registry.get(id)`; unknown id throws a typed error naming the id.
- **list** — `registry.list({ kind? })`; optional kind filter.
- **update** — `registry.update(id, { label?, defaultModel? })`.
- **remove** — `registry.remove(id)`; also deletes the account's credential.

Accounts persist to `<dataRoot>/accounts.json`.

## Logging in

`kanthord login <kind> --account <label>` drives the device-code flow
(`src/cli/login.ts`). Kind aliases: `openai` and `openai-codex` →
`openai-codex`; `copilot` and `github-copilot` → `github-copilot`;
`openai-compatible`.

What you see: the command prints the **user code** and the **verification URL**
from the provider. Open the URL, enter the code, and approve. On completion the
`{ type: "oauth" }` credential is written to the store **keyed by the account
id**. A cancel or timeout writes nothing. An unknown kind, a missing
`--account`, or an unregistered login seam returns a non-zero exit code and
writes nothing.

The login is an **observable operation** (`startLoginOperation`,
`src/agent/login-operation.ts`): its state moves `device-code` (user code + URL)
→ `pending` → `complete` | `failed`. The terminal renders it now; a UI can
render and poll the same operation later.

For an `openai-compatible` account you do not device-code login — you store the
api-key credential and register the endpoint config (`baseUrl`, `api`, models)
via `createOpenAICompatibleConfigStore` (`<dataRoot>/openai-compatible-configs.json`).

## Custody

Credentials live in a **0600 JSON file keyed by account id**
(`src/agent/provider-credential-store.ts`, mirroring `src/git/keyring.ts`
invariants). The store implements pi-ai's `CredentialStore`, so pi-ai runs OAuth
refresh through `modify()` and the **rotated token is persisted** back to the
file. A store file broader than 0600 (or the wrong owner) raises a typed custody
error (`insecure-file-mode`). Logs emit credential **type tags only** — never a
raw token.

## Running against a chosen account

`buildProviderSession({ accountId, modelId }, { registry, store, openaiCompatibleConfigStore? })`
(`src/agent/provider-session.ts`) returns `{ model, streamFn }`:

- the `model`'s runtime provider is registered under the **account id** so
  pi-ai routes the call to that account's instance;
- for `github-copilot`, the enterprise base URL is derived from the token's
  `proxy-ep` when present;
- for `openai-compatible`, the `model` carries the configured custom `baseUrl`;
  an unregistered account/model or a missing api-key is a typed error naming the
  failing entry.

The session is threaded into the real pi `Agent` through the existing spawn seam
(`makeAgentOpts` in `src/agent/pi-agent-adapter.ts`): the Agent receives the
`model` + `streamFn` and **no `getApiKey`**. Setting `getApiKey` would make
pi-ai take the api-key branch and skip OAuth base-URL derivation → `421
Misdirected Request`; the Models-backed `streamFn` owns auth, headers, and the
token-derived base URL instead.

## The durable per-task binding

At account selection kanthord writes a **durable record** `task → { accountId,
modelId }` in daemon-owned run/task metadata (`<dataRoot>/account-bindings.json`,
**not** `STATE.md`). The resolver reads it on **every** spawn:

- `resolveOrBindAccount` precedence — **existing binding** > `slotAccountId` >
  `defaultAccountId`; no source available is a typed "no account" error.
- Because the binding wins, a spawn, a respawn, and a spawn after a daemon
  restart all resolve the **same** account. This is what makes long-running
  tasks viable.

Basic repo/slot→account selection picks the account for the first spawn; the
rich 5-level precedence chain stays in Epic 024.

### Switching (Epic 043)

This engine delivers account **resolution + a durable binding** only. The *act
of switching* a running task from one account to another — the triggers, the
tier guards (same-model-account is safest; cross-provider needs manual
approval), boundary-only (respawn/retry) application, and operator notification —
is **Epic 043**, which **updates** the binding written here. 019.4 does **not**
do automatic or mid-session switching. The authoritative binding record is the
seam Epic 043's switch flips.

## Claude (deferred)

Claude is not shipped here. The Claude Agent SDK is a subprocess engine that
conflicts with kanthord's in-process `Agent` invariant and per-call budget.
Claude via the pi-ai `anthropic` provider (API key + Claude Pro/Max OAuth) would
fit this same pattern — a later, separate decision, tracked as an open item.

## Maintainer live proof (Podman)

The automated gate is **hermetic** (fakes for OAuth, a pi-ai `Models` double, no
network). To prove one real credentialed call per shipped kind, a maintainer runs
the live smoke against an **isolated credential copy** — inside Podman, or
natively on macOS. Point `KANTHORD_DATA` at a throwaway data dir so real
credentials never touch your working `.data/` (the login CLI and the smoke both
read `KANTHORD_DATA`; `KANTHORD_DATA_ROOT` is accepted as a fallback):

1. (Podman) `make machine-up` once per boot, then `make shell`; or run natively.
2. `KANTHORD_DATA=/path/to/scratch node src/cli/login.ts <kind> --account <label>`
   for each kind (`openai`/`openai-codex`, `github-copilot`) — the CLI prints a
   user code + verification URL; open the URL, enter the code, approve. For
   `openai-compatible`, store the api-key + endpoint config instead.
3. `KANTHORD_DATA=/path/to/scratch node test/live/provider-smoke.ts` — makes **one
   real call per registered kind**, returns a marker, and records cost + a
   per-run table row in the runbook below.
4. Confirm the add-account → login → run → remove flow from this page matches the
   `node src/cli/login.ts --help` output.

Verified 2026-07-11: `openai-codex` PASS (real call, marker returned, cost
$0.0001). `openai-compatible` and `github-copilot` pending.

The full procedure and the recorded run live in
`.agent/plan/feedback/019.4-ai-provider-integration/provider-live-proof.md`.

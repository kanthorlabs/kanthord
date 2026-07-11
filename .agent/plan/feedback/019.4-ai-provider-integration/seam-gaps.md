# Findings Out — 019.4 AI Provider Integration

Recorded 2026-07-11 during the 019.4 TDD build (orchestrated `/work`). These are
the seam observations the assembly revealed. All were satisfied by assembling
existing seams — none invented a new session/agent mechanism. Owning epic: 019.4
unless tagged otherwise.

## Seam additions made here (019.4 wiring)

- **`makeAgentOpts` model + streamFn threading** — `AgentAdapterOpts`
  (`src/agent/pi-agent-adapter.ts`) gained an optional `streamFn?: StreamFn`
  (`StreamFn` re-exported from `@earendil-works/pi-agent-core`). When `streamFn`
  is present, `makeAgentOpts` sets `AgentOptions.streamFn` and **skips** the
  `getApiKey` branch. `AgentOptions.streamFn` already existed in pi-agent-core's
  type, so no cast was needed. The non-session `getApiKey` path is preserved.
  The thread was then extended end-to-end through the spawn seam (Ulrich,
  2026-07-11 — S3 not deferred): `PiSpawnOpts`, `PiRespawnOpts`, and the
  `FakePiSurface.spawnAgent` opts (`src/agent/pi-session.ts`) carry optional
  `model?` / `streamFn?`; both `spawnPiSession` and `respawnPiSession` forward
  them to `piSurface.spawnAgent`; and the real `PiSurface.spawnAgent` in
  `src/cli/run-deps.ts` extracts them from `rawOpts` and passes them to
  `makeAgentOpts`. Proven by a capture-via-`agentFactory` test that a spawned
  session hands the real Agent the `model` + `streamFn` and **no** `getApiKey`
  (`src/cli/run-deps.test.ts`, `src/agent/pi-session.test.ts`). What remains for
  026/027 is only **choosing** the account per task and calling the resolver at
  the scheduler tick — see the 026/027 wiring note.

- **Multiple provider instances of one kind under distinct account ids** —
  confirmed workable. `buildProviderSession` registers a custom `Provider<Api>`
  under the **account id** via `models.setProvider`, and `model.provider ===
  accountId` routes `models.streamSimple` to that instance. So two
  `openai-codex` accounts with distinct labels register as two distinct pi-ai
  provider instances keyed by their account ids — no slug collision. (Proven
  hermetically against a pi-ai `Models` double, not a live multi-account call.)

- **Where the durable binding lives** — a daemon-owned JSON file
  `<dataRoot>/account-bindings.json` (`src/agent/account-binding.ts`), **not**
  `STATE.md`. A single global promise chain serializes all reads+writes (all
  tasks share one file, unlike the credential store's per-account chains). ENOENT
  on read = empty store. Restart durability is proven by constructing a second
  `AccountBindingStore` on the same `dataRoot` and reading the same binding back
  from disk. **Open**: this file is standalone today; when the scheduler/task
  store gains a first-class metadata home, fold the binding into it (or keep it
  adjacent and document the two-file invariant).

## CORRECTION to the EPIC anchor: provider-instance id (found by the live proof)

The EPIC Decision Anchor said *"the runtime instance is registered under the account
id."* **The github-copilot live proof (2026-07-11) proved that wrong.** pi-ai
**hard-codes** kind-specific behavior on a literal `model.provider === "github-copilot"`
(`node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js:330` builds the
Copilot dynamic headers; `:622` selects Bearer auth). Registering the runtime instance
under the account id (`model.provider = accountId`) means that branch never fires → the
Copilot request goes out with no `Authorization` header → the enterprise proxy returns
`400 bad request: missing required Authorization header`. openai-codex only worked
because its API does not hard-code on the provider id.

**Corrected mechanism (built in Story 003 fix `003-provider-id-mechanism`):** the model
carries the **canonical pi-ai provider kind id** (`model.provider = account.providerKind`),
and account isolation moves to a **per-session credential adapter** — `createModels({
credentials: adapter })` where the adapter maps the canonical provider id to *this*
account's stored credential (`read`/`modify` delegate to the real store under the
account's `credentialKey`, so per-account OAuth refresh still persists). Multiple accounts
of one kind stay isolated because each session/`Models` instance is scoped to one
account's credential — they never share a `Models` instance. openai-compatible keeps its
synthetic-provider path (no canonical hard-coding there). Verified live: real Copilot call
succeeds (marker returned, cost ~$0.00015). **Note for Epic 043/026:** the account→pi-ai
mapping is the credential adapter, not a provider-id rename.

## Custody backend decision

- **0600-file custody suffices for now.** `src/agent/provider-credential-store.ts`
  implements pi-ai `CredentialStore` over a 0600 JSON file keyed by account id,
  mode-checked (`insecure-file-mode`), value-redacted logs, and `modify()`
  persisting rotated OAuth tokens. A real OS-Keychain backend is **not** required
  to ship the engine; revisit only if a deployment needs OS-level secret storage
  (would slot in behind the same `CredentialStore` interface).

## Note for Epic 043 — the binding read/update contract

Epic 043's switch **updates** the record 019.4 writes. The contract 043 flips:

- **Read**: `resolveOrBindAccount({ taskId, ... }, store)` returns the existing
  `AccountBinding { accountId, modelId }` when present; precedence is **existing
  binding > slotAccountId > defaultAccountId**; no source is a typed "no account"
  error. The resolver reads on **every** spawn.
- **Update seam**: the switch must write a new `{ accountId, modelId }` for the
  task through `AccountBindingStore` (the same serialized write path) so the next
  spawn/respawn picks it up. 043 must apply the switch at a **boundary**
  (respawn/retry), never mutate a live Agent's model in place — a raw in-memory
  swap (pi's `setModel`) would desync the budget ledger, per-account audit, and
  checkpoint metadata. 043 owns the tier guards, triggers (gated on a typed
  provider-error taxonomy), and operator notification; 019.4 owns only the record
  and its read-on-spawn behavior.

## Not found / not needed

- No seam gap forced a correction to a depended-on seam (019.1/019.2/011). The
  `getApiKey`-suppression rule and the enterprise `proxy-ep` base-URL derivation
  matched the 2026-07-11 spike ([[copilot-provider-wiring]]).

# Story 001 - ProviderAccount registry + account-keyed credential store

Epic: `.agent/plan/epics/019.4-ai-provider-integration.md`

## Goal

The core state layer for multi-account providers: a `ProviderAccount` registry and a
credential store **keyed by account id** (not by bare provider kind), so many accounts —
including many of the same kind — coexist, each with its own credential. Full CRUD, so
the CLI now and Epic 026/027 later drive the same core operations. Custody follows
`src/git/keyring.ts`; the store satisfies pi-ai's `CredentialStore` so locked OAuth
refresh persists a rotated token.

## Acceptance Criteria

- A `ProviderAccount` is `{ id, providerKind, label, credentialKey, defaultModel? }`
  where `providerKind ∈ {openai-codex, github-copilot, openai-compatible}`; `id` is a
  stable opaque account id and `label` is human text. **Two accounts of the same
  `providerKind`** with different labels both register, both list, and are addressable
  by id — the bare-provider-kind key never limits it to one.
- CRUD round-trips: `add` returns an account with a fresh id; `get`/`list` return
  registered accounts (list filterable by kind); `update` changes label/defaultModel;
  `remove` deletes the account **and** its stored credential; operations on an unknown
  id are typed errors naming the id.
- The credential store keys by **account id**: storing an `{type:"oauth", access,
  refresh, expires, ...}` (or `{type:"api_key", key}`) credential under an account id
  and reading it back returns an equal credential; `read` of an unknown account id
  resolves `undefined`.
- `modify(accountId, fn)` is the sole write path: `fn` returning a new credential
  persists it (a later `read` returns it); returning `undefined` leaves it unchanged;
  writes to one account id are serialized (no lost update).
- Custody: the backing file is mode `0600`; a pre-existing store file broader than
  `0600` or not owned by the effective uid is a typed custody error (the `keyring.ts`
  error family); no emitted log line contains a raw `access`/`refresh`/`key` value.

## Constraints

- **Kind ≠ account** — the domain exposes `ProviderAccount`; the account id is mapped to
  a pi-ai provider-instance id **only at the pi-ai boundary** (Story 003), never as a
  slug like `openai-codex/work` (Decision Anchor: debate finding). The registry and
  store are the single source of truth an API/UI will CRUD.
- **Implements pi-ai `CredentialStore`** (`@earendil-works/pi-ai`
  `read`/`modify`/`delete`) so `Models.getAuth()` runs OAuth refresh inside `modify`.
- **Custody mirrors `src/git/keyring.ts`** — 0600, owner+mode check, value-redacted
  logs, typed errors (Epic 011 Story 000). Store lives under the kanthord data root,
  not `~/.pi` (kanthord-owned custody, Ulrich).
- **Single-writer per account id** via serialized read-modify-write; a cross-process
  lock (as pi coding-agent's `proper-lockfile`) is allowed but not required for the
  single-daemon MVP — if omitted, record it as a Findings gap for multi-process custody.
- Generalizes the spike `FileCredentialStore` (`src/agent/copilot-provider.ts`),
  hardened + re-keyed by account id.

## Verification Gate

- `npm test` green for the registry + store suites; typecheck 0; zero-network guard
  green.
- Multi-account (two same-kind accounts), CRUD round-trip, `modify` persistence,
  unknown-id typed errors, custody errors, and log redaction are asserted on a temp
  custody root.

### Task T1 - account-keyed credential store round-trip + modify

**Input:** `src/agent/provider-credential-store.ts`,
`src/agent/provider-credential-store.test.ts`

**Action - RED:** tests write an oauth credential under an account id and read it back
equal; a rotated `modify` is followed by a read returning the new value; a `modify`
returning `undefined` is a no-op; two credentials under two different account ids of the
**same** provider kind coexist; `read` of an absent id resolves `undefined`.

**Action - GREEN:** implement the `CredentialStore` (`read`/`modify`/`delete`) over a
0600 JSON file keyed by account id, per-account serialized read-modify-write.

**Action - REFACTOR:** fold the spike `FileCredentialStore` into this module.

**Verify:** `node --test src/agent/provider-credential-store.test.ts` — T1 green.

### Task T2 - custody invariants (perms, owner, redaction)

**Input:** `src/agent/provider-credential-store.ts`,
`src/agent/provider-credential-store.test.ts`

**Action - RED:** a store opened on a `0644` file asserts `insecure-file-mode`; a fresh
store file asserts mode `0600`; a store/read cycle asserts no raw `access`/`refresh`/
`key` appears in the captured log callback.

**Action - GREEN:** enforce 0600 on create, check mode+owner reusing the `keyring.ts`
error family, route logging through a redaction-safe callback.

**Action - REFACTOR:** none.

**Verify:** `node --test src/agent/provider-credential-store.test.ts` — T2 green.

### Task T3 - ProviderAccount registry CRUD

**Input:** `src/agent/provider-account-registry.ts`,
`src/agent/provider-account-registry.test.ts`

**Action - RED:** tests assert `add({providerKind, label})` returns an account with a
fresh id; `list()` and `list({kind})` return the registered accounts; **two same-kind
accounts** with different labels both appear; `update(id, {label})` changes it;
`remove(id)` deletes the account and calls the store to delete its credential; CRUD on
an unknown id is a typed error naming the id.

**Action - GREEN:** implement the registry over a persisted account table + the Story
001 credential store, with the CRUD operations and typed errors.

**Action - REFACTOR:** none.

**Verify:** `node --test src/agent/provider-account-registry.test.ts` — T3 green.

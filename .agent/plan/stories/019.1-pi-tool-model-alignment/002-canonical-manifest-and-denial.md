# Story 002 - Canonical Manifest and Network/Exec Denial Alignment

Epic: `.agent/plan/epics/019.1-pi-tool-model-alignment.md`

## Goal

The network/exec denial registry and its trusted-effectful set are aligned to pi's
real tool names. `bash` stays permanently blocked; pi's real file-mutating tools
(`edit`, `write`) are recognised as trusted effectful so a real-world registry
loads; and the canonical taxonomy exports the **default allowed manifest** — the six
non-exec pi tools (`read`, `grep`, `find`, `ls`, `edit`, `write`) with `bash`
excluded. `filterToolManifest` keeps the six and drops `bash`.

## Acceptance Criteria

- `src/agent/pi-tools.ts` exports `PI_DEFAULT_ALLOWED_MANIFEST` = exactly
  `{read, grep, find, ls, edit, write}` (order not significant), and it does **not**
  contain `bash`.
- `loadNetworkDenialRegistry` accepts a registry whose `allowlist` contains
  `edit` and `write` with `pure: false` — they resolve as trusted effectful and the
  load succeeds. A registry entry `read`/`grep`/`find`/`ls` with `pure: true` loads
  with no trusted entry needed.
- `loadNetworkDenialRegistry` still **rejects** a registry whose `allowlist` (or
  `pureClassified`) contains `bash`, with `NetworkDenialError` naming the tool
  (bash is permanently blocked — unchanged guarantee).
- `filterToolManifest` given the six real tools plus `bash` against a registry that
  allowlists the six returns `allowed` = the six real tools and `dropped` = `bash`.
- **Regression:** the pre-existing generic-name assertions in
  `network-denial.test.ts` (e.g. `write_file`/`read_file`/`fetch`) still hold — the
  generic network-capable / exec-shell fallback sets are kept as defense-in-depth.

## Constraints

- **Single source of truth:** the default allowed manifest and the file-mutating set
  live in `src/agent/pi-tools.ts` (Story 001). `network-denial.ts` reads pi's real
  names from there — the trusted-effectful default is the union of pi's file-mutating
  tools (`edit`, `write`) and the existing broker/gated-file names; the permanent
  exec block includes pi's `bash` (already covered by `EXEC_SHELL_CLASS_TOOLS`;
  assert it explicitly against the real name). Do not remove the existing
  `NETWORK_CAPABLE_TOOLS` / `EXEC_SHELL_CLASS_TOOLS` fallback sets (Epic Non-Goals).
- Owned by Epic 015 Story 003 (`003-agent-network-denial.md`): the deny-by-default
  filter, the allowlist registry, and the trusted-effectful gate are that story's
  contract — this story only widens the trusted default and pins the manifest to
  pi's names; it does not change the deny-by-default rule or the error type.
- Deterministic, no model seam (PRD §4).

## Verification Gate

- `npm test` green for `src/agent/pi-tools.test.ts` and
  `src/ring1/network-denial.test.ts`; `npm run typecheck` exits 0.

### Task T1 - Export the default allowed manifest from the taxonomy

**Input:** `src/agent/pi-tools.ts`, `src/agent/pi-tools.test.ts`.

**Action - RED:** Add a test asserting `PI_DEFAULT_ALLOWED_MANIFEST` equals the six
non-exec pi tools and excludes `bash`.

**Action - GREEN:** Export `PI_DEFAULT_ALLOWED_MANIFEST` (derived from the read-only
+ file-mutating sets, `bash` excluded) from `pi-tools.ts`.

**Action - REFACTOR:** none.

**Verify:** `npm test` green for `src/agent/pi-tools.test.ts`; `npm run typecheck`
exits 0.

### Task T2 - Trusted-effectful set and exec block aligned to pi names

**Input:** `src/ring1/network-denial.ts`, `src/ring1/network-denial.test.ts`.

**Action - RED:** Write tests that (a) load a registry allowlisting `edit` and
`write` with `pure: false` and assert success; (b) load a registry allowlisting
`read`/`grep`/`find`/`ls` with `pure: true` and assert success; (c) load a registry
allowlisting `bash` and assert `NetworkDenialError` naming `bash`; (d) call
`filterToolManifest` with the six real tools + `bash` against a six-tool allowlist
and assert `allowed` = the six, `dropped` = `[bash]`. Keep the existing generic-name
assertions intact.

**Action - GREEN:** Extend `DEFAULT_TRUSTED_EFFECTFUL.names` to include pi's
file-mutating tools (`edit`, `write`) alongside the existing entries, importing them
from `src/agent/pi-tools.ts`; assert `bash` remains permanently blocked via the
existing exec set.

**Action - REFACTOR:** Optional: derive the trusted-effectful and exec-block pi
entries from the `pi-tools.ts` sets so the names cannot drift; otherwise `none`.

**Verify:** `npm test` green for `src/ring1/network-denial.test.ts`;
`npm run typecheck` exits 0.

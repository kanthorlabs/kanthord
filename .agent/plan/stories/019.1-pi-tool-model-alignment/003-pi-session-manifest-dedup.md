# Story 003 - pi-Session Manifest De-Duplication

Epic: `.agent/plan/epics/019.1-pi-tool-model-alignment.md`

## Goal

`spawnPiSession` and `respawnPiSession` filter the tool manifest through the one
shared exec/blocked source of truth instead of the inline `BLOCKED_TOOL_NAMES`
literal they duplicate today. `bash` is still stripped from the manifest, the six
real pi tools pass through, and every other spawn behaviour is unchanged. This
removes the copy-drift between `pi-session.ts` and `network-denial.ts` so the two
cannot fall out of sync.

## Acceptance Criteria

- `spawnPiSession` given `allowedToolNames` = `{read, grep, find, ls, edit, write,
  bash}` spawns with a filtered manifest containing exactly the six non-exec tools;
  `bash` is absent. `respawnPiSession` behaves identically.
- A manifest with no exec tool (`{read, edit, write}`) passes through unchanged.
- **Behaviour parity (regression):** the pre-existing `pi-session` tests stay green
  — the ring-1 invariant (`NoRing1ChainError` when `ring1Chain` is undefined), the
  sanitized-env allowlist, the assembled system-prompt order, budget-ledger
  charging, and the `session_spawned` / `session_respawned` / `session_torn_down`
  journal events are all unchanged.
- `src/agent/pi-session.ts` no longer defines its own blocked-name literal; the
  exec/blocked names it filters on come from the shared taxonomy module.

## Constraints

- **Single source of truth:** delete the inline `BLOCKED_TOOL_NAMES` set and import
  the pi exec/blocked names from `src/agent/pi-tools.ts` (Story 001/002). The filter
  keeps its current shape (`allowedToolNames.filter(name => !blocked.has(name))`) —
  only its source of names changes. Owned by Epic 016 Story 002
  (`002-pi-session-lifecycle.md`): the spawn/teardown/respawn contract is that
  story's; this story changes only where the blocked set comes from.
- Do not change any other `spawnPiSession` / `respawnPiSession` behaviour or public
  type. This is a de-duplication refactor plus one filter-source assertion, not a
  redesign of the session seam.

## Verification Gate

- `npm test` green for `src/agent/pi-session.test.ts` (existing suite unchanged in
  intent plus the new filter-source assertions); `npm run typecheck` exits 0.
- `src/agent/pi-session.ts` contains no local `BLOCKED_TOOL_NAMES` literal (the
  blocked names are imported) — checkable by grep in the verify step.

### Task T1 - Filter the manifest from the shared blocked source of truth

**Input:** `src/agent/pi-session.ts`, `src/agent/pi-session.test.ts`.

**Action - RED:** Add tests asserting that `spawnPiSession` and `respawnPiSession`,
given `allowedToolNames` including `bash` and the six real tools, spawn (via the
`FakePiSurface`) with `tools` equal to the six real tools and no `bash`; and that a
manifest of `{read, edit, write}` passes through unchanged. (RED = these assert
against the imported source of truth; before GREEN the import does not exist.)

**Action - GREEN:** Remove the inline `BLOCKED_TOOL_NAMES` declaration; import the
pi exec/blocked names from `src/agent/pi-tools.ts` and filter both `spawnPiSession`
and `respawnPiSession` against it.

**Action - REFACTOR:** none (the two call sites already share the filter shape;
keep them reading the one imported set).

**Verify:** `npm test` green for `src/agent/pi-session.test.ts`; `npm run typecheck`
exits 0; `grep -n "BLOCKED_TOOL_NAMES = new Set" src/agent/pi-session.ts` returns no
match.

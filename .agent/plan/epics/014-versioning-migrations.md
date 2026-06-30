# 014 Versioning & Migrations

## Outcome
Provide per-file version-aware migration machinery that detects outdated files, returns an auto/manual migration plan, and never upgrades without explicit confirmation.

## Decision Anchors
- B8: every file has `version`; migration logic lives in the code that needs it; show auto/manual; never upgrade without confirmation.
- §8 Versioning & Migrations.

## Stories
- `.agent/plan/stories/014-versioning-migrations/001-confirmed-per-file-migrations.md` - detect, plan, confirm, apply, and failure safety for per-file migrations.

## Verification Gate
- `npm run typecheck` exits 0.
- `npm test` exits 0.

## Dependencies
- Epic 001.
- Epic 002 for `version` field and atomic write/lock.
- Epic 003 for config bad-version alignment.

## Non-Goals
- No central migration engine owning all module logic.
- No multi-file atomicity or batch recovery.
- No RPC/wire version compatibility.
- No backup/rollback beyond atomic write safety.

## Findings Out
- none

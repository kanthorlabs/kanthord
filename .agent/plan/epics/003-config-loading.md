# 003 Config Loading

## Outcome
Load and validate Core configuration once at startup with Zod, with explicit
precedence and fail-fast invalid-config behavior.

## Decision Anchors
- S5: Zod for config, not RPC.
- B4: env vars are dev/bootstrap fallback only; credentials are not config.
- B8 / §8: `version` field.

## Stories
- `.agent/plan/stories/003-config-loading/001-zod-config-startup-load.md` - startup config loading, defaults, env fallback, secret rejection, version validation, and native dependency guard.

## Verification Gate
- `npm run typecheck` exits 0.
- `npm test` exits 0.
- The no-native-modules guard passes with Zod installed.

## Dependencies
- Epic 001.
- Epic 002 for versioned-file read.

## Non-Goals
- No live reload.
- No full platform path discovery.
- No RPC message Zod validation.

## Findings Out
- none

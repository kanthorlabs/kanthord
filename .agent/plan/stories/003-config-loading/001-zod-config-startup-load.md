# Story 001 - Zod Config Startup Load

Epic: `.agent/plan/epics/003-config-loading.md`

## Goal
Core loads one trusted typed config object at startup, rejects invalid or secret-bearing config, applies built-in defaults, and treats env as per-key bootstrap fallback only.

## Acceptance Criteria
- A valid config file returns resolved values later modules read.
- Schema-invalid config refuses startup and names offending fields.
- Missing config uses built-in defaults and does not refuse startup.
- Config file values take precedence over env values.
- Env supplies only missing keys explicitly marked bootstrap-overridable.
- Auth key/secret and provider API keys in config are hard rejected with the field named.
- Config carries `version` starting at `1`.
- Missing, wrong-type, or higher-than-supported `version` fails fast.
- Config is loaded once at startup; no live reload.

## Constraints
- Zod validates config only at the load boundary (S5).
- Config is a single JSON file.
- v1 config path is one data/state-dir location or explicit bootstrap path.
- Env vars are bootstrap/fallback only and never default precedence (B4).
- Zod and dependency tree must have no native `.node` modules (D2).

## Verification Gate
- `npm run typecheck`
- `npm test`
- no-native-modules guard passes.

### Task 003-RED - Config behavior tests

**Input:** `packages/core/src/**/*.test.ts` or the config package test home.

**Action - RED:** Add `node:test` coverage for valid config resolved values, invalid fields named in failure, missing config defaults, env fallback only for omitted bootstrap keys, file precedence over env, secret-bearing config rejection, and bad `version` rejection.

**Action - GREEN:** none - RED only.

**Action - REFACTOR:** none.

**Verify:** `npm test` fails because the config loader is missing.

### Task 003-GREEN - Config loader and native guard

**Input:** `package.json`, `package-lock.json`, `scripts/**`, `packages/core/src/**` or the config package source home.

**Action - RED:** none - opened by Task `003-RED`.

**Action - GREEN:** Add Zod, implement startup config loading and validation, and add the no-native-modules guard.

**Action - REFACTOR:** Keep raw parsing at the boundary and expose a typed resolved config to consumers.

**Verify:** `npm run typecheck && npm test` exits 0 and the native guard passes.

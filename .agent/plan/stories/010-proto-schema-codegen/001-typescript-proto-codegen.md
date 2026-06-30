# Story 001 - TypeScript Proto Codegen

Epic: `.agent/plan/epics/010-proto-schema-codegen.md`

## Goal
The repo contains a minimal v1 proto surface, generated TypeScript wire code, and a mapping/type check tying the schema to named pi-agent-core exported types.

## Acceptance Criteria
- Schema defines a minimal v1 health/ping unary RPC.
- Schema defines one server-to-client streaming RPC carrying token-shaped messages.
- Generated TypeScript wire code type-checks.
- Proto message shapes correspond to named pi-agent-core exported types recorded in a mapping file.
- A type-level check asserts generated TS aligns with pi types.
- A message serialize/deserialize round-trips equal.
- Server-to-client streaming is expressible.
- Client-streaming and bidi are not included.
- Swift codegen is deferred.

## Constraints
- Proto is the wire source of truth (S5).
- No Zod on RPC messages.
- `.proto` sources live in `proto/`.
- Codegen uses buf for TypeScript in this milestone.
- TS Connect runtime must be pure JS / no native dependency.
- Serving is Epic 011.

## Verification Gate
- `buf generate`
- `npm run typecheck`
- `npm test`
- native guard passes.

### Task 010-SPIKE - pi type mapping and TS codegen

**Input:** `.agent/plan/findings/10-schema-derivation.md`.

**Action - RED:** none - spike.

**Action - GREEN:** Confirm pi-agent-core exported types, working buf TypeScript pipeline, selected pure-JS TS runtime, and schema-to-pi mapping.

**Action - REFACTOR:** none.

**Verify:** Findings file records mapping and codegen pipeline.

### Task 010-RED - Proto/codegen tests

**Input:** `proto/**`, generated-code tests under the chosen package test home.

**Action - RED:** Add coverage/checks for generated TS typecheck, message round-trip, and type-level mapping to named pi types.

**Action - GREEN:** none - RED only.

**Action - REFACTOR:** none.

**Verify:** The gate fails because schema/codegen are missing.

### Task 010-GREEN - Proto and TypeScript codegen

**Input:** `package.json`, `package-lock.json`, `buf*.yaml`, `proto/**`, generated TS output location, `packages/core/src/**` or rpc package source home.

**Action - RED:** none - opened by Task `010-RED`.

**Action - GREEN:** Add the minimal proto schema, buf TypeScript generation, mapping file, type-level check, and round-trip support.

**Action - REFACTOR:** Keep generated code in the selected generated-output home and avoid hand-editing generated files.

**Verify:** `buf generate && npm run typecheck && npm test` exits 0.

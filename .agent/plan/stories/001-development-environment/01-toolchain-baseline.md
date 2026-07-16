# Story 1 — Toolchain baseline

**Acceptance:** strict `tsconfig.json` proven by a real module; the repo's first
RED→GREEN cycle is green.

### Task S1-T1 — Audit tsconfig (maintainer-config)

**Pre-requirements.** None.

**Input.** `tsconfig.json` (exists today); the epic's toolchain requirements
(Node 24 type stripping, ESM).

**Action.** Audit — do not rewrite. Confirm these are present:
`verbatimModuleSyntax`, `allowImportingTsExtensions`, `strict`,
`noUncheckedIndexedAccess`, `module`/`moduleResolution: nodenext`,
`include: ["src/**/*.ts"]`. Edit only if a required flag is missing.
(All were present at authoring time.)

**Output.** A confirmed-strict `tsconfig.json` (unchanged, or with the missing
flag(s) added).

**Verify.** `npm run typecheck` → exit 0.

### Task S1-T2 — Hello domain module, test-first (src-in-lane)

**Pre-requirements.** S1-T1 (tsconfig confirmed); S4-T1 (read
`.agent/tdd/memory/ts-gotchas.md` before any `src/` edit).

**Input.** The confirmed `tsconfig.json`; the gotcha file; `node:test` +
`node:assert/strict` (built-in, no dependency).

**Action.** Test-first:
1. Write `src/domain/greeting.test.ts` first — imports `./greeting.ts` (explicit
   `.ts` extension), asserts the observable return value.
2. Run `npm test` → confirm RED for the right reason (module missing).
3. Implement `src/domain/greeting.ts` (pure, zero I/O — `domain/` rules).
4. Run `npm test` → GREEN.

**Output.** Two new files: `src/domain/greeting.ts` and
`src/domain/greeting.test.ts` — the repo's first green RED→GREEN cycle, proving
type stripping, ESM `.ts` imports, and the `node:test` runner all work.

**Verify.** `npm test` → the new test passes; `npm run typecheck` → exit 0.

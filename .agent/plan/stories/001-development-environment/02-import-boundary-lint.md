# Story 2 — Import-boundary lint

**Acceptance:** ESLint flat config encodes the 4 `AGENTS.md` import directions;
`npm run lint` exists and is green; a forbidden import is proven to fail lint by
an automated, re-runnable check.

### Task S2-T1 — Add complete ESLint + TypeScript stack (maintainer-config)

**Pre-requirements.** None.

**Input.** `package.json` + `package-lock.json`; `.npmrc` constraint
`min-release-age=3` (new deps must be ≥3 days old or install is blocked).

**Action.** Install a **complete** TS lint stack, not just `eslint`:
`eslint` + `typescript-eslint` (parser + config) + a boundary mechanism
(`eslint-plugin-import` with the TS resolver, or `eslint-plugin-boundaries`).
Bare `eslint .` will not parse `.ts` or resolve `.ts` imports without the
parser + resolver.

**Output.** Updated `package.json` devDependencies and `package-lock.json`,
with the stack installed under `node_modules/`.

**Verify.** Install exits 0 under the release-age cooldown;
`npx eslint --print-config src/main.ts` shows the TS parser active.

### Task S2-T2 — Flat config: explicit globs + test carve-out (maintainer-config)

**Pre-requirements.** S2-T1 (stack installed).

**Input.** The `AGENTS.md` `## Architecture` import-direction rules; the
installed plugins from S2-T1.

**Action.** Write `eslint.config.js` expressing allowed dependency edges
**by source glob**, not broad prose:
- `src/domain/**` → imports only `src/domain/**` + `node:*`.
- `src/app/**` → imports `src/domain/**`, `*/port.ts`, `node:*`
  (per `AGENTS.md`: no use-case-calls-use-case).
- only `src/main.ts` imports concrete adapters (`src/storage/sqlite/**`, …).
- `src/apps/**` → never imports adapters or `domain/` internals.
- **Test carve-out:** `src/**/*.test.ts` may import `node:test`, `node:assert`,
  and (co-located adapter tests) the adapter in their own directory. Scope the
  boundary rules to production files or add per-glob overrides.

**Output.** A new `eslint.config.js` encoding all four directions plus the test
carve-out.

**Verify.** `npx eslint .` runs with no config error.

### Task S2-T3 — `lint` script (maintainer-config)

**Pre-requirements.** S2-T2 (config exists).

**Input.** `package.json` scripts block.

**Action.** Add `"lint": "eslint ."` to `package.json` scripts.

**Output.** `npm run lint` is a runnable gate command (it appears in the epic's
Verification Gate line).

**Verify.** `npm run lint` → exit 0 on the current `src/` tree.

### Task S2-T4 — Automated negative boundary proof (maintainer)

**Pre-requirements.** S2-T2 (rules exist); recommended after Story 3 so
fixtures can reference the real adapter paths (`src/storage/sqlite/**`).

**Input.** The boundary rules from `eslint.config.js`; the real `src/` layout.

**Action.** Build a **committed, re-runnable** negative proof — not a manual
add-and-revert. Either a `RuleTester`-based test for the boundary config, or a
committed fixture directory of known-bad imports (e.g. a fake use case importing
`src/storage/sqlite/…`) checked by a script that asserts a **non-zero** eslint
exit.

**Output.** A committed test or fixture+script that fails lint on purpose and
asserts that failure — proof the rules actually fire.

**Verify.** Running the proof reports the forbidden imports (boundary rule id
present in output) and the proof itself passes; it re-runs on every
`npm run lint` / `npm test`. A rule that never fires is worthless.

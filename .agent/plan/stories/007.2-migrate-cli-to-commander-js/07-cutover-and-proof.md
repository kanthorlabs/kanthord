# Story 07 — Cutover, caller migration, help test, Proof

Epic: `.agent/plan/epics/007.2-migrate-cli-to-commander-js.md`
Requires: Stories 01–06 (the full 46-leaf Commander tree exists and is wired
into `buildProgram`).

## Goal

Make Commander the live parser and delete the custom router. Flip `src/main.ts`
to `parseAsync`, migrate every remaining caller of the old `dispatch`/`COMMANDS`/
`RouterDeps` to the new program, fix the `UnknownModelError` route pointer (B1),
update live docs/scripts that name old routes (never history), add the
architecture + help + old-spelling-rejection tests, delete `router.ts` and
router-only tests, and run the epic Proof. `npm run verify` green at the end.

## Callers to migrate (verified 2026-07-20)

- **Runtime:** `src/main.ts` (uses `dispatch`), `src/composition.ts` (returns
  `RouterDeps`).
- **Tests using `dispatch(...)`:** `src/composition.test.ts`,
  `src/apps/cli/{agent-smoke,e2e-smoke,daemon-smoke,daemon,list-tasks,
update-resource,graph-import-export.e2e,e2e-007.1-hardening,
router-positional.regression}.test.ts`.
- **Router-only tests (DELETE with `router.ts`):** `src/apps/cli/router.test.ts`;
  `router-positional.regression.test.ts` — fold its positional assertions into
  the new `special.test.ts` (import graph / export initiative) if not already
  covered, then delete.
- **Docs naming old routes (live — UPDATE):** `docs/flowchart/005.md`,
  `docs/flowchart/006.md` (`daemon run`, `events`), `README.md` if it names any.
  **Do NOT touch** `.agent/tdd/history/**`, `.agent/tdd/memory/**`, or closed
  epics/stories (`007.1`, etc.).

## Locked contracts

```ts
// src/apps/cli/commands/run-cli.ts  (new)  — hermetic test driver, NOT a route alias.
// Runs the real program and returns the SAME shape the old dispatch returned,
// so E2E/smoke tests migrate by import + route-spelling swap, not assertion rewrites.
export async function runCli(
  argv: string[], // e.g. ["create","project","--name","x"]
  deps: CliDeps,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }>;
// Impl: build capturing io (out/err strip the single trailing "\n" emitResult adds,
// push bare lines); buildProgram(deps, io).exitOverride().configureOutput({writeOut,
// writeErr → same arrays}); await program.parseAsync(argv, { from: "user" });
// on a thrown CommanderError, map it to { exitCode: err.exitCode||1, stderr: [err.message] }.
```

## Verification Gate

`npm run verify` green (typecheck + test + verify:handoff + lint + db status);
the epic Proof block runs clean and prints `PROOF OK`.

---

### Task T1 — `runCli` test driver + `composition.ts` deps import

**Requires:** Story 06 T5.

**Input:** `src/apps/cli/commands/run-cli.ts` (new),
`src/apps/cli/commands/run-cli.test.ts` (new), `src/composition.ts`.

**Action — RED:** in `run-cli.test.ts`: `runCli(["db","migrate"], deps)` returns
`{ exitCode:0, stdout:[…bare lines…], stderr:[] }`; `runCli(["bogus"], deps)`
returns `exitCode` non-zero with an `unknown command` line in `stderr` (no
process exit — proves `exitOverride` mapping). Fails today: module missing.

**Action — GREEN:** implement `run-cli.ts` per the locked contract. Update
`src/composition.ts` to `import type { CliDeps } from "./apps/cli/deps.ts"` and
return `CliDeps` (Story 01 left `RouterDeps = CliDeps`, so this is a type-name
swap only).

**Action — REFACTOR:** none.

**Output:** a hermetic driver returning the legacy result shape; composition no
longer names `RouterDeps`.

**Verify:** `node --test src/apps/cli/commands/run-cli.test.ts` green;
`npm run typecheck` 0.

---

### Task T2 — flip `src/main.ts` to `parseAsync`

**Requires:** T1.

**Input:** `src/main.ts`, `src/main.test.ts` (if present; else a smoke assertion
via `run-cli`).

**Action — RED:** a test that the program runs a real command via the new path
(e.g. `runCli(["db","status"], buildDeps(tmpDb))` exits 0). Before the flip,
`main.ts` still routes through `dispatch`; after, through `buildProgram`. (The
behavioral proof is the epic Proof in T7.)

**Action — GREEN:** replace the `dispatch(...)` block in `main.ts` with
`const program = buildProgram(deps); await program.parseAsync(process.argv);`.
Remove the manual stdout/stderr writing loop (the default `processIo` inside
`buildProgram` now writes output and sets `process.exitCode`). Keep the
`KANTHORD_DB` / `KANTHORD_MAX_TURNS` env handling unchanged.

**Action — REFACTOR:** none.

**Output:** Commander is the live parser; `main.ts` no longer imports `dispatch`.

**Verify:** `node src/main.ts --help` shows the Commander tree; `node src/main.ts
db status` works; `npm run typecheck` 0.

---

### Task T3 — fix `UnknownModelError` route pointer + locked test (B1)

**Requires:** Story 04 T4 (`list model` exists).

**Input:** `src/model-catalog/port.ts`, `src/model-catalog/port.test.ts`.

**Action — RED:** update the assertion in `port.test.ts` to require the message
contains `"list model"` (and no longer `"get models"`). Fails against the current
message. Confirm no other test asserts `"get models"` as a route pointer (the
`007.1` composition tests assert the substring is forwarded to stderr — update
those to `"list model"` too if they pin the exact old text; leave history files
untouched).

**Action — GREEN:** change the message in `port.ts` from ``Run `get models` …``
to ``Run `list model` …``.

**Action — REFACTOR:** none.

**Output:** the unknown-model error points at the live `list model` route.

**Verify:** `node --test src/model-catalog/port.test.ts` green; grep confirms no
live `src/**` code/test still tells the user to run `get models`.

---

### Task T4 — migrate `dispatch` test callers to `runCli` + new route spellings

**Requires:** T1, T2.

**Input:** `src/composition.test.ts`, `src/apps/cli/{agent-smoke,e2e-smoke,
daemon-smoke,daemon,list-tasks,update-resource,graph-import-export.e2e,
e2e-007.1-hardening}.test.ts`.

**Action — RED:** these tests fail once `router.ts` is deleted (T7). Migrate them
first: replace `import { dispatch } from "./router.ts"` (and `RouterDeps`) with
`runCli` / `CliDeps`; replace each `dispatch(argv, deps)` with `runCli(argv,
deps)`; and rewrite any old-route argv to the new spelling (`["daemon","run",…]`
→ `["run","daemon",…]`; `["events",…]` → `["list","event",…]`; `["get","models"]`
→ `["list","model"]`; `["diagnostics","export",…]` → `["export","diagnostic",…]`;
`["repo","land",…]` → `["land","repository",…]`; `["login","<p>",…]` →
`["login","provider","--provider","<p>",…]`). Assertions stay (same result
shape).

**Action — GREEN:** apply the swaps; keep each test's assertions intact.

**Action — REFACTOR:** none.

**Output:** every live test drives the real Commander program via `runCli`.

**Verify:** `node --test src/apps/cli/*.test.ts src/composition.test.ts` green
(with `router.ts` still present).

---

### Task T5 — update live docs / scripts naming old routes

**Requires:** T2.

**Input:** `docs/flowchart/005.md`, `docs/flowchart/006.md`, `README.md`,
`scripts/*` (only if they invoke a changed route — verified: `lane-check.sh`,
`verify-handoff.mjs` do not).

**Action — RED:** grep the live set (`docs/`, `README.md`, `scripts/`) for the
five old spellings + positional `login`; each hit is a task item.

**Action — GREEN:** rewrite each live hit to the canonical route. Leave
`.agent/tdd/**` and closed epics/stories verbatim.

**Action — REFACTOR:** none.

**Output:** live docs/scripts use the canonical routes; history untouched.

**Verify:** `grep -rE 'daemon run|get models|diagnostics export|repo land' docs
README.md scripts` returns nothing; `.agent/tdd/**` still contains the old text.

---

### Task T6 — architecture + help-completeness + old-spelling-rejection tests

**Requires:** T2.

**Input:** `src/apps/cli/index.test.ts` (extend), `src/apps/cli/architecture.test.ts`
(new).

**Action — RED:** (a) **Architecture:** read `src/apps/cli/index.ts` source and
assert it contains no `.action(`, `.option(`, `.requiredOption(`, or
`.argument(` (assembly only); assert `src/apps/cli/commands/` has one leaf file
per registered leaf (count files under `commands/*/` vs the 46-leaf inventory).
(b) **Help completeness:** traverse `buildProgram(deps).commands` recursively;
for every leaf (no subcommands) assert a non-empty `.description()` and that its
captured help output contains `Usage:` and `Example`. (c) **Old-spelling
rejection:** `runCli` each of `["daemon","run"]`, `["events"]`, `["get","models"]`,
`["diagnostics","export"]`, `["repo","land"]`, `["login","openai-codex"]` returns
a non-zero exit with an unknown-command/argument message. Fails today: tests do
not exist.

**Action — GREEN:** add the three tests. (No production change expected; if help
completeness fails for a leaf, add the missing description/example to that leaf
file.)

**Action — REFACTOR:** none.

**Output:** structural guarantees that the router layer stays thin, help is
complete, and old routes are gone.

**Verify:** `node --test src/apps/cli/architecture.test.ts src/apps/cli/index.test.ts`
green.

---

### Task T7 — delete `router.ts` + router-only tests; run the epic Proof

**Requires:** T1–T6.

**Input:** `src/apps/cli/router.ts` (delete), `src/apps/cli/router.test.ts`
(delete), `src/apps/cli/router-positional.regression.test.ts` (fold then delete),
`src/apps/cli/deps.ts` (drop the `RouterDeps = CliDeps` alias if now unused).

**Action — RED:** confirm no live import of `./router.ts` remains
(`grep -rn "router.ts" src` → only the file itself). Any straggler is fixed here.

**Action — GREEN:** delete `router.ts` and the router-only tests; remove the
`RouterDeps` alias if nothing references it; ensure `deps.ts` is the sole home of
`CliDeps`/`Logger`.

**Action — REFACTOR:** none.

**Output:** the custom parser is gone; Commander is the only router.

**Verify:** `npm run verify` green; then run the epic **Proof** block verbatim
(`.agent/plan/epics/007.2-migrate-cli-to-commander-js.md` §Verification Gate) and
confirm it prints `PROOF OK`.

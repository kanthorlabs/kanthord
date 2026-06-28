# Project Profile — kanthord Core (TDD pipeline)

Filled from the skeleton at `../../dotagents/tdd`. Renders the four-role TDD
pipeline for **Core** (the Node 24 / TypeScript daemon). Single variant `core`.

> render.py constraint honored throughout: slot bodies use `####` sub-headings
> only and contain no `---` rule lines (a bare `---` or `## `/`### ` line ends a
> slot body early). The token table below is strictly two columns.

## 1. Path & constant tokens

| Token | Value |
|---|---|
| `{{REPO_NAME}}` | `kanthord` |
| `{{PLAN_EPICS_DIR}}` | `.agent/plan/epics/` |
| `{{PLAN_STORIES_DIR}}` | `.agent/plan/stories/` |
| `{{PLAN_FEEDBACK_DIR}}` | `.agent/plan/feedback/` |
| `{{DISCUSSION_DIR}}` | `.agent/tdd/history/` |
| `{{DRAFT_DIR}}` | `.agent/tdd/` |
| `{{MEMORY_DIR}}` | `.agent/tdd/memory/` |
| `{{AGENT_DIR}}` | `.claude/agents/` |
| `{{DEFAULT_TURN_CAP}}` | `128` |
| `{{ATTEMPT_LIMIT}}` | `3` |
| `{{LOCATOR_DEFN_LABEL}}` | `UI locators (not applicable — Core has no UI)` |
| `{{ENV_HANDOFF_LABEL}}` | `Pre-flight resource` |

## 2. Slots

### `{{> VARIANT_VALUES}}`
core

### `{{> GATE_LABEL_EXAMPLES}}`
`core typecheck` (npm run typecheck) and `core unit` (npm test), each exit 0

### `{{> JOIN_GATE_TARGETS}}`
`core` only (single variant) — run npm run typecheck then npm test; --join is effectively a no-op since there is nothing to merge

### `{{> TE_FRONTMATTER}}`
description: "TDD test-engineer for kanthord Core — writes the failing node:test (RED), confirms GREEN, signals ready. Never touches production code."
model: sonnet

### `{{> SE_FRONTMATTER}}`
description: "TDD software-engineer for kanthord Core — makes the failing test pass (GREEN) plus the named REFACTOR. Never writes or runs tests."
model: sonnet

### `{{> RV_FRONTMATTER}}`
description: "TDD reviewer-engineer for kanthord Core — read-only review against cited sources, blocker/suggestion verdict. Never edits or runs anything."
model: opus
tools: Read, Grep, Glob

### `{{> PROJECT_CONTEXT}}`
**kanthord Core** is one long-running daemon written in **Node.js 24+ /
TypeScript** (ES modules, `"type": "module"`, engines `node >= 22.19.0`). Tests
run on the built-in **`node:test`** runner with `node:assert` — no Jest, no
Vitest, no test framework dependency. Hard constraints every engineer MUST
honor (from `.agent/milestone/01-infrastructure/`):

- **File-based storage only — no SQL, no SQLite.** Every persisted file carries
  a `version` field. Writes are single-writer + atomic (write-temp-then-rename)
  + file lock (N1).
- **No native `.node` modules** (D2) — keeps the SEA build and cross-arch
  trivial. Need native code → fork and build it ourselves.
- **`@earendil-works/pi-agent-core` + `pi-ai` (pinned 0.80.2) ARE the agent/AI
  adapter** (D3). Do NOT wrap them in another abstraction.
- **proto owns the RPC wire contract — do NOT re-validate RPC messages with
  Zod** (S5). Zod is for config, tool input schemas, and agent outputs only.
- **Security is one chokepoint:** every tool call passes `canRun(tool, args,
  ctx)`, default-allow with a small denylist (D4/B3).
- **All infra (logging, queue, pub/sub, locking, scheduler) is file-based,
  in-process** — no Redis, no external brokers (D5).
- Platform-specific behavior lives behind the **capability layer** (`host` vs
  `client`); the default impl **throws "unsupported"** until built (§7).

### `{{> VARIANTS_AND_SCOPES}}`
**One variant: `core`.** Core (the daemon) is the whole product for this
pipeline. The Web SPA, the macOS/iOS Swift app, and the CLI are pure
visualization over one gRPC schema and ship from separate bakes (the Swift app
in particular is a different language and gets its own pipeline later).

- **`core`** — owns `src/`. Build target: the TypeScript program type-checked by
  `tsc` and exercised by `node --test`. No dependency on any other variant.

Because there is exactly one variant, the worktree / `--variant` / `--join`
machinery collapses to a no-op: `/work <epic>` runs serially in the main tree.
There are no cross-variant shared files and therefore no merge policy to define.

### `{{> SOURCE_AND_TEST_LAYOUT}}`
- **Production source:** `src/**/*.ts` (excluding test files). ES modules;
  relative imports use explicit `.ts` extensions (Node 24 runs TypeScript
  directly via type stripping).
- **Unit tests:** co-located beside the unit under test as
  `src/**/*.test.ts`, using `node:test` + `node:assert/strict`.
- **No UI/E2E tests** — Core has no visual surface.
- **New-file naming:** a production module `src/foo/bar.ts` is tested by
  `src/foo/bar.test.ts` in the same directory.
- **Module/imports:** import a sibling production module by its `.ts` path
  (e.g. `import { greet } from "./greeting.ts"`).

### `{{> LANE_OWNERSHIP}}`
Tests are **co-located** with source (`bar.ts` + `bar.test.ts` in one dir), so a
prefix table cannot separate the lanes — this project uses a **predicate
script**: `scripts/lane-check.sh <role> <scope> <path>` (exit 0 = in-lane).

- **test-engineer** lane: `src/**/*.test.ts`, `src/**/*.spec.ts`, plus its draft
  files under `.agent/tdd/` and its journal under `.agent/tdd/memory/test-engineer/`.
- **software-engineer** lane: `src/**/*.ts` that is NOT a `*.test.ts` /
  `*.spec.ts`, plus its draft files under `.agent/tdd/` and its journal under
  `.agent/tdd/memory/software-engineer/`.
- **Always forbidden to BOTH** (the lane script denies these for every role):
  the locked plan tree `.agent/plan/**`; the pipeline files `.claude/**`;
  toolchain/config `package.json`, `package-lock.json`, `tsconfig*.json`,
  `*.config.*`, `scripts/**`; container/build files `Containerfile`,
  `compose.yaml`, `Makefile`; any generated proto output. The reviewer-engineer
  edits nothing at all.

The scope argument is always `core` (or `all`, the serial alias) — the lane
rules are identical for both since there is one variant.

### `{{> BUILD_AND_TEST_COMMANDS}}`
All commands run from the repo root.

- **Produce the handoff artifact (typecheck)** — software-engineer runs before
  every handoff: `npm run typecheck` (`tsc --noEmit`). For this interpreted
  stack the "artifact" is a clean type-check, not an emitted binary.
- **Run unit tests** — test-engineer only: `npm test` (`node --test`, discovers
  `src/**/*.test.ts`).
- **Run UI/E2E tests** — none (Core has no UI).
- **Verify the handoff artifact (machine-readable PASS/FAIL)** — the
  test-engineer re-runs this to independently confirm the SE's claim:
  `npm run verify:handoff` → prints `VERIFY: PASS` and exits 0 on a clean
  typecheck, prints `VERIFY: FAIL` and exits non-zero otherwise. It is a script
  (`scripts/verify-handoff.mjs`), not a grep.

Single variant → one build cache, no parallel-worktree isolation needed.

### `{{> ENV_PREFLIGHT}}`
None. Tests and typecheck run in-process with no emulator, database, browser, or
booted resource. The orchestrator skips Step 4 and passes `n/a` as the
pre-flight value to every dispatch.

### `{{> GOTCHA_FILES}}`
Read the relevant file **before** working in that area — not upfront.

- `.agent/tdd/memory/ts-gotchas.md` — before any TypeScript/ESM edit: explicit
  `.ts` import extensions under type stripping, `verbatimModuleSyntax`
  `import type` rules, `node:` builtin imports, top-level await.
- `.agent/tdd/memory/filedb-gotchas.md` — before touching the file-based store:
  atomic write-temp-then-rename must be on the same filesystem; lock
  acquire/release ordering; the mandatory `version` field; single-writer.

These files are seeded as living checklists; engineers append pitfalls as they
hit them (the test-engineer/software-engineer journals are separate, under
`.agent/tdd/memory/<role>/`).

### `{{> IDIOM_CHECKLIST}}`
Apply on every edit:

- **File-based persistence only** — no SQL/SQLite/ORM. Each persisted record is
  a file with a `version` field. Mutate via write-temp-then-rename + file lock;
  one writer at a time (N1).
- **No native `.node` modules** (D2) — pure JS/TS dependencies only.
- **pi-agent-core / pi-ai (0.80.2) used directly** (D3) — never wrapped in a
  home-grown abstraction layer.
- **Zod only for config, tool-input schemas, and agent outputs** — never to
  re-validate RPC messages; proto owns the wire (S5).
- **One security chokepoint** — route every tool call through `canRun(tool,
  args, ctx)`; default-allow + small denylist (D4/B3). Do not scatter ad-hoc
  permission checks.
- **File-based, in-process infra only** (D5) — no Redis, no external broker for
  logging/queue/pub-sub/locking/scheduling.
- **Capability layer** — platform-specific behavior lives behind a `host` vs
  `client` capability; the default implementation throws `"unsupported"` (§7).
- **ESM idioms** — `"type": "module"`; relative imports carry the `.ts`
  extension; use `import type` for type-only imports (`verbatimModuleSyntax`).
- **Logging** — `pino`, never `console.log` in production paths. No silently
  swallowed errors.
- **DI seam style** — inject collaborators through constructor/factory
  parameters typed by a small interface the consumer defines, so tests fake at
  that seam (no module-level singletons that tests cannot replace).
- **Surgical diffs** — smallest change that satisfies the failing assertion plus
  the named refactor; no speculative abstraction.

### `{{> TEST_CONVENTIONS}}`
- **Runner:** built-in `node:test`. Import `test` (and `describe`/`it` if
  grouping) from `node:test`; assert with `node:assert/strict`. No external test
  dependency.
- **File layout:** one `*.test.ts` beside the module it covers; the suite name
  is the module path; test names describe the user-observable behavior.
- **Imports:** a test imports the production seam by its `.ts` path. A test may
  import only the public surface of the module under test plus `node:` builtins
  and other test helpers under `src/**` — never reach into another module's
  internals.
- **Fake vs Mock:** a **Fake** returns generic safe defaults; a **Mock** returns
  the deterministic value the Story names. When a Story specifies a value, wire a
  Mock. Build fakes/mocks as small hand-written objects implementing the
  consumer's interface (no mocking library).
- **RED discipline:** a RED test must fail for the right reason now and pass once
  the named seam exists. Pin the observable mechanism (return value, thrown
  error, file written), not a private symbol.
- **Launch/setup:** none required — tests are hermetic and in-process. A test
  that touches the file store must use a temp dir it creates and removes.

### `{{> UI_LOCATOR_CONTRACT}}`
Not applicable — Core has no UI/E2E tests, so there is no locator registry and the test-engineer omits the locator section of its turn format

### `{{> COPY_SOURCING}}`
Not applicable — Core is a daemon with no locked user-facing copy; any user-visible string a test asserts comes from the Story's acceptance criteria

### `{{> REVIEW_DIMENSIONS}}`
Each finding cites a source (per the methodology table) and is classified
BLOCKER vs SUGGESTION with an `action:` tag.

- **File-DB integrity (top BLOCKER class).** Every persisted file carries a
  `version` field; writes use write-temp-then-rename on the same filesystem
  under a file lock; single-writer is preserved. A missing `version`, a
  non-atomic write, a dropped/unreleased lock, or a partial-write window is a
  BLOCKER. Cite `filedb-gotchas.md` + the line.
- **Constraint compliance.** No SQL/SQLite; no native `.node` module; no new
  forbidden dependency; pi-agent-core/pi-ai not wrapped; no Zod on RPC messages;
  every tool call passes the `canRun` chokepoint; infra stays file-based
  in-process. Cite the decision (D2/D3/D4/D5/S5) violated.
- **Capability-layer ownership.** Platform-specific code sits behind a
  `host`/`client` capability and the default throws `"unsupported"`; nothing
  platform-specific leaks into shared code. Cite §7.
- **Error handling & safety.** No swallowed errors; `pino` for logs; errors
  surfaced or wrapped with context. Cite the construct + why the property fails.
- **API/seam design.** A seam the tests/import depend on is shaped for its
  consumer; name the consumer hurt by a bad shape.
- **Simplicity.** Smallest correct change; no speculative abstraction; give the
  simpler equivalent when flagging.
- **AC coverage.** Every Story acceptance criterion is covered by a test or a
  cited proof. A gap is a BLOCKER (`action:YES` when the fix is mechanical).

There is no sketch phase, so no dimension is ever skipped.

### `{{> SKETCH_MODE}}`
Not applicable — this project has no sketch phase; all work is test-gated and the --sketch flag must error (there is no Phase A and no artifact-only review)

## 3. Optional capability flags

| Capability | Value |
|---|---|
| Multi-variant parallelism | no — single variant `core` |
| Sketch phase | no — `--sketch` errors |
| UI/E2E tests | no |
| Locked copy | no |

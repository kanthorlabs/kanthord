# Story 08 — Identity contract & find

Epic: `.agent/plan/epics/004-cli-work-graph.md`

## Goal

Add the `find <aggregate>` convenience (resolve a name → id within an explicit
scope; ambiguity → error listing candidates) and lock the ULID-only reference
discipline with an automated check. `find` is the ONLY name-based lookup; no
other flag accepts a name.

## Acceptance Criteria

- Find commands (name→id; the scope flag is a ULID, the `--name` is a name):
  - `find project --name <n>` (global scope)
  - `find initiative --project <id> --name <n>`
  - `find objective --initiative <id> --name <n>`
  - `find resource --project <id> --name <n>`
  - (`find task` is out — `Task` has `title`, not `name`; add later if needed.)
- Each prints the matching ULID as sole stdout (exit 0). No match →
  `UnknownReferenceError` → exit 1 one line. Multiple matches →
  `AmbiguousNameError{ids}` → exit 1 `error: multiple <kind> named <n>: <id>,
  <id>`.

## Constraints

- Find use cases reuse the `resolve*ByName` methods (S03-T1, S04-T1), which
  return `id[]` so ambiguity is detectable. No new domain. Wiring in `main.ts`.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — find use cases + handlers

**Requires:** S03-T1, S04-T1 (`resolve*ByName`); S01; S02.

**Input:** `app/project/find-project.ts`, `app/initiative/find-initiative.ts`,
`app/objective/find-objective.ts`, `app/resource/find-resource.ts` (+ tests);
`src/apps/cli/find.ts` (+ test).

**Action — RED:** use-case tests: one match → id; zero → `UnknownReferenceError`;
two → `AmbiguousNameError` with both ids. Handler tests: `find project --name
demo` → `{ exitCode: 0, stdout: [ulid] }`; ambiguous → exit 1 with both ids in
the line. Fails today: modules absent.

**Action — GREEN:** implement the four find use cases + handlers; register
`find project` / `find initiative` / `find objective` / `find resource` in
`COMMANDS`.

**Action — REFACTOR:** none.

**Output:** `find <aggregate>` resolves name → id with scoped ambiguity errors.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — identity discipline check (ULID-sole-stdout)

**Requires:** T1; S03; S04; S05.

**Input:** `src/apps/cli/identity.test.ts` (new).

**Action — RED:** a table-driven test drives every `create *` + `find *`
handler and asserts stdout is exactly one line matching the Crockford ULID
regex (`/^[0-9A-HJKMNP-TV-Z]{26}$/`), with all human text on stderr. Fails if
any handler leaks prose to stdout.

**Action — GREEN:** fix any handler that violates it (should already pass if
stories 03–05 + T1 followed the contract).

**Action — REFACTOR:** none.

**Output:** an automated regression proving the identity output contract across
all creates + finds.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

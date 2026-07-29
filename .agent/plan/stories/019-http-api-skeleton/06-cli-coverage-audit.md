# Story 06 — the CLI-coverage audit

Epic: `.agent/plan/epics/019-http-api-skeleton.md`
Depends on: Stories 03 and 05 (`serve` must exist before the audit can list it).

## Change

### New file `src/apps/http/deferred.ts`

```ts
export interface DeferredCommand {
  /** A CLI leaf path without the program name, e.g. "create project". */
  readonly cliCommand: string;
  readonly reason: string;
  /** The epic that will serve it, or "none" for a CLI-only command. */
  readonly epic: string;
}

export const DEFERRED: readonly DeferredCommand[];
```

**How to build the list, mechanically:** enumerate every leaf command path
produced by the walk in the test below, drop `get project` (served by
`projects.get`), and add one entry per remaining path. Assign `epic` by this
table — first matching rule wins:

| leaf path starts with                                                                                                                  | epic   | reason text                                            |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------ |
| `db `, `commands`, `serve`                                                                                                             | `none` | `local CLI administration; not a REST resource`        |
| `find `, `check `, `export `                                                                                                           | `020`  | `read surface`                                         |
| `ack `, `list event`                                                                                                                   | `021`  | `event feed and cursor paging`                         |
| `get `, `list `, `queue`                                                                                                               | `020`  | `read surface`                                         |
| `create `                                                                                                                              | `022`  | `planning writes`                                      |
| `add `, `remove `, `rename `, `assign `, `unassign `, `pause `, `resume `, `approve `, `reject `, `abandon `, `retry `, `set-default ` | `023`  | `state transitions`                                    |
| `land `, `publish `, `update `, `register `, `logout `                                                                                 | `024`  | `high-impact operations`                               |
| `run `, `setup `, `login `, `test `, `import `                                                                                         | `025`  | `long-running or interactive; needs the async job API` |

Every path must match exactly one rule; if a path matches none, that is a
planning defect — stop and report it rather than inventing an epic.

### New file `src/apps/http/coverage.test.ts` (test-engineer lane)

`describe("src/apps/http/coverage.ts")`. It imports `buildProgram` from
`../cli/index.ts`, `ROUTES` from `./routes.ts`, `DEFERRED` from `./deferred.ts`,
and builds the leaf inventory with the same recursion
`src/apps/cli/commands/commands.ts:13-20` uses:

```ts
function leafPaths(cmd: Command, path: string): string[] {
  const full = path ? `${path} ${cmd.name()}` : cmd.name();
  if (cmd.commands.length > 0)
    return cmd.commands.flatMap((s) => leafPaths(s, full));
  return [full];
}
// called as: buildProgram({} as unknown as CliDeps, noopIo).commands.flatMap((c) => leafPaths(c, ""))
// so the program name is NOT part of a path, and `help` is excluded because
// Commander's implicit help command has no subcommands but is not in `.commands`
// for this purpose — assert the count instead of trusting that (below).
```

Assertions:

1. **Every claimed command exists.** For each `route.cliCommand !== "none"`, that
   string is in the leaf inventory. A typo therefore fails.
2. **No double claim.** The non-`"none"` `cliCommand` values are unique.
3. **The partition is exact.** `covered ∪ deferred === inventory`, with
   `covered ∩ deferred === ∅` — assert by sorting all three arrays and comparing
   with `assert.deepEqual`. This is the assertion that makes a NEW CLI command
   fail the suite until someone decides its epic.
4. **Every deferred entry is justified.** Each has a non-empty `reason` and an
   `epic` matching `/^(020|021|022|023|024|025|none)$/`.
5. **No deferred duplicates.** `cliCommand` values in `DEFERRED` are unique.
6. **The report.** The test prints one line per epic with its deferred count via
   `console.log`, e.g. `019 coverage: 1 served, 79 deferred (020:24 021:2 …)`.
   Binding: the numbers come from the arrays, never hard-coded.

Also add the banned-verb list used by Story 03's REST-shape test as an export of
this file's production sibling — put it in `src/apps/http/deferred.ts`:

```ts
/** CLI top-level verbs; none may appear as a static REST path segment. */
export const BANNED_PATH_SEGMENTS: readonly string[] = [
  "get",
  "create",
  "list",
  "find",
  "add",
  "remove",
  "approve",
  "reject",
  "land",
  "publish",
  "pause",
  "resume",
  "retry",
  "abandon",
  "assign",
  "unassign",
  "register",
  "login",
  "logout",
  "update",
  "rename",
  "import",
  "export",
  "run",
  "setup",
  "test",
  "ack",
  "check",
  "set-default",
  "queue",
  "commands",
  "db",
  "serve",
];
```

Story 03's `routes.test.ts` imports `BANNED_PATH_SEGMENTS` from here.

## Constraints

- **This audit is an inventory report, never a proof that a route works.** It does
  not call a use case and must not assert response shapes — Story 03's contract
  test and Story 04's server test own that.
- `DEFERRED` is a plain literal array. Do not generate it at runtime from the
  Commander tree: a generated list would make assertion 3 vacuous.
- Do not modify `src/apps/cli/commands/commands.ts` — copy its recursion, do not
  import it (it builds a formatted row type, not paths).

## Verify

- `node --test src/apps/http/coverage.test.ts` exits 0.
- Deliberate-break check, run manually and then reverted: deleting one entry from
  `DEFERRED` fails assertion 3 with a diff naming the missing command; changing a
  `cliCommand` to `"get projectt"` fails assertion 1.
- `npm run verify` exits 0.
- Proof: none directly. This story is the guard the epic's Verification Gate calls
  the "CLI-coverage audit (diagnostic, not the contract)".

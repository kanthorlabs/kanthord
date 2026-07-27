# Story 4 — `get graph --initiative <id>` CLI leaf

Epic: `.agent/plan/epics/016-project-graph-read-model.md`
Depends on: Story 3.

## Change

### A. New handler in `src/apps/cli/initiative.ts`

Append `runGetInitiativeGraph`, mirroring `runGetInitiative`
(`src/apps/cli/initiative.ts:72-105`) exactly — same result triple, same
`toResult(err)` catch:

```ts
export async function runGetInitiativeGraph(
  args: Record<string, unknown>,
  getInitiativeGraph: GetInitiativeGraph,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }>;
```

- `const id = args["initiative"] as string;`
- On success with `args["json"]` truthy: `stdout: [JSON.stringify(output)]`,
  `exitCode: 0`. The JSON is the whole `GetInitiativeGraphOutput`, unmodified.
- On success without `--json`, emit these lines in this exact order:
  1. `initiative: <id> <name> [<status>]`
  2. `paused: <true|false>`
  3. `critical path: <length> node(s)` — omit when `criticalPath.length === 0`
  4. one line per group, in `groups` order:
     `group <id> <name> [<status>] repos=<a,b|-> <action.kind|->`
  5. one line per node, in `nodes` order:
     `node <id> <status> <dependencyState>/<executionState> down=<downstream> <action.kind|->`
  6. `blocked forever: <id> (dependency <targetDependencyId> can never clear)` for
     each node with `blockedForever === true`, in `nodes` order
- On error: `return { ...toResult(err), stdout: [] };`

Text output is a convenience. `--json` is the stable contract; do not reshape the
JSON for readability.

### B. New leaf `src/apps/cli/commands/get/graph.ts`

Copy the structure of `src/apps/cli/commands/get/initiative.ts` (27 lines) verbatim,
changing only:

```ts
new Command("graph")
  .description("Get an initiative's task graph.")
  .configureHelp({ commandUsage: () => "kanthord get graph" })
  .requiredOption(
    "--initiative <id>",
    "ID of the initiative whose graph to get",
  )
  .option("--json", "print the graph as JSON")
  .addHelpText(
    "after",
    "\nExample:\n  kanthord get graph --initiative init-1 --json\n",
  )
  .action(async (opts: { initiative: string; json?: boolean }) => {
    emitResult(
      await runGetInitiativeGraph(
        { initiative: opts.initiative, ...(opts.json ? { json: true } : {}) },
        deps.getInitiativeGraph,
      ),
      io,
    );
  });
```

`deps` must only be dereferenced **inside** `.action()`: the architecture test
builds the whole program with `noopDeps = {} as unknown as CliDeps`
(`src/apps/cli/architecture.test.ts:49`).

### C. Register in `src/apps/cli/commands/get.ts`

- Add `import { buildGetGraphCommand } from "./get/graph.ts";` after line 12.
- Add `command.addCommand(buildGetGraphCommand(deps, io));` after line 30.

### D. Bump the two architecture counters

- `src/apps/cli/architecture.test.ts:28` — `EXPECTED_LEAF_FILE_COUNT` **65 → 66**.
- `src/apps/cli/architecture.test.ts:33` — `EXPECTED_LEAF_COUNT` **68 → 69**.

Update the trailing comment on each to name `016-s4 get graph`. Story 5 and Story
6 each bump these by one more, in that order — do not pre-bump for them.

## Constraints

- Never register `.option(`/`.action(` in `src/apps/cli/index.ts`; the
  architecture test forbids it (`architecture.test.ts:57-65`).
- `--json` and the text path must both work; there is no mutually-exclusive flag
  here (unlike `get task`, which guards `--result` + `--json` at
  `src/apps/cli/task.ts:259-265`).
- Do not add an entry to the `MATRIX` list in `architecture.test.ts` — it is a
  fixed audit sample, not an exhaustive list.
- `apps/` may import from `app/` only. Import `GetInitiativeGraph` with
  `import type`.

## Verify

`node --test src/apps/cli/get-initiative-graph.test.ts` — new handler test file,
mirroring `src/apps/cli/get-initiative.test.ts:1-30`:

- `--json` returns exit 0 and `JSON.parse(stdout[0])` deep-equals the use case's
  output object.
- text mode prints the `initiative:` line first, one `group ` line per group and
  one `node ` line per node, in source order.
- text mode prints a `blocked forever:` line naming the dead dependency for a node
  with `blockedForever: true`, and prints none when no node is permanently blocked.
- text mode omits the `critical path:` line when `criticalPath.length === 0`.
- an unknown id: the fake use case throws `new UnknownReferenceError("initiative",
"…")` and the handler returns `exitCode: 1` with
  `stderr[0]` containing `no initiative with id`, and `stdout: []`.

`node --test src/apps/cli/commands/read.test.ts` — add tests in the existing
`capture()` + `parseAsync` style (`read.test.ts:8-57`):

- `["graph", "--initiative", "init-1", "--json"]` passes exactly
  `{ id: "init-1" }`… **no**: assert the fake `getInitiativeGraph.execute`
  received exactly `{ id: "init-1" }`, since the handler maps `--initiative` to
  the use case's `id` input.
- missing `--initiative` exits non-zero (Commander `requiredOption`).

`node --test src/apps/cli/architecture.test.ts` — passes with the bumped
constants, and the new leaf satisfies the description + `Usage:` + `Example`
assertions (`architecture.test.ts:90-125`).

`npm run verify` exits 0.

Proof: delivers the `get graph` command itself — phases **A** through **G** cannot
run without it, and phase **A**'s `no initiative with id` match is this story's
error path.

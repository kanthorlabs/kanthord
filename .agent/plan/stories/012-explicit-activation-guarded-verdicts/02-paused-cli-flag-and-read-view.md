# Story 2 — `--paused` on `create initiative` and `import graph --create`

Epic: `.agent/plan/epics/012-explicit-activation-guarded-verdicts.md`
Depends on: Story 1 (the use-case inputs gain the required `paused` field).

## Change

### `create initiative`

- `src/apps/cli/commands/create/initiative.ts:22` — after the `--after` option,
  add:

  ```ts
      .option(
        "--paused",
        "create the initiative paused; nothing runs until `resume initiative`",
      )
  ```

- `:27` — the action opts type gains `paused?: boolean`; the args object passed
  to `runCreateInitiative` gains `paused: opts.paused ?? false`.
- `:24-25` — the `addHelpText("after", …)` Example block stays a valid example;
  do not remove `Usage:`/`Example` (asserted by
  `src/apps/cli/architecture.test.ts:88`).
- `src/apps/cli/initiative.ts:9-27` (`runCreateInitiative`) — read the flag and
  forward it:

  ```ts
    const paused = args["paused"] === true;
    …
    const id = await createInitiative.execute({ projectId, name, after, paused });
  ```

  stdout/stderr and exit code are unchanged.

### `import graph --create`

- `src/apps/cli/commands/import/graph.ts:20` — after the `--bind` option, add:

  ```ts
      .option(
        "--paused",
        "with --create: create the initiative paused; nothing runs until `resume initiative`",
      )
  ```

- `:31-43` — the action opts type gains `paused?: boolean`; the `runImportGraph`
  args object (`:57-68`) gains `paused: opts.paused ?? false`.
- `src/apps/cli/import-graph.ts:76-87` — `ImportGraphArgs` gains
  `paused: boolean;` (required).
- `src/apps/cli/import-graph.ts` — add one guard immediately **after** the
  existing `--create requires --project` guard at `:111-117`:

  ```ts
  if (args.paused && !args.create) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: ["error: --paused requires --create"],
    };
  }
  ```

  `--paused` is never silently ignored.

- `:118-128` — pass `args.paused` to `runCreate` as a new trailing parameter.
- `:363-371` — `runCreate` signature gains `paused: boolean` as its trailing
  parameter; `:449-454` — `createGraph.execute({ pkg, projectId, packageId, bindings: resolvedBindings, paused })`.
- `runApply` (`:158-186`) is unchanged: applying a graph never creates an
  initiative.

### `get initiative --json`

- `src/app/initiative/get-initiative.ts:12-21` — `GetInitiativeOutput` gains a
  **required** `paused: boolean;` immediately after `status: string;`.
- `:49-59` — the returned object gains `paused: initiative.paused,` immediately
  after `status`. It is **always** emitted — never conditionally spread like
  `workspace` — because every initiative has a value (Phase A asserts `true`,
  Phase C asserts `false`).
- The human (non-`--json`) rendering in `src/apps/cli/initiative.ts:82-101` is
  **unchanged**. This story adds `paused` to the JSON view only.

## Constraints

- No new leaf command: `resume initiative`
  (`src/apps/cli/commands/resume/initiative.ts`) is already the start gate and is
  untouched. Do not add an `activate` command or alias.
- `--paused` is a boolean flag with no argument, and defaults to `false`
  everywhere. Do **not** change any existing default: every current
  `create initiative` / `import graph --create` caller under `scripts/e2e/` must
  keep producing an unpaused initiative.
- Leaf counts in `src/apps/cli/architecture.test.ts:28-31` must not change.
- `get objective --json` is Story 3; do not touch it here.

## Verify

- `node --test src/apps/cli/commands/create.test.ts`
  - `create initiative --project p --name n --paused` → the fake use case
    receives `paused: true`.
  - the same command without `--paused` → receives `paused: false`.
- `node --test src/apps/cli/initiative.test.ts`
  - `runCreateInitiative({project,name,paused:true}, fake)` forwards
    `paused: true`; without the key it forwards `paused: false`; exit 0, stdout
    `[id]`, stderr `initiative created: <name>` unchanged.
- `node --test src/apps/cli/commands/special.test.ts`
  - `import graph ./dir --create --project p --paused` forwards `paused: true` to
    the handler; without the flag, `paused: false`.
- `node --test src/apps/cli/import-graph.test.ts`
  - `runImportGraph({dir, create:true, project:"p", paused:true, …})` →
    `createGraph.execute` received `paused: true`.
  - `runImportGraph({dir, apply:true, initiative:"i", paused:true, …})` →
    `exitCode 1`, stderr exactly `error: --paused requires --create`.
- `node --test src/apps/cli/get-initiative.test.ts`
  - `--json` stdout parses to an object with `paused: true` for a paused
    initiative and `paused: false` otherwise, with `status: "building"` in both
    cases (the two axes are independent).
  - regression: the non-`--json` line list is byte-identical to today's.
- `node --test src/apps/cli/commands/read.test.ts` — `get initiative --json`
  shape test updated to include `paused`.
- `node --test src/apps/cli/architecture.test.ts` — green.
- `npm run verify` exits 0.
- Proof: `A ok: paused is reported separately from lifecycle status` and
  `B ok: a paused import is inert …` in
  `scripts/e2e/activation-verdict-proof.sh` (`:52-55`, `:59-75`), plus
  `:79` in Phase C. Phase B's inertness needs no new code: enqueue already skips
  paused initiatives (`src/app/task/enqueue-ready-tasks.ts:57-60`), the queue
  claim filters `i.paused = 0` (`src/queue/sqlite.ts:32`), and the startup settle
  sweep skips initiatives with no provisioned workspace
  (`src/app/objective/settle-objectives.ts:106-108`).

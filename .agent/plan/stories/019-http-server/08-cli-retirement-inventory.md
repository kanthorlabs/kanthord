# Story 08 — CLI-retirement inventory test

Epic: `.agent/plan/epics/019-http-server.md` (bullet S8)
Depends on: Story 07.

## Change

1. **New file `src/apps/http/cli-coverage.test.ts`** — a test-only inventory. It
   is a diagnostic, never proof that a route works.

   Walk the Commander tree exactly the way
   `src/apps/cli/commands/commands.ts:13-19` does, but collecting leaf paths only:

   ```ts
   const program = buildProgram({} as unknown as CliDeps, {
     out: () => {},
     err: () => {},
     setExitCode: () => {},
   });
   const leaves: string[] = [];
   const walk = (cmd: Command, path: string): void => {
     const full = path ? `${path} ${cmd.name()}` : cmd.name();
     if (cmd.commands.length === 0) {
       leaves.push(full);
       return;
     }
     for (const sub of cmd.commands) walk(sub, full);
   };
   for (const sub of program.commands) walk(sub, "");
   ```

   Note the root name is dropped, so a leaf path reads `get project`, matching the
   `cliCommands` spelling.

   Assertions:
   - every `cliCommands` entry of every `ROUTES` row is a member of `leaves` —
     the typo guard, so a fabricated coverage claim fails;
   - `leaves.length` is `80` after Story 07 (`serve` included), with a comment
     pointing at `src/apps/cli/architecture.test.ts:40` as the sibling count;
   - the uncovered set (`leaves` minus every row's `cliCommands`, minus `serve`
     and `commands`, which are HTTP-irrelevant) is non-empty in 019 — a sanity
     assertion that the inventory is actually computing something.

   Reporting is opt-in and silent by default, so the suite stays quiet:

   ```ts
   if (process.env["KANTHORD_CLI_COVERAGE_REPORT"] === "1") {
     process.stdout.write(uncovered.sort().join("\n") + "\n");
   }
   ```

   **No uniqueness assertion over `cliCommands`**: one CLI leaf may need several
   routes and one route may cover several leaves.
   **No target-epic assertion**: the roadmap lives in
   `.agent/plan/stories/019-http-server/retirement.md`, which `/work` may not
   edit.

## Constraints

- This file contains no production code and creates no source module.
- It must not import `src/apps/http/app.ts` or start a server; it reads `ROUTES`
  and the Commander tree only.
- Do not assert an exact uncovered LIST. That would turn every later epic's first
  green route into a failure in this file.

## Verify

- `node --test src/apps/http/cli-coverage.test.ts` passes.
- `KANTHORD_CLI_COVERAGE_REPORT=1 node --test src/apps/http/cli-coverage.test.ts`
  prints the uncovered leaves, and plain `node --test src/apps/http/cli-coverage.test.ts`
  prints none of them.
- A local edit adding `cliCommands: ["get nonexistent"]` to the `health.get` row
  makes the suite FAIL (verify by hand, then revert — do not commit the edit).
- `npm run verify` exits 0.
- Proof: none directly. It is the migration checklist that tracks the epic's
  "the CLI is retired once the UI covers it" goal.

# Story 1 — `list project`

Epic: `.agent/plan/epics/011-client-discovery-surface.md`

## Change

1. **New use case** `src/app/project/list-projects.ts` — mirror
   `src/app/objective/list-objectives.ts:4-14` exactly (private `#` field, no
   input object):

   ```ts
   import type { ProjectRepository } from "../../storage/port.ts";
   import type { Project } from "../../domain/project.ts";

   export class ListProjects {
     readonly #projects: ProjectRepository;

     constructor(projects: ProjectRepository) {
       this.#projects = projects;
     }

     execute(): Project[] {
       return this.#projects.listProjects();
     }
   }
   ```

   `ProjectRepository.listProjects(): Project[]` is already on the port
   (`src/storage/port.ts:64`) and implemented at
   `src/storage/sqlite/sqlite-project-repository.ts:122-128` with
   `ORDER BY id ASC`. Do **not** add sorting in the use case.

2. **New CLI handler** `runListProjects` appended to `src/apps/cli/project.ts`
   (that file currently exports only `runCreateProject:5` and
   `runRenameProject:19`). Shape it on `runListInitiatives`
   (`src/apps/cli/initiative.ts:107-121`) — same return type, same two-space
   human line:

   ```ts
   export function runListProjects(
     args: Record<string, unknown>,
     listProjects: ListProjects,
   ): { exitCode: number; stdout: string[]; stderr: string[] } {
     const rows = listProjects.execute();
     if (args["json"]) {
       return { exitCode: 0, stdout: [JSON.stringify(rows)], stderr: [] };
     }
     return {
       exitCode: 0,
       stdout: rows.map((r) => `${r.id}  ${r.name}`),
       stderr: [],
     };
   }
   ```

3. **New leaf** `src/apps/cli/commands/list/project.ts` exporting
   `buildListProjectCommand(deps: CliDeps, io: CliIo): Command`. Copy
   `src/apps/cli/commands/list/initiative.ts:8-30` and remove the
   `--project` option (this command takes no scope):

   - `new Command("project")`
   - `.description("List projects.")`
   - `.configureHelp({ commandUsage: () => "kanthord list project" })`
   - `.option("--json", "print projects as JSON")`
   - `.addHelpText("after", "\nExample:\n  kanthord list project --json\n")`
   - `.action((opts: { json?: boolean }) => { emitResult(runListProjects({ ...(opts.json ? { json: true } : {}) }, deps.listProjects), io); })`

4. **Register** in `src/apps/cli/commands/list.ts`: add the import beside
   `list.ts:5-9` and `command.addCommand(buildListProjectCommand(deps, io));`
   as the **first** `addCommand` call (before `buildListTaskCommand` at
   `list.ts:25`).

5. **Wire** in `src/composition.ts`: `const listProjects = new ListProjects(projectRepository);`
   immediately after `const findProject = new FindProject(projectRepository);`
   (`composition.ts:186`), plus the `import { ListProjects } from "./app/project/list-projects.ts";`
   beside `composition.ts:23-24`, and `listProjects,` in the returned bundle
   immediately after `findProject,` (`composition.ts:857`).

6. **Type** in `src/apps/cli/deps.ts`: `import type { ListProjects } from "../../app/project/list-projects.ts";`
   beside `deps.ts:17-20`, and `listProjects: ListProjects;` immediately after
   `findProject: FindProject;` (`deps.ts:139`).

7. **Unblock the architecture gate** — `src/apps/cli/architecture.test.ts` is
   already RED on HEAD (`68 !== 67` at `architecture.test.ts:92`, left stale by
   commit `fd6f799`). This story is the first to touch the counters, so it
   repairs both:
   - `EXPECTED_LEAF_FILE_COUNT` (`architecture.test.ts:28`): `65` → `66`
     (this story adds exactly one file under `commands/*/`).
   - `EXPECTED_LEAF_COUNT` (`architecture.test.ts:31`): `67` → `69`
     (68 registered leaves on HEAD + `list project`).
   - Add the missing `Example` help text to the `commands` leaf so the
     per-leaf assertion at `architecture.test.ts:117-120` passes:
     in `src/apps/cli/commands/commands.ts`, after `.description(...)` on
     line 51, insert
     `.addHelpText("after", "\nExample:\n  kanthord commands\n")`.

## Constraints

- `list project` has **no** `--project` option and no other flag besides
  `--json`.
- Ordering is the repository's `ORDER BY id ASC`; never re-sort in the use case
  or the handler.
- `runListProjects` returns raw `Project[]` (`{id, name}`) — no view mapping,
  matching `runListInitiatives`.
- Do not touch any other leaf file, and do not renumber the counters beyond the
  two values above.

## Verify

- `node --test src/app/project/list-projects.test.ts` — new file. Asserts:
  - empty repository fake → `execute()` returns `[]`;
  - a fake whose `listProjects()` returns `[{id:"p2",name:"b"},{id:"p1",name:"a"}]`
    → `execute()` returns that array **unchanged** (the use case must not sort);
  - `execute()` calls `listProjects()` exactly once and passes no argument.
- `node --test src/apps/cli/commands/read.test.ts` — two new tests added to the
  existing `describe`, built with the `capture()` harness at
  `read.test.ts:8-25` and the `as unknown as Parameters<typeof buildListCommand>[0]`
  deps cast convention (`read.test.ts:560`):
  - `list project --json` → `cap.out` deep-equals
    `['[{"id":"p1","name":"alpha"},{"id":"p2","name":"beta"}]\n']`,
    `cap.err` is `[]`, exit code `0`;
  - `list project` (no `--json`) → `cap.out` deep-equals
    `["p1  alpha\n", "p2  beta\n"]` (two spaces), exit code `0`.
- `node --test src/apps/cli/architecture.test.ts` — all 6 tests pass
  (this is the regression guard for item 7; it must go from RED to green).
- `npm run verify` exits 0.
- Proof: `scripts/e2e/client-discovery-proof.sh` Phase **A** — the
  `A ok: list project enumerates, with a defined order` line
  (`client-discovery-proof.sh:23-29`).

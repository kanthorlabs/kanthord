# Story 3 — ergonomics + smoke bundle (minors)

Epic: `.agent/plan/epics/007.9-e2e-resilience.md`

Four independent papercuts from run `e2e-0079`. Each is separately landable and
separately tested; group them so a single small story clears the minor findings.
None changes core behavior.

## Item A — `list credential | ai-provider | repository --project <id>`

**Why:** after `login provider` / `create credential|ai-provider|repository` the
only way to recover an id is to re-read the create command's stdout; there is no
way to enumerate resources that already exist (`list` knows only
task/initiative/objective/event/model).

**Contract:**

- Add a read query `listResourcesByProject(projectId, type)` to the storage port
  (`src/storage/port.ts`) + `SqliteProjectRepository`
  (`src/storage/sqlite/sqlite-project-repository.ts`), filtering the `resources`
  table by project and `type`. Read-only (CQRS-lite query — may skip the domain).
- Add `list credential`, `list ai-provider`, `list repository` commands under
  `src/apps/cli/commands/list/`, each `--project <id>` (required) with `--json`,
  registered in the `list` table beside the existing entries. Print id + name
  (+ provider/model/remote where relevant); **never** print credential secret
  values.

**Test:** `node --test` on the repo query (seed 2 credentials + 1 repository in
one project, assert the filtered list) and on the CLI command wiring (`--json`
shape; secret value absent from output).

## Item B — consistent `create` output line

**Why:** `create project` prints `project created: <name>` on stderr with the id
on stdout (`src/apps/cli/project.ts:12`); `create credential` prints `credential
resource added: <name>`; `create ai-provider` / `create repository` print a bare
id with no confirmation line. Scripts must `grep` a ULID to be safe.

**Contract:** make every `runCreate*` in `src/apps/cli/*.ts` emit the same shape
— id on stdout, one consistent confirmation on stderr, e.g. `<kind> created:
<id>`. Keep id-on-stdout (scripts depend on it) and the `{ exitCode, stdout,
stderr }` result contract.

**Test:** `node --test` asserting each create path returns stdout `[id]` and a
stderr line matching the single agreed format.

## Item C — `get conflict` shows target-vs-candidate hunks

**Why:** `get conflict --id` prints `target main@<sha>`, `candidate <id>@<sha>`,
then the candidate's **full** copy of the conflicting file — no conflict markers,
no target side. You cannot see what actually clashes, so the `retry --note`
guidance is written blind.

**Contract:** enrich the `get conflict` output (`src/app/task/get-conflict.ts` +
`src/apps/cli/commands/get/conflict.ts`) to show, per conflicting file, the
target-vs-candidate diff (or a 3-way conflict view). Keep the existing header
lines and the `--id` interface. Scope to display only — no change to conflict
detection or the recovery loop (007.8).

**Test:** `node --test src/app/task/get-conflict.test.ts` — a scripted conflict
renders both sides / hunks, not just the candidate copy.

## Item D — `e2e-smoke-todo.sh` works on a `/tmp` path

**Why:** the script boots `node "$MJS"` (`scripts/e2e/e2e-smoke-todo.sh:20`); its
own doc example passes `/tmp/todo.mjs`. On macOS `/tmp`→`/private/tmp` is a
symlink, so `process.argv[1]` (`/tmp/todo.mjs`) ≠
`fileURLToPath(import.meta.url)` (`/private/tmp/todo.mjs`), the generated file's
correct `import.meta.url === process.argv[1]` run-guard never fires, the server
exits without listening, and the smoke reports HTTP 000 (observed this run).

**Contract:** `realpath` the `<path-to-todo.mjs>` argument before `node "$MJS"`
(or copy it to / run it from a resolved real path) so the documented `/tmp`
invocation works. Shell-only change to `scripts/e2e/e2e-smoke-todo.sh`; this is a
maintainer/script edit (no `src/` test), verified by running the script against a
`/tmp/todo.mjs` copy of a landed server and getting `TODO API SMOKE OK`.

## Constraints

- Each item is independent; land in any order. Items A–C are `/work` TDD targets;
  Item D is a script edit (no unit test) validated by running the smoke.
- Surgical and additive — no change to existing command behavior beyond the
  stated output/format edits.

## Verification Gate

- The per-item `node --test` targets above (A, B, C) pass.
- Item D: `git -C <checkout> show HEAD:src/todo.mjs > /tmp/todo.mjs &&
scripts/e2e/e2e-smoke-todo.sh /tmp/todo.mjs` prints `TODO API SMOKE OK`.
- `npm run verify` exits 0.

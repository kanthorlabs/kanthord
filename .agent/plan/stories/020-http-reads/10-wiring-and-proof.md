# Story S10 — wiring audit, retirement roadmap, Proof green

Epic: `.agent/plan/epics/020-http-reads.md`
Depends on: Stories S1–S9 (all 22 rows and their deps exist).

## Change

1. `src/apps/http/deps.ts` — audit: `HttpDeps` holds exactly these 20 fields and
   nothing else: `logger`, `getProject`, `listProjects`, `getProjectOverview`,
   `listInitiatives`, `getInitiative`, `getInitiativeGraph`, `listObjectives`,
   `getObjective`, `listTasks`, `getTask`, `listResources`, `getResource`,
   `listAiProviders`, `getAiProvider`, `resolveProjectChain`, `listModels`,
   `getDecisionQueue`, `getConflict`, `getObjectiveConflict`.
2. `src/apps/cli/commands/serve.ts:39` — audit: the `httpDeps` literal assigns
   all 20, each from the matching `CliDeps` field, in the same order as the
   interface. No cast, no `as`.
3. `.agent/plan/stories/019-http-server/retirement.md` — under
   `### Target 020 — reads`, append one line recording that the target is
   implemented, naming the epic file and the Proof script. Change nothing else in
   that file (its path spelling was already corrected to singular on
   2026-07-30).
4. `src/apps/http/routes.test.ts` — add the row-count and id-set assertions
   listed under Verify.
5. `src/apps/http/cli-coverage.test.ts` — add the expected-covered-leaf set
   assertion listed under Verify; leave its three existing tests unchanged.
6. No production code changes beyond the two audits above. If an audit finds a
   missing field, fix it here.

## Constraints

- Do not edit `scripts/e2e/http-reads-proof.sh`. It is the contract, written
  before implementation. If a Proof assertion fails, the CODE is wrong — the
  exception is a fixture-level defect in the script itself, which must be raised
  as an `OPEN:` blocker to the human, never silently edited to match behaviour.
- Do not remove any CLI leaf (epic non-goal).
- `scripts/e2e/http-serve-proof.sh` (EPIC 019) must still print `019 ok: …`.

## Verify

- `ROUTES` holds exactly 24 rows: `health.get`, `ui.get`, plus the 22 of this
  epic. Add that count assertion to `src/apps/http/routes.test.ts`
  (`assert.equal(ROUTES.length, 24)`), so a dropped row is caught.
- Every id from the epic's route table is present, asserted as a set in
  `routes.test.ts`:
  `project.list, project.get, project.overview.get, project.initiative.list,
project.repository.list, project.credential.list, project.notification.list,
project.filesystem.list, project.ai-provider.list, initiative.get,
initiative.graph.get, initiative.objective.list, initiative.task.list,
objective.get, objective.conflict.get, task.get, task.conflict.get,
resource.get, ai-provider.list, ai-provider.get, model.list, queue.get`.
- The 25 claimed CLI leaves appear across `cliCommands`, asserted in
  `src/apps/http/cli-coverage.test.ts` as an explicit expected-covered set:
  `get project, get initiative, get objective, get task, get resource,
get repository, get ai-provider, get graph, get overview, get conflict,
list project, list initiative, list objective, list task, list credential,
list filesystem, list notification, list repository, list ai-provider,
list model, queue, find project, find initiative, find objective,
find resource`.
  Its existing assertions still hold: every name is a real leaf (`:37-46`),
  `leaves.length === 80` (`:48-51`), and the uncovered set is still non-empty
  (`:53-63`).
- `npm run verify` exits 0.
- `scripts/e2e/http-serve-proof.sh` prints `019 ok: …` (sibling regression).
- Proof: `scripts/e2e/http-reads-proof.sh` prints
  `020 ok: singular REST reads on 127.0.0.1:<port> — …` and exits 0. Phases A–H
  all pass; this story owns the whole Proof.

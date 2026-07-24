# Story B — Assign / Unassign use cases + CLI

Epic: `.agent/plan/epics/008.2-project-provider-chain.md`
Depends on: Story A (assignment store).

## Change

- **Use cases** (`src/app/ai-provider/`):
  - `assign-ai-provider.ts` — `class AssignAiProvider { constructor({ registry,
projects, unitOfWork }) }`, `execute({ projectId, providerId, rank? }): void`:
    1. validate `projects.get(projectId)` exists → `UnknownReferenceError("project", projectId)`.
    2. validate `registry.get(providerId)` exists → `UnknownReferenceError("ai_provider", providerId)`.
    3. if `registry.getAssignment(projectId, providerId)` → throw
       `DuplicateAssignmentError(projectId, providerId)` (new; message contains
       `duplicate`/`already` so the epic Proof grep matches).
    4. in `unitOfWork.transaction`: if `rank` undefined → `rank =
(registry.maxRank(projectId) ?? -1) + 1`, then `registry.assign(...)`;
       if `rank` given and collides → `registry.shiftRanksFrom(projectId, rank)`
       then `registry.assign(projectId, providerId, rank)`; then
       `registry.compactRanks(projectId)`.
  - `unassign-ai-provider.ts` — `class UnassignAiProvider`,
    `execute({ projectId, providerId }): void`: validate both refs; in a
    transaction `registry.unassign(...)` then `registry.compactRanks(projectId)`.
- **Errors**: new `DuplicateAssignmentError` in `src/app/ai-provider/errors.ts`;
  add to `src/apps/cli/error-map.ts:42-67` `instanceof` chain.
- **CLI runners** — `src/apps/cli/ai-provider.ts`: `runAssignAiProvider(args, deps)`
  (`--project`, `--provider`, `--rank?`) and `runUnassignAiProvider(args, deps)`
  (`--project`, `--provider`). Success → `stdout:[providerId]`, friendly stderr.
- **Commands**: new verb `src/apps/cli/commands/assign.ts` + leaf
  `commands/assign/ai-provider.ts` (`.requiredOption("--project <id>")`,
  `.requiredOption("--provider <id>")`, `.option("--rank <n>")`); new verb
  `commands/unassign.ts` + leaf `commands/unassign/ai-provider.ts`
  (`--project`, `--provider`). Register both verbs in `src/apps/cli/index.ts`.
- **Wiring**: `deps.ts` add `assignAiProvider`, `unassignAiProvider`;
  `composition.ts` construct both (`{ registry: aiProviderRegistry, projects:
projectRepository, unitOfWork }`) and add to the bundle.
- **Counters**: `src/apps/cli/architecture.test.ts` → set
  `EXPECTED_LEAF_FILE_COUNT = 60`, `EXPECTED_LEAF_COUNT = 62` (2 new leaves).

## Constraints

- Rank stays total + contiguous (`compactRanks` after every mutation) so
  `list --project` (Story 04) is deterministic.
- All multi-step rank edits inside one `unitOfWork.transaction`.

## Verify

- `src/app/ai-provider/assign-ai-provider.test.ts` +
  `unassign-ai-provider.test.ts` (fake registry recording rank ops):
  - unknown project / unknown provider → `UnknownReferenceError`;
  - duplicate assignment → `DuplicateAssignmentError`;
  - omitted `--rank` appends at maxRank+1;
  - explicit colliding `--rank` shifts existing then compacts;
  - unassign removes + compacts.
- `src/apps/cli/ai-provider.test.ts` (append): `assign --project --provider
--rank`, `unassign`, duplicate → exit 1 with `error:` containing `duplicate`.
- `npm run verify` exits 0 (counters updated).
- Proof (008.2 Proof block): delivers **PASS A/B/C** (rank order via two assigns —
  jointly with Stories 03/04 producing the chain), **PASS B-dup** (duplicate
  rejected, non-zero exit), **PASS B-unassign** (unassign removes the member).

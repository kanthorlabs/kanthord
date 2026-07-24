# Story D — `list ai-provider --project <id>` resolved-chain branch

Epic: `.agent/plan/epics/008.2-project-provider-chain.md`
Depends on: Story A (store), Story C (`resolveProviderChain`), EPIC 008.1
(`list ai-provider` global command + `AiProviderView`).

## Change

- **New use case** — `src/app/ai-provider/resolve-project-chain.ts`, class
  `ResolveProjectChain { constructor(private registry: AiProviderRegistry) }`,
  `execute(projectId: string): AiProviderView[]`:
  `const assigned = registry.listAssigned(projectId);`
  `const def = registry.getDefaultId() ? registry.get(registry.getDefaultId()!) : undefined;`
  `const chain = resolveProviderChain(assigned, def);`
  map each to `AiProviderView` (the 008.1 view — **omits `value`**), preserving
  chain order.
- **Extend `runListAiProviders`** — `src/apps/cli/ai-provider.ts` (008.1): if
  `args["project"]` is present, call `deps.resolveProjectChain.execute(projectId)`
  and print that ordered list; else the global registry list (008.1 behavior).
  `--json` prints the array in chain order.
- **Extend the `list ai-provider` command** — `src/apps/cli/commands/list/resource.ts`
  global `ai-provider` builder (008.1 Story 03): add
  `.option("--project <id>", "resolved provider chain for this project")`.
- **Wiring**: `deps.ts` add `resolveProjectChain: ResolveProjectChain`;
  `composition.ts` construct `new ResolveProjectChain(aiProviderRegistry)` and add
  to the bundle. No counter change (editing an existing leaf).

## Constraints

- Order is exactly the `resolveProviderChain` output (Story C); do not re-sort.
- No read path emits `value` (reuse the 008.1 `AiProviderView` omission).
- Without `--project`, behavior is byte-identical to 008.1's global list.

## Verify

- New `src/app/ai-provider/resolve-project-chain.test.ts` (fake registry):
  assigned `[P3,P2]` + default `P1` → view ids `[P3,P2,P1]`; default present →
  deduped; logged-out excluded; empty project → `[default]`; no view has `value`.
- Extend `src/apps/cli/ai-provider.test.ts`: `list ai-provider --project X --json`
  calls `deps.resolveProjectChain.execute(X)` and prints chain-ordered views;
  `list ai-provider --json` (no project) still calls `deps.listAiProviders`.
- `npm run verify` exits 0.
- Proof (008.2 Proof block): the `chain()` helper (`list ai-provider --project
--json`) delivers **PASS A/B/C**, **PASS C-dedup**, **PASS B-unassign**,
  **PASS D** (default-only), **PASS D-pre/D-loggedout**, and the **leak gate**
  (`list ai-provider --project --json` carries no `SECRET`).

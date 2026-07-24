# Story E — Assignment-aware provider removal

Epic: `.agent/plan/epics/008.2-project-provider-chain.md`
Depends on: Story A (store + `listProjectsAssigning`), EPIC 008.1
(`RemoveAiProvider` use case + `remove ai-provider` CLI with the `--cascade`
placeholder flag).

## Change

- **Extend `RemoveAiProvider`** — `src/app/ai-provider/remove-ai-provider.ts`
  (008.1). Add assignment handling; the flag semantics are **unified** (one
  meaning each), covering both the default pointer and assignment rows:
  1. `const assigningProjects = registry.listProjectsAssigning(id);`
  2. If `assigningProjects.length > 0` and neither `--replacement` nor
     `--cascade` → throw `AssignedProviderError(id)` (new; message contains
     `assigned` / `replacement` / `cascade` for the epic Proof grep).
  3. `--replacement <r>` (validate `r` is an existing **active** provider ≠ `id`):
     for each project assigning `id`, in one `unitOfWork.transaction`:
     if that project already assigns `r` → `registry.unassign(project, id)` (dedup);
     else `registry.assign` is replaced by updating the row's providerId to `r`
     (or `unassign(id)` + `assign(r, sameRank)`), then `registry.compactRanks(project)`.
     Also repoint the **default** to `r` if `id` was the default (008.1 rule).
  4. `--cascade`: for each assigning project `registry.unassign(project, id)` +
     `compactRanks`; report the affected project count on stderr. **Reject**
     `--cascade` when `id` is also the current default (no default target) → throw
     `ReplacementRequiredError` (008.1) — `--replacement` is required then.
  5. All assignment edits + default repair + `registry.delete(id)` in **one**
     `unitOfWork.transaction`.
- **Errors**: new `AssignedProviderError` in `src/app/ai-provider/errors.ts`; add
  to `src/apps/cli/error-map.ts` `instanceof` chain.
- **CLI**: `commands/remove/ai-provider.ts` (008.1) already declares
  `--replacement` and `--cascade`; make `runRemoveAiProvider`
  (`src/apps/cli/ai-provider.ts`) pass `cascade`/`replacement` through and print
  the affected-project count. No counter change (editing existing leaf).

## Constraints

- One transaction for assignments + default repair + delete — never a partial
  state where the provider is deleted but an assignment/default still references it.
- `--replacement` dedups (a project already assigning the replacement keeps a
  single membership) and compacts ranks.
- Removal stays keyed by record id (same-kind siblings untouched).

## Verify

- Extend `src/app/ai-provider/remove-ai-provider.test.ts` (fake registry with
  assignments):
  - remove an assigned provider with no flag → `AssignedProviderError`;
  - `--cascade` drops its assignment rows, compacts, reports count; chain for that
    project falls back to default;
  - `--replacement r` rewrites assignments to `r`, dedups when the project already
    assigns `r`, compacts ranks;
  - `--cascade` on a provider that is also the default → `ReplacementRequiredError`.
- Extend `src/apps/cli/ai-provider.test.ts`: `remove --id X` (assigned) → exit 1
  with `error:` containing `cascade`/`replacement`; `remove --id X --cascade` and
  `remove --id Y --replacement Z` succeed.
- `npm run verify` exits 0.
- Proof (008.2 Proof block): delivers **PASS E-guard** (assigned remove needs a
  flag), **PASS E-cascade** (cascade drops assignment; chain → default), **PASS
  E-replacement** (rewrite dedups + compacts).

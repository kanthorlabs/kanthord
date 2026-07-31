# Story 07 — export, graph routing, initiative picker, and Plan unavailable

Epic: `.agent/plan/epics/026.6-ui-graph-and-readiness.md` (decisions 9–11)
Depends on: Story 06.

## Change

- Append `PkgInitiativeDto`, `PkgObjectiveDto`, `PkgTaskDto`, `ExportManifestDto`, and `InitiativePackageDto` to `ui/src/lib/dto.ts` as exact type-only mirrors of `src/apps/http/views/graph-package.ts:9-64`. Preserve every optional key, array mutability, `verification:readonly string[] | null | undefined`, and manifest literal `digestAlgorithm:"sha256"`.
- Append `fetchInitiativePackage(id:string,init?:RequestInitLike):Promise<InitiativePackageDto>` in `ui/src/lib/api-client.ts`; call `apiGet` at `/api/initiative/${encodeURIComponent(id)}/package`. The unwrapped DTO, not the HTTP `{data:…}` envelope, is the download body.
- Create `ui/src/lib/download.ts` exporting:

```ts
export function initiativePackageFilename(initiativeId: string): string;
export function serializeInitiativePackage(pkg: InitiativePackageDto): string;
export function downloadInitiativePackage(
  initiativeId: string,
  pkg: InitiativePackageDto,
): void;
```

- Filename is exactly `kanthord-initiative-${initiativeId}.json`. Serialization is exactly `JSON.stringify(pkg, null, 2) + "\n"`. Download a Blob with type `application/json`, click one temporary `<a download=filename>`, remove it, and always call `URL.revokeObjectURL` after the click.
- Edit the toolbar in `ui/src/pages/initiative-graph.tsx`. Add an enabled button labelled `Export package` with `data-testid="initiative-export"`. One click calls `fetchInitiativePackage(initiativeId)` once, then `downloadInitiativePackage`; while pending disable only this button. On failure render `role="alert"` with the `ApiError` message. Do not edit or re-upload the package.
- Create `ui/src/pages/initiative-picker.tsx` exporting `InitiativePickerPage()`. Read project `id`, query `initiativeKeys.list(id)` with `fetchInitiatives`, and render through `AsyncBoundary what="initiatives"`. Preserve API order. Zero initiatives renders `No initiatives yet.` as the successful empty state. Exactly one renders `<Navigate replace>` to `/project/${id}/initiative/${initiative.id}/graph`. More than one renders a root `data-testid="initiative-picker"` with one link per initiative, labelled by name, to its canonical graph URL.
- Create `ui/src/pages/plan-unavailable.tsx` exporting `PlanUnavailablePage()`. Read project `id`; render a root `data-testid="plan-unavailable"`, no form, and these four exact list items:
  - `The HTTP API accepts parsed JSON, not the markdown package used by the CLI.`
  - `The HTTP API has no dry run and would create the graph immediately.`
  - `The HTTP API does not validate bindings as project-owned resources of the declared type.`
  - `Tasks created by HTTP apply receive no task context.`
- In that state render `CommandHandoff` with exact command `kanthord import graph ./graph --create --project ${projectId} --bind source=<repository-id>` and reason `Import the markdown graph package in the terminal.`. Render no disabled element and no import/apply button.
- Edit `ui/src/app/routes.tsx` at `ROUTE_TABLE`: change the nav row to `{path:"/project/:id/graph",kind:"screen"}`, change Plan to `{path:"/project/:id/plan",kind:"screen"}`, and insert `{path:"/project/:projectId/initiative/:initiativeId/graph",kind:"screen"}` immediately before `path:"*"`. All three rows have no `epic` key.
- In `createAppRouter()`, replace the project Graph placeholder with `InitiativePickerPage`, replace the Plan placeholder with `PlanUnavailablePage`, and register the canonical route as a top-level sibling of entity routes. Its element reads both params and renders `InitiativeGraphPage projectId initiativeId`; that page owns its ProjectShell. Do not use a query parameter for initiative scope.

## Constraints

- The picker redirects only for exactly one initiative. Zero is an explicit empty state; more than one never auto-selects.
- Export is JSON download only. It has no editor, import, apply, dry-run, binding picker, or round trip.
- All requests use `api-client.ts`; browser code sets no `Authorization` header.

## Verify

- `npm run test --workspace ui -- src/lib/download.test.ts` — create this file. Assert exact filename, two-space JSON without envelope, one trailing newline, Blob MIME, anchor click/removal, and one URL revocation.
- `npm run test --workspace ui -- src/pages/initiative-graph.test.tsx` — append export success with exact endpoint/bytes/filename, one pending click, and visible failure without graph removal.
- `npm run test --workspace ui -- src/pages/initiative-picker.test.tsx` — create this file. Assert zero text and no picker; exactly one uses replace to the exact canonical URL; two render `initiative-picker` and two API-ordered links; loading/error/missing remain distinct.
- `npm run test --workspace ui -- src/pages/plan-unavailable.test.tsx` — create this file. Assert the four exact lines once each, the exact CLI command with route ID, CommandHandoff copy behavior, no form, and no disabled element or import/apply button.
- `npm run test --workspace ui -- src/app/routes.test.tsx` — assert both graph paths, one-initiative redirect, multi-initiative picker, canonical cold load with one ProjectShell, and Plan unavailable replacing `NotBuiltYet`.
- `npm run test --workspace ui -- src/lib/api-client.test.ts` — append package escaped-path, abort, unwrapped-body, and accept-only-header assertions.
- `npm run verify` exits 0.
- Proof: phase C reaches the canonical graph URL; phase H sees `plan-unavailable` and zero page-issued Authorization headers. Picker and export behavior are mandatory hermetic coverage beyond the Proof.

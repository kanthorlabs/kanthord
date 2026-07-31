# Story 06 — the project readiness page

Epic: `.agent/plan/epics/026.6-ui-graph-and-readiness.md` (decision 8)
Depends on: Story 05.

## Change

- Append to `ui/src/lib/dto.ts` after graph DTOs, matching `src/apps/http/views/readiness.ts:20-76`:

```ts
export interface ReadinessProbeDto {
  readonly resourceId: string;
  readonly status: ProbeStatus;
  readonly detail: string;
}
export interface ReadinessCheckDto {
  readonly name:
    | "database"
    | "repository"
    | "ai_provider"
    | "initiative"
    | "notification"
    | "daemon";
  readonly status: ReadinessCheckStatus;
  readonly blocking: boolean;
  readonly detail: string;
  readonly probes?: readonly ReadinessProbeDto[];
  readonly ageSeconds?: number | null;
}
export interface ReadinessNextDto {
  readonly check: ReadinessCheckDto["name"];
  readonly action: string;
  readonly requiresInput: readonly string[];
  readonly command?: string;
}
export interface ProjectReadinessDto {
  readonly projectId: string;
  readonly configured: boolean;
  readonly verified: boolean | null;
  readonly operational: boolean;
  readonly ready: boolean;
  readonly checks: readonly ReadinessCheckDto[];
  readonly next: ReadinessNextDto | null;
}
```

- Append `projectKeys.readiness(id: string) => ["project", id, "readiness"] as const` in `ui/src/lib/query-keys.ts`.
- Append `fetchProjectReadiness(id:string,init?:RequestInitLike):Promise<ProjectReadinessDto>` in `ui/src/lib/api-client.ts`; call `apiGet` at `/api/project/${encodeURIComponent(id)}/readiness` and forward the signal.
- Create `ui/src/pages/project-readiness.tsx` exporting `ProjectReadinessPage()`. Read the nested route `id` parameter into `projectId`, throw `new Error("project readiness route requires id")` when absent, query the exact readiness key/helper with `staleTime:Infinity`, and render through `AsyncBoundary what="project readiness"`.
- In resolved state, render `Configured`, `Verified`, `Operational`, and `Ready` as labelled facts in that order. Render boolean values as `Yes` or `No`; render `verified:null` as `Unknown`. Render checks in API order. Each check root uses `data-testid="readiness-check"`, `data-check-name={name}`, and `data-blocking={String(blocking)}`. Render `StatusChip axis="readiness"`, exact `detail`, optional probes in API order with `StatusChip axis="probe"`, and `ageSeconds` whenever it is not `undefined`; render `Unknown age` for `null` and `${ageSeconds}s` otherwise, including `0s`.
- Distinguish blocking checks with the existing `danger` role and non-blocking checks with `neutral`; do not derive `blocking` from `status`.
- When `next?.command !== undefined`, render `CommandHandoff` with that exact command and reason `The daemon supplied this next readiness action.`. Do not normalize, quote, or rebuild this command.
- Render that handoff **before** the live-probe notice below, so the first
  `command-handoff` on the page is always the daemon's own command — the Proof's
  phase G reads the first one.
- Always render a separate live-probe notice stating `Live repository and provider probes are unavailable over HTTP.` followed by `CommandHandoff` with command `kanthord check project --id ${projectId} --probe-repositories --probe-provider` and reason `Run live readiness probes in the terminal.`. Build this command from the route project ID, never from `next.command`; omit `--json`.
- Edit `ui/src/app/routes.tsx` at the existing `/project/:id/readiness` sites. Change its `ROUTE_TABLE` row to `{path:"/project/:id/readiness",kind:"screen"}` with no `epic`; replace `<NotBuiltYet surface="Readiness" epic="026.6" />` in `createAppRouter()` with `<ProjectReadinessPage />`; keep the route path and ProjectShell parent.

## Constraints

- Readiness is read-only. Add no refresh probe query parameters and no POST to `/api/graph/readiness`.
- HTTP probe absence is not an empty probe result. The CLI handoff remains visible even when a fixture includes `probes[]`.
- Do not render another ProjectShell inside the page.

## Verify

- `npm run test --workspace ui -- src/pages/project-readiness.test.tsx` — create this file with the real nested route, fresh QueryClient, and mocked API helper. Assert loading/error/missing states, exact key/path, API check order, and one `readiness-check` per item.
- In the same file, assert the four facts render `Yes`, `No`, `No`, `Yes` for `{configured:true,verified:false,operational:false,ready:true}` and a separate `verified:null` fixture renders `Unknown`. Use two equal-status checks with opposite `blocking` values; assert different `data-blocking` and role classes. Assert probe rows and `ageSeconds` absent, `null`, `0`, and positive cases. Assert no status is used to infer blocking.
- Supply `next.command:"kanthord db migrate --exact"`; assert the first CommandHandoff renders and copies that exact string. Assert the probe handoff is exactly `kanthord check project --id p1 --probe-repositories --probe-provider`, contains both flags, differs from `next.command`, and is still present when `next` is null.
- `npm run test --workspace ui -- src/lib/query-keys.test.ts` — append the exact readiness key assertion.
- `npm run test --workspace ui -- src/lib/api-client.test.ts` — append escaped path, abort signal, envelope, and accept-only header assertions for `fetchProjectReadiness`.
- `npm run test --workspace ui -- src/app/routes.test.tsx` — replace the readiness placeholder assertion with the resolved page and assert one ProjectShell.
- `npm run verify` exits 0.
- Proof: phase G counts every API check and renders the seeded `next.command` (`kanthord run daemon`) verbatim in the first CommandHandoff.

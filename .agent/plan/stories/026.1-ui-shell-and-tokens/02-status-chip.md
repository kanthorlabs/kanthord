# Story S2 — StatusChip over the role map

Epic: `.agent/plan/epics/026.1-ui-shell-and-tokens.md:152-153`, `docs/ui-design.md:284-286`
Depends on: Story S1 (`ui/src/lib/status-role.ts`)

## Change

New file `ui/src/components/status-chip.tsx`.

Props are a discriminated union over the axis, so an out-of-union value is a typecheck failure, not a runtime fallback:

```ts
import type {
  DependencyState,
  ExecutionState,
  InitiativeStatus,
  ProbeStatus,
  ReadinessCheckStatus,
  TaskStatus,
} from "@/lib/status-role";

export type StatusChipProps = { readonly className?: string } & (
  | { readonly axis: "task"; readonly value: TaskStatus }
  | { readonly axis: "initiative"; readonly value: InitiativeStatus }
  | { readonly axis: "dependency"; readonly value: DependencyState }
  | { readonly axis: "execution"; readonly value: ExecutionState }
  | { readonly axis: "blockedForever"; readonly value: boolean }
  | { readonly axis: "readiness"; readonly value: ReadinessCheckStatus }
  | { readonly axis: "probe"; readonly value: ProbeStatus }
);

export function StatusChip(props: StatusChipProps): ReactElement;
```

In the same file, one label map and one icon map per axis, each `satisfies Record<…, string>` / `satisfies Record<…, LucideIcon>`. Icons come from `lucide-react` — all names below are verified present in the installed `lucide-react@1.27.0`.

| axis           | value                   | label                   | icon            |
| -------------- | ----------------------- | ----------------------- | --------------- |
| task           | `pending`               | `Pending`               | `Circle`        |
| task           | `running`               | `Running`               | `LoaderCircle`  |
| task           | `completed`             | `Completed`             | `CircleCheck`   |
| task           | `failed`                | `Failed`                | `CircleX`       |
| task           | `awaiting_confirmation` | `Awaiting confirmation` | `CircleAlert`   |
| task           | `discarded`             | `Discarded`             | `Ban`           |
| initiative     | `building`              | `Building`              | `CircleDot`     |
| initiative     | `landed`                | `Landed`                | `CircleCheck`   |
| initiative     | `discarded`             | `Discarded`             | `Ban`           |
| dependency     | `ready`                 | `Ready`                 | `Play`          |
| dependency     | `blocked`               | `Blocked`               | `CircleSlash`   |
| execution      | `runnable`              | `Runnable`              | `Play`          |
| execution      | `paused`                | `Paused`                | `CirclePause`   |
| blockedForever | `true`                  | `Blocked forever`       | `Ban`           |
| blockedForever | `false`                 | `Not blocked forever`   | `Circle`        |
| readiness      | `ok`                    | `OK`                    | `CircleCheck`   |
| readiness      | `unverified`            | `Unverified`            | `CircleHelp`    |
| readiness      | `missing`               | `Missing`               | `Circle`        |
| readiness      | `paused`                | `Paused`                | `CirclePause`   |
| readiness      | `blocked`               | `Blocked`               | `CircleSlash`   |
| readiness      | `failed`                | `Failed`                | `CircleX`       |
| readiness      | `unsupported`           | `Unsupported`           | `Ban`           |
| readiness      | `running`               | `Running`               | `LoaderCircle`  |
| readiness      | `stopped`               | `Stopped`               | `CirclePause`   |
| readiness      | `multiple`              | `Multiple`              | `TriangleAlert` |
| probe          | `ok`                    | `Probe OK`              | `CircleCheck`   |
| probe          | `failed`                | `Probe failed`          | `CircleX`       |

Rendered markup, exactly:

```tsx
<span
  data-testid="status-chip"
  data-axis={axis}
  data-value={String(value)}
  data-role={role}
  className={cn(
    "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
    ROLE_CLASS[role],
    className,
  )}
>
  <Icon
    aria-hidden="true"
    data-testid="status-chip-icon"
    className="size-3.5"
  />
  {label}
</span>
```

`role` comes from the S1 map for that axis (`TASK_STATUS_ROLE[value]`, …; `roleForBlockedForever(value)` for `blockedForever`). `cn` is `ui/src/lib/utils.ts`.

## Constraints

- Colour comes only from `ROLE_CLASS[role]`. No `cva`, no variant prop, no inline style, no per-value colour.
- The `axis` switch must be exhaustive with no `default` branch that swallows an unknown axis; end it with a `never`-typed check so a new axis fails `npm run ui:typecheck`.
- No API call, no query, no router hook. `StatusChip` is pure presentation over its props.
- Do not touch `ui/src/lib/status-role.ts` — S1 owns it. If a label or icon needs a value that is not in S1's unions, raise an `OPEN:` blocker.

## Verify

- New test file `ui/src/components/status-chip.test.tsx`, run with `npm run ui:test`. Follow the convention of `ui/src/pages/health.test.tsx:3-33` (explicit `vitest` imports, `test(`, own `afterEach(cleanup)`). No `QueryClientProvider` is needed.
  - A table-driven test over **all 27 rows above**: for each `{axis, value}` render `<StatusChip …/>` and assert the chip has `data-role` equal to the role S1 maps for it, that its `className` contains `text-role-<role>`, that its text content equals the label from the table, and that `[data-testid="status-chip-icon"]` is in the document.
  - A test that `data-axis` and `data-value` carry the input verbatim (`value: false` renders `data-value="false"`).
  - A test that two values sharing one role render the same `data-role` but different labels — use `task/pending` vs `task/discarded` (both `neutral`) — proving label carries the domain specificity, not colour.
  - A test that a `className` prop is merged, not dropped.
- `npm run ui:typecheck` and `npm run ui:lint` exit 0.
- `npm run verify` exits 0.
- Proof: none directly. StatusChip has no Proof selector in this epic; it is the token layer's first consumer and 026.2's dependency.

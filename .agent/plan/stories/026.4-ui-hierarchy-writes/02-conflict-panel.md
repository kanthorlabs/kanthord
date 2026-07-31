# Story 02 — the three-version conflict panel

Epic: `.agent/plan/epics/026.4-ui-hierarchy-writes.md` (decisions 2, 3)
Depends on: Story 01 (it renders that hook's `conflict` / `client-defect` states).

## Change

### `ui/src/components/conflict-panel.tsx` — new file

```ts
export interface ConflictPanelProps<T, D> {
  readonly base: T;
  readonly draft: D;
  readonly current: T;
  readonly describe: (value: T | D) => string;
  readonly onReload: () => void;
  readonly reloading: boolean;
}
export function ConflictPanel<T, D>(
  props: ConflictPanelProps<T, D>,
): ReactElement;

export interface ClientDefectNoticeProps {
  readonly requestId: string | undefined;
}
export function ClientDefectNotice(
  props: ClientDefectNoticeProps,
): ReactElement;
```

`ConflictPanel` renders, in this order, inside one container:

| element     | `data-testid`      | content                                                                        |
| ----------- | ------------------ | ------------------------------------------------------------------------------ |
| container   | `conflict`         | `role="alert"`, `data-role="attention"`, `className={ROLE_CLASS.attention}`    |
| heading     | –                  | `Someone else changed this while you were editing.`                            |
| base row    | `conflict-base`    | label `Was` + `describe(base)`                                                 |
| draft row   | `conflict-draft`   | label `Your change` + `describe(draft)`                                        |
| current row | `conflict-current` | label `Now on the server` + `describe(current)`                                |
| button      | `conflict-reload`  | label `Load the current version`, `onClick={onReload}`, `disabled={reloading}` |

- The three value rows render `describe(...)` verbatim as text — no truncation,
  no ellipsis, no diff computation.
- The component is **presentational**: it holds no state, calls no API helper,
  imports nothing from `@/lib/api-client` or `@/lib/edit-session`, and never
  invalidates a query.
- `ClientDefectNotice` renders `data-testid="client-defect"`, `role="alert"`,
  `data-role="danger"`, `className={ROLE_CLASS.danger}`, the text
  `The app sent an edit without a version. This is a bug in this screen, not a
conflict.`, and, when `requestId` is defined, a
  `<code data-testid="client-defect-request-id">` with it.
- Reuse `ROLE_CLASS` from `@/lib/status-role`; add no colour and never
  interpolate a role into a class name (F12).

## Constraints

- No new `data-testid` beyond the six above plus `client-defect` and
  `client-defect-request-id`.
- Do not extend `AsyncBoundary`'s state union — 026.3 decision 2 keeps a new
  surface as its own component.
- No `Sheet`, no `Dialog`, no `AlertDialog`: the panel renders **inline inside
  the form it belongs to**, so the operator's draft stays visible next to it.

## Verify

`npm run test --workspace ui -- src/components/conflict-panel.test.tsx` — new file:

- renders the three values distinctly: `conflict-base` contains only the base
  text, `conflict-draft` only the draft text, `conflict-current` only the current
  text, and the three strings are not confused when two of them are equal
  (pass `base === current` and assert each testid still holds its own row).
- the container carries `role="alert"` and `data-role="attention"`.
- clicking `conflict-reload` calls `onReload` exactly once.
- `reloading: true` renders `conflict-reload` disabled and a further click does
  not call `onReload`.
- `ClientDefectNotice` renders `client-defect` with `data-role="danger"` and does
  **not** render `conflict`; with `requestId: undefined` it renders no
  `client-defect-request-id`.

`npm run verify` exits 0.

Proof: `ui-writes-proof.sh:166-169` — `conflict` visible, `conflict-draft`,
`conflict-base` and `conflict-current` each holding their own version; `:171`
`conflict-reload` is clickable.

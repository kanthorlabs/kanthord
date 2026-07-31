# Story 06 — the disabled-action inventory, driven by the server's `action`

Epic: `.agent/plan/epics/026.3-ui-entity-workspaces.md` (decisions 7, 8, 9)
Depends on: Story 05 (it edits `ui/src/pages/entity-task.tsx`);
EPIC 026.1 Story 07 (`CommandHandoff`).

## Change

### 1. New file `ui/src/components/action-inventory.tsx`

```ts
/**
 * Action kinds whose control a LATER UI epic owns, mapped to that epic. This is
 * a statement about what this UI has built, NOT a client-side mirror of the
 * daemon's route table: "a route exists" and "the browser can drive it" are
 * different properties, and only the second one decides what renders.
 *
 * `remove-dependency` is here because `DELETE /api/task/:id/dependency/:dependencyId`
 * exists (`src/apps/http/routes.ts:838-850`, index.md F9) and EPIC 026.4 wires
 * it. 026.4 removes its own entry when it does.
 */
export const ACTION_KINDS_DEFERRED_TO_LATER_EPICS: Readonly<
  Record<string, string>
> = {
  "remove-dependency": "026.4",
};

/** `src/domain/actionability.ts:9-15`. */
export const ACTION_KIND_LABEL: Readonly<Record<string, string>> = {
  retry: "Retry",
  approve: "Approve",
  reject: "Reject",
  publish: "Publish",
  "resume-initiative": "Resume initiative",
  "remove-dependency": "Remove dependency",
};

export interface ActionInventoryProps {
  readonly action: ActionDto | null;
}
export function ActionInventory({
  action,
}: ActionInventoryProps): ReactElement | null;
```

Pinned behaviour — decision 7, driven entirely by the server's `action`, with no
client status table anywhere in the module:

1. `action === null` → return `null`. **No control is rendered** — not disabled,
   not greyed, not a placeholder.
2. `action.kind in ACTION_KINDS_DEFERRED_TO_LATER_EPICS` → return `null`. A later
   UI epic owns that control, and an unbuilt control is omitted rather than
   greyed out (026.2 decision 8). Rendering it disabled with rule 3's reason
   would state something false: for `remove-dependency` the daemon _does_ have an
   HTTP action.
3. otherwise render exactly:

```tsx
<section
  data-testid="disabled-action"
  data-action-kind={action.kind}
  data-target-type={action.target.type}
  data-target-id={action.target.id}
  className="flex flex-col gap-2 rounded-md border p-3 text-sm"
>
  <Button type="button" disabled data-testid="disabled-action-button">
    {ACTION_KIND_LABEL[action.kind] ?? action.kind}
  </Button>
  <p data-testid="disabled-action-reason">{REASON}</p>
  {action.requiresInput.length > 0 && (
    <p data-testid="disabled-action-requires">
      It needs: {action.requiresInput.join(", ")}.
    </p>
  )}
  {"command" in action && action.command !== undefined ? (
    <CommandHandoff command={action.command} reason={REASON} />
  ) : (
    <p data-testid="no-command">
      The daemon did not supply a command for this action.
    </p>
  )}
</section>
```

`REASON` is the exact string
`The daemon has no HTTP action for this yet — run it from the CLI.`

- The presence test is `"command" in action` (index.md F5/F9): `command` is an
  **omitted key**, never `null`.
- **Never build a command string.** No template, no `kanthord ` prefix, no
  `--json`, no id interpolation anywhere in this module. When the server supplied
  none, `no-command` renders and `[data-testid="command-handoff"]` is absent.
- `ACTION_KIND_LABEL[action.kind] ?? action.kind` is the only fallback: `kind` is
  typed `string` at the HTTP boundary (`src/apps/http/views/shared.ts:2`), so an
  unknown kind still renders a labelled disabled control.
- `Button` from `@/components/ui/button`. Resolve `CommandHandoff`'s module
  mechanically (`rg -n "export function CommandHandoff" ui/src`) and import from
  the single file that matches; its props are
  `{command: string, reason: string}` (EPIC 026.1 S7). If it does not exist,
  026.1 S7 did not ship: raise an `OPEN:` blocker instead of writing a second
  copy.

### 2. Edit `ui/src/pages/entity-task.tsx`

In the Summary panel, immediately after the `task-blocked-forever` section
(Story 05), render `<ActionInventory action={task.action} />`. That is the only
call site in this epic: `TaskDetailDto` is the only detail DTO with an `action`
field (index.md F9).

## Constraints

- No status→action table. Nothing in this module or its call site reads
  `task.status`, `task.blockedForever` or `task.abandoning` to decide whether to
  render. `action` is the whole input.
- The button is `disabled` and has no `onClick`. This epic issues no POST, PATCH
  or DELETE (decision 9, index.md F15).
- `remove-dependency` renders nothing here even though it has a route — do not
  special-case it into an enabled control.
- Do not add this component to the initiative, objective or resource page: those
  DTOs have no `action`.

## Verify

- New `ui/src/components/action-inventory.test.tsx` —
  `npm run test --workspace ui -- src/components/action-inventory.test.tsx`,
  over stubbed `ActionDto` values (no router, no query client needed beyond what
  `CommandHandoff` requires):
  - `action: null` → the container is empty: zero `[data-testid="disabled-action"]`,
    zero `[data-testid="command-handoff"]`, zero `[data-testid="no-command"]`,
    and `queryAllByRole("button")` is length 0.
  - `{kind:"remove-dependency", target:{type:"task",id:"t1"}, targetDependencyId:"tB", requiresInput:[], command:"remove dependency --task t1 --dependency tB"}`
    → zero `disabled-action` and zero `command-handoff`, even though a command
    was supplied.
  - `{kind:"retry", target:{type:"task",id:"t1"}, requiresInput:[], command:"retry task --id t1"}`
    → one `disabled-action` with `data-action-kind="retry"`,
    `data-target-type="task"`, `data-target-id="t1"`;
    `disabled-action-button` reads `Retry` and has the `disabled` attribute;
    `disabled-action-reason` reads the exact `REASON` string; one
    `[data-testid="command-handoff"]` whose
    `[data-testid="command-handoff-command"]` text is **exactly**
    `retry task --id t1`; zero `no-command`.
  - `{kind:"reject", target:{type:"task",id:"t1"}, requiresInput:["resolution","reason"]}`
    (**no** `command` key) → one `disabled-action` with
    `data-action-kind="reject"`, `disabled-action-requires` text contains
    `resolution` and `reason`, one `no-command`, and **zero**
    `[data-testid="command-handoff"]`. Assert also that no rendered text
    contains `kanthord` and no rendered text contains `--json` — the component
    fabricates nothing.
  - `{kind:"approve", target:{type:"objective",id:"o1"}, requiresInput:["expectedCommit"]}`
    → `no-command` renders (index.md F9: an objective action reached through
    `nodeAction` never carries a command).
  - `{kind:"publish", target:{type:"repository",id:"r1"}, requiresInput:[], command:"publish repository --repository r1 --branch main"}`
    → `disabled-action-button` reads `Publish` and the handoff command is that
    exact string.
  - `{kind:"resume-initiative", target:{type:"initiative",id:"i1"}, requiresInput:[], command:"resume initiative --id i1"}`
    → the button reads `Resume initiative`.
  - an unknown kind `{kind:"teleport", …}` → one `disabled-action` with
    `data-action-kind="teleport"` and the button reads `teleport`.
  - `requiresInput: []` → `disabled-action-requires` is absent.
  - the button issues nothing: `userEvent.click` on `disabled-action-button`
    leaves a `vi.spyOn(globalThis, "fetch")` stub with zero calls.
- Extend `ui/src/pages/entity-task.test.tsx` (Story 05's file) —
  `npm run test --workspace ui -- src/pages/entity-task.test.tsx`:
  - the pending fixture (`action: null`) renders **zero**
    `[data-testid="disabled-action"]` on the Summary tab.
  - `status:"failed"` with
    `action:{kind:"retry",target:{type:"task",id:"t1"},requiresInput:[],command:"retry task --id t1"}`
    → `disabled-action` and `command-handoff` render on the Summary tab, and the
    handoff command is exactly `retry task --id t1`.
  - `status:"awaiting_confirmation"` with
    `action:{kind:"reject",target:{type:"task",id:"t1"},requiresInput:["resolution","reason"]}`
    → `disabled-action` renders with `no-command` and no `command-handoff`.
  - `status:"running", abandoning:true, action:null` → `task-abandoning` renders
    and `disabled-action` does not — proving the inventory reads `action`, not
    the status.
  - `action:{kind:"remove-dependency",…}` on a `blockedForever` task → the
    `task-blocked-forever` section renders with its blocking id **and** zero
    `disabled-action`.
- `npm run verify` exits 0.
- Proof: none directly — decision 8 states plainly that these branches are proven
  hermetically, because a deterministic fixture cannot reach
  `awaiting_confirmation` or `failed` without a real agent run. Story 06 does
  keep the Proof's **phase H** true (no POST/PATCH/DELETE, no `Authorization`).

# Story S7 — CommandHandoff and DangerConfirm

Epic: `.agent/plan/epics/026.1-ui-shell-and-tokens.md` decision 10 and `:159-161`; `docs/ui-design.md:262-265`, `docs/ui-design.md:245-249`

Both parts land here with **no consumer**: `CommandHandoff` gets one in 026.3, `DangerConfirm` in 026.4. That is the accepted cost of the binding roadmap. Add no variant, no option and no generalisation before a consumer asks for it.

## Change

### 1. New file `ui/src/components/command-handoff.tsx`

```ts
export interface CommandHandoffProps {
  /** The CLI invocation, rendered verbatim. */
  readonly command: string;
  /** Why the browser cannot do it, one sentence. */
  readonly reason: string;
}
export function CommandHandoff({
  command,
  reason,
}: CommandHandoffProps): ReactElement;
```

Renders:

```tsx
<div
  data-testid="command-handoff"
  className="flex flex-col gap-2 rounded-md border p-3 text-sm"
>
  <p data-testid="command-handoff-note">
    This runs in your terminal, not in the browser. {reason}
  </p>
  <div className="flex items-center gap-2">
    <code
      data-testid="command-handoff-command"
      className="flex-1 overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs"
    >
      {command}
    </code>
    <Button
      type="button"
      variant="outline"
      size="xs"
      data-testid="command-handoff-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(command);
      }}
    >
      <Copy aria-hidden="true" className="size-3.5" />
      Copy
    </Button>
  </div>
</div>
```

`command` is rendered verbatim — no truncation, no ellipsis, no re-quoting, no syntax highlighting. `Button` from `@/components/ui/button`, `Copy` from `lucide-react`.

### 2. New file `ui/src/components/danger-confirm.tsx`

```ts
export interface DangerConfirmProps {
  /** The control that opens the dialog — the only thing rendered at rest. */
  readonly trigger: ReactNode;
  readonly title: string;
  readonly description: string;
  /** Label of the destructive confirm action, e.g. "Remove dependency". */
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
}
export function DangerConfirm(props: DangerConfirmProps): ReactElement;
```

Built on `@/components/ui/alert-dialog`:

```tsx
<AlertDialog>
  <AlertDialogTrigger asChild data-testid="danger-confirm-trigger">
    {trigger}
  </AlertDialogTrigger>
  <AlertDialogContent data-testid="danger-confirm-dialog">
    <AlertDialogHeader>
      <AlertDialogTitle>{title}</AlertDialogTitle>
      <AlertDialogDescription>{description}</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel data-testid="danger-confirm-cancel">
        Cancel
      </AlertDialogCancel>
      <AlertDialogAction
        variant="destructive"
        data-testid="danger-confirm-accept"
        onClick={onConfirm}
      >
        {confirmLabel}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

`AlertDialogAction` already accepts `variant` (`ui/src/components/ui/alert-dialog.tsx:147-163`).

## Constraints

- `onConfirm` fires **only** from `AlertDialogAction`. Never from the trigger, never from `Cancel`, never on dialog close.
- The dialog content must stay inside `AlertDialogContent`, which portals to `document.body`. The confirm button is therefore never a DOM sibling of the trigger — that is the mechanical form of "never a visual sibling of a benign action" (`docs/ui-design.md:245-249`).
- No `open`/`onOpenChange` prop, no `variant`, no `size`, no `disabled`, no async/loading state on either component. Consumers arrive in 026.3 and 026.4.
- `navigator.clipboard` may be absent (jsdom, and a non-secure context): use the optional call shown above so a missing clipboard cannot throw.
- Neither component calls `fetch`, a query, or a router hook.
- Do not wire either component into a screen, the shells or the route table.

## Verify

- New test file `ui/src/components/command-handoff.test.tsx` (`npm run ui:test`), conventions from `ui/src/pages/health.test.tsx:3-33`:
  - `command="kanthord approve task 01J…"` → `[data-testid="command-handoff-command"]` `textContent` is **exactly** that string, character for character.
  - A command containing shell quoting, e.g. `kanthord create task --title "a b"`, renders unchanged (no escaping, no `&quot;`).
  - The element is a `<code>` element (`.tagName === "CODE"`).
  - `[data-testid="command-handoff-note"]` text contains `not in the browser` and contains the `reason` prop verbatim.
  - Copy: stub the clipboard with `Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn() }, configurable: true })`, click `[data-testid="command-handoff-copy"]`, assert `writeText` was called once with the exact command.
  - With `navigator.clipboard` deleted, a click does not throw (`expect(() => …).not.toThrow()` around the click).
- New test file `ui/src/components/danger-confirm.test.tsx` (`npm run ui:test`):
  - At rest: the trigger is in the document, and `[data-testid="danger-confirm-accept"]` is **not** — an explicit confirm step is required.
  - After clicking the trigger: `[data-testid="danger-confirm-accept"]` and `[data-testid="danger-confirm-cancel"]` are both present, `title` and `description` are rendered, and `onConfirm` has not been called yet.
  - Clicking accept calls `onConfirm` exactly once.
  - Clicking cancel does not call `onConfirm`, and the accept button leaves the document.
  - Not a sibling: after opening, assert the trigger's `parentElement` does not contain `[data-testid="danger-confirm-accept"]`.
  - The accept button carries the destructive styling: `data-variant="destructive"` (emitted by `Button`, `ui/src/components/ui/button.tsx:56`).
- `npm run ui:typecheck`, `npm run ui:lint` exit 0.
- `npm run verify` exits 0.
- Proof: none. Neither part has a Proof selector in this epic; both are required by the epic's Verification Gate hermetic coverage list (`:159-161`).

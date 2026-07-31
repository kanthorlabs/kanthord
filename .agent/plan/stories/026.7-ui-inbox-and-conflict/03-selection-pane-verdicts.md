# Story 03 — the selection pane and the verdict inventory

Epic: `.agent/plan/epics/026.7-ui-inbox-and-conflict.md` (decision 5)
Depends on: Story 02.

## Change

- Create `ui/src/components/verdict-list.tsx`. It is the **single** verdict
  renderer in the app; the conflict response region (Stories 05–06) imports the
  same symbol.

```ts
export const VERDICT_REASON =
  "The daemon has no HTTP action for this yet — run it from the CLI.";
export interface VerdictListProps {
  readonly verdicts: readonly QueueVerdictDto[];
}
export function VerdictList({ verdicts }: VerdictListProps): ReactElement;
```

- `VERDICT_REASON` is the identical string already exported as `REASON` inside
  `ui/src/components/action-inventory.tsx:85-86`. Import the kind labels rather
  than retyping them: `import { ACTION_KIND_LABEL } from "@/components/action-inventory";`
  (EPIC 026.3 Story 06 exports it). Do **not** import
  `ACTION_KINDS_DEFERRED_TO_LATER_EPICS` — decision 5 requires one rendered
  verdict per API verdict, so no kind is ever hidden here.
- `verdicts.length === 0` → render exactly
  `<p data-testid="verdict-none">The daemon named nothing it can do for this item yet.</p>`
  and no list.
- Otherwise `<ul data-testid="verdict-list">` with one
  `<li data-testid="verdict" data-verdict-kind={v.kind} data-target-type={v.target.type} data-target-id={v.target.id}>`
  per verdict, in server order. Each `<li>` contains, in this order:
  1. `<p data-testid="verdict-label">` with
     `` `${ACTION_KIND_LABEL[v.kind] ?? v.kind} · ${v.target.type} …${v.target.id.slice(-8)}` ``.
  2. When `"command" in v && v.command !== undefined`:
     `<CommandHandoff command={v.command} reason={VERDICT_REASON} />`. The command
     string is passed through untouched — no prefix, no suffix, no interpolation.
  3. When it is not: a disabled control and the missing inputs —
     `<Button type="button" disabled data-testid="verdict-button">{label}</Button>`
     with no `onClick`, then
     `<p data-testid="verdict-missing-input">{`It needs: ${v.requiresInput.join(", ")}.`}</p>`
     when `v.requiresInput.length > 0`, else
     `<p data-testid="verdict-no-command">The daemon supplied no command and named no missing input for this action.</p>`.
- The presence test is exactly `"command" in v && v.command !== undefined`, the
  same predicate `action-inventory.tsx` uses. Never `v.command === null`, never a
  truthiness check on the string (a `command` of `""` would then be dropped).
- In `ui/src/pages/inbox.tsx`, add selection state
  `const [selectedKey, setSelectedKey] = useState<string | null>(null);`. A row
  click and an `Enter`/`Space` key press on the row call
  `setSelectedKey(rowKey(item))`. The selected row carries
  `aria-selected={true}` and `data-selected="true"`.
- Resolve the selection from the current data, never from a stored object:
  `const selected = queue.data?.items.find((i) => rowKey(i) === selectedKey) ?? null;`
  When `selected === null`, no pane renders.
- The pane wraps EPIC 026.2's `DetailPane` so the W1 detail shape is not
  duplicated:

```tsx
<div data-testid="inbox-pane">
  <DetailPane
    title={selected.kindLabel}
    rows={rows}
    onClose={() => setSelectedKey(null)}
  >
    {evidence}
    <VerdictList verdicts={selected.verdicts} />
    {links}
  </DetailPane>
</div>
```

- `rows` are exactly these `DetailRow`s, in order, all from the DTO:
  `Kind` → `kindLabel`; `Project` → `projectName`; `Target` →
  `` `${target.type} ${target.id}` `` (full id here, the pane has the width);
  `Downstream` → `String(downstream)`; `Age` →
  `relativeAge(ageNow, actionableSince)`; then `Cause` → `cause` **only when the
  key is present**; then `Expected commit` → `expectedCommit` **only when the key
  is present**. An absent optional key adds no row at all.
- Create `ui/src/components/evidence-block.tsx`. It is the single renderer for either
  evidence contract; the objective conflict variant (Story 06) imports the same
  symbol.

```ts
export const EVIDENCE_INSPECT_REASON = "Read the evidence in your terminal.";
export interface EvidenceBlockProps {
  /** The wider of the two evidence contracts; queue evidence is assignable. */
  readonly evidence: ConflictEvidenceDto;
}
export function EvidenceBlock({ evidence }: EvidenceBlockProps): ReactElement;
```

It renders `<section data-testid="evidence">` containing, in order:
`<p data-testid="evidence-basis">` with `evidence.basis` verbatim; then exactly
one of
`<p data-testid="evidence-no-diff">The daemon cannot render a diff for this item in the browser.</p>`
when `evidence.diffAvailable === false`, or
`<p data-testid="evidence-diff-available">The daemon reports a diff is available; read it in your terminal.</p>`
when it is `true`; then the inspect command, computed once as
`const command = inspectCommand(evidence.inspect);`:

- `command !== null` → `<div data-testid="evidence-inspect">` wrapping
  `<CommandHandoff command={command} reason={EVIDENCE_INSPECT_REASON} />`.
- `command === null` (which happens only when `evidence.inspect === null`) →
  `<p data-testid="evidence-no-inspect">The daemon could not name a command to inspect this evidence.</p>`
  and **no** `evidence-inspect` wrapper — decision 9's "never an empty command
  box".
- This is the permitted side of decision 10 as amended 2026-07-31: every token in
  that line came from the server, and `inspectCommand` adds separators and quoting
  only. `docs/ui-design.md:262-265` requires `evidence.inspect` to be rendered
  copyably.
- `evidence` in the pane is `<div data-testid="inbox-evidence"><EvidenceBlock evidence={selected.evidence} /></div>`.
- `links` is a `<nav data-testid="inbox-links">` of secondary `Link`s from
  `react-router-dom`, rendered **after** the verdicts, each present only when
  every id it needs is present on the item:
  - `data-testid="link-entity"` — the canonical 026.3 route for `rowTarget(item)`:
    task → `/project/{projectId}/initiative/{initiativeId}/objective/{objectiveId}/task/{taskId}`
    (requires `objectiveId` **and** `taskId`); objective →
    `/project/{projectId}/initiative/{initiativeId}/objective/{objectiveId}`;
    initiative → `/project/{projectId}/initiative/{initiativeId}`.
  - `data-testid="link-conflict"` — the Story 07 conflict route for the same
    target: task → `…/task/{taskId}/conflict`; objective →
    `…/objective/{objectiveId}/conflict`; initiative target → no link.
    A missing id renders no link and no disabled placeholder.

## Constraints

- Choosing a command token is forbidden anywhere in this story: no template
  literal that names a CLI verb or flag, no `kanthord ` prefix, no `--json`, no id
  interpolated into a command, no status-to-command table. `CommandHandoff`
  receives either a server-supplied `verdict.command` verbatim, or
  `inspectCommand(evidence.inspect)` — whose every token also came from the server.
  No third source exists.
- Do not reuse `ActionInventory` to render a verdict: it returns `null` for
  `remove-dependency` and its `disabled-action` testids belong to the task
  workspace. Import only `ACTION_KIND_LABEL` from it.
- No verdict control gets an `onClick`, a `form`, a `DangerConfirm`, or a
  mutation. No route in this epic writes.
- Selection must not fetch. This story adds no `useQuery`.
- Do not put the selection in the URL. `#/inbox/:itemId` stays unregistered
  (decision 1); the routes test's `no path matches /^\/inbox\//` assertion
  (EPIC 026.3) must stay green.

## Verify

- `npm test --workspace ui -- src/components/verdict-list.test.tsx` — create this
  file. Assert:
  - empty `verdicts` renders `verdict-none` and no `verdict`;
  - three verdicts render three `verdict` elements in array order with the exact
    `data-verdict-kind`, `data-target-type` and `data-target-id`;
  - a verdict with `command: "approve task --id t1"` renders one
    `command-handoff` whose `command-handoff-command` text is that string
    byte-for-byte, and renders no `verdict-button` and no
    `verdict-missing-input`;
  - a verdict with **no** `command` key and
    `requiresInput: ["resolution","reason"]` renders `verdict-button` with the
    `disabled` attribute and no `onClick` effect, plus `verdict-missing-input`
    reading `It needs: resolution, reason.`;
  - a verdict with `command: undefined` **present as a key** is treated as
    commanded-absent by the `"command" in v` rule — assert the disabled branch,
    documenting the rule;
  - a verdict with no command and `requiresInput: []` renders
    `verdict-no-command`;
  - an unknown `kind: "escalate"` falls back to the raw kind in
    `verdict-label`;
  - `remove-dependency` renders a verdict (it is **not** hidden).
- `npm test --workspace ui -- src/components/evidence-block.test.tsx` — create
  this file. Assert: `basis` rendered verbatim; `diffAvailable: false` renders
  `evidence-no-diff` and not `evidence-diff-available`, and `true` the reverse;
  `{executable:"git",args:["-C","/tmp/home","diff","abc..def"]}` renders exactly
  one `command-handoff` inside `evidence-inspect` whose `command-handoff-command`
  text is `git -C /tmp/home diff abc..def`, with `command-handoff-copy` present;
  a home containing a space renders the quoted form;
  `inspect: null` renders `evidence-no-inspect` and **zero** `evidence-inspect`
  and **zero** `command-handoff`.
- `npm test --workspace ui -- src/pages/inbox.test.tsx` — extend Story 02's file.
  Assert:
  - no `inbox-pane` before a click; clicking the first row opens exactly one
    `inbox-pane`; the close button removes it;
  - the pane's rows are exactly the required set for an item with no `cause` and
    no `expectedCommit`, and gain exactly one row each when those keys are
    present;
  - one `verdict` per API verdict for the selected item;
  - the pane contains exactly one `inbox-evidence` wrapping one `evidence`
    element for the selected item's `evidence` (the branch detail is covered by
    `evidence-block.test.tsx`; here assert only that the selected item's
    `evidence` is the one passed, by asserting its `evidence-basis` text);
  - `link-entity` href is the exact canonical chain for a task item; an item with
    a `taskId` but no `objectiveId` renders no `link-entity`; an
    initiative-target item renders no `link-conflict`;
  - `link-conflict` href for a task item ends
    `/objective/o1/task/t1/conflict`, and for an objective item ends
    `/objective/o1/conflict`;
  - opening the pane records no additional `fetch` request (the recorded list
    stays at length 1).

  Use Story 02's `globalThis.fetch` stub, not a `@/lib/api-client` mock.

- `npm run verify` exits 0.
- Proof: phase E (selecting the row opens `inbox-pane`; one `verdict` per API
  verdict; the server's own `command` appears verbatim inside the pane).

# Story 7 — publication's four states, and the permanence notice

Epic: `.agent/plan/epics/026.5-ui-resource-writes.md` (decisions 9, 10)
Depends on: Story 2, Story 4, Story 6.

## Change

### Edit `ui/src/lib/status-role.ts` (026.1)

Append two functions below `publicationLabel`; change `publicationLabel`,
`Publication` and `PublicationState` in no way.

```ts
/** Four distinct states: `null` is not `unpublished` (EPIC 026.5 decision 9). */
export function publicationStateLabel(publication: Publication | null): string {
  return publication === null
    ? "no publication record"
    : publicationLabel(publication);
}
/** The machine-readable state: `"none"` for a null record. */
export function publicationStateAttr(publication: Publication | null): string {
  return publication === null ? "none" : publication.state;
}
```

`publicationStateAttr` returns exactly one of `"none"`, `"unpublished"`,
`"published"`, `"diverged"`.

### Edit `ui/src/pages/entity-resource.tsx`

Replace the `Publication` row's value in `ResourceSummary`'s `repository` branch.
Before (026.3 story 07):

```tsx
<span data-testid="resource-publication">
  {resource.publication === null ? "—" : publicationLabel(resource.publication)}
</span>
```

After — the outer test id stays so 026.3's other assertions keep working, and the
new id is nested inside it:

```tsx
<span data-testid="resource-publication">
  <span
    data-testid="publication-state"
    data-publication-state={publicationStateAttr(resource.publication)}
  >
    {publicationStateLabel(resource.publication)}
  </span>
</span>
```

It stays read-only: no land control, no publish control (epic non-goals, index
F13).

### Edit `ui/src/pages/entity-resource.test.tsx`

One assertion changes: 026.3 story 07's `publication:null` case expected
`resource-publication` to read `—`; it now reads `no publication record`. Every
other assertion in the file, including
`publication:{state:"published",remoteOID:"abc123"}` → `published@abc123` and
`{state:"unpublished",remoteOID:null}` → `unpublished`, stays byte-identical.

### Edit `ui/src/components/resource-create.tsx` (Story 2)

Render both notices unconditionally, above the `resource-create` button and
**outside** the `open` gate — the Proof asserts `no-delete-notice` is visible on a
cold-loaded collection tab before the create form is opened
(`ui-resources-proof.sh:112`).

```tsx
<p data-testid="no-delete-notice" data-role="attention" className={ROLE_CLASS.attention}>
  A resource cannot be deleted. There is no delete route — you can only rename or
  update it.
</p>
<p data-testid="unique-name-note">
  The name must be unique across the whole project, not just within this type.
</p>
```

### Edit `ui/src/components/create-credential-resource.tsx` (Story 2) and `ui/src/components/create-notification-resource.tsx` (Story 6)

Mark the create-only field in each (decision 10). In both files:

- add `data-create-only="true"` to the `provider` control (the credential's
  `Input name="provider"`, the notification's
  `select[data-testid="notification-provider"]`);
- render, directly under that control:

  ```tsx
  <p data-testid="create-only-note">
    Provider is set once, at create. It cannot be changed later.
  </p>
  ```

The repository and filesystem create forms have no create-only field, so they
render **no** `create-only-note` and **no** `data-create-only` attribute.

## Constraints

- `no-delete-notice` renders for every known resource type and must not render on
  the unknown-type (`async-missing`) branch of `ui/src/pages/project-resources.tsx`
  — it lives inside `ResourceCreate`, which that branch already does not mount
  (Story 2).
- `null` publication is never rendered as `unpublished`, `—`, `none` or an empty
  string in the resource workspace (decision 9).
- Do not add a publication control of any kind, and do not add `publish` or
  `land` to `ACTION_KINDS_DEFERRED_TO_LATER_EPICS`.
- Do not change the collection table's publication cell in
  `ui/src/pages/project-resources.tsx` — a list row always carries
  `publication: null` (026.2 index F5) and `—` there stays correct.

## Verify

- Extended `ui/src/lib/status-role.test.ts` —
  `npm run test --workspace ui -- src/lib/status-role.test.ts`:
  - `publicationStateLabel(null)` is `no publication record`;
    `publicationStateLabel({state:"unpublished",remoteOID:null})` is
    `unpublished`;
    `publicationStateLabel({state:"published",remoteOID:"abc123"})` is
    `published@abc123`;
    `publicationStateLabel({state:"diverged",remoteOID:"abc123"})` is `diverged`.
  - the four labels above are four distinct strings
    (`new Set([...]).size === 4`).
  - `publicationStateAttr` returns `none`, `unpublished`, `published`,
    `diverged` for the same four inputs.
  - every existing `publicationLabel` assertion still passes unchanged.
- Extended `ui/src/pages/entity-resource.test.tsx` —
  `npm run test --workspace ui -- src/pages/entity-resource.test.tsx`:
  - all four publication cases render `[data-testid="publication-state"]` with
    `data-publication-state` equal to `none` / `unpublished` / `published` /
    `diverged`, and four distinct `textContent` values;
  - `[data-testid="resource-publication"]`'s `textContent` equals
    `[data-testid="publication-state"]`'s in every case;
  - a credential, notification and filesystem page render zero
    `[data-testid="publication-state"]`.
- Extended `ui/src/components/resource-create.test.tsx`:
  - `no-delete-notice` and `unique-name-note` render for all four types **before**
    `resource-create` is clicked, and their text matches the pinned sentences
    verbatim;
  - `no-delete-notice` contains the words `cannot be deleted`.
- Extended `ui/src/pages/project-resources.test.tsx`:
  - a known type renders exactly one `no-delete-notice`; the unknown-type case
    (`#/project/p1/resource/not-a-type`) renders zero.
- Extended `ui/src/components/create-credential-resource.test.tsx` and
  `ui/src/components/create-notification-resource.test.tsx`:
  - the `provider` control carries `data-create-only="true"` and exactly one
    `create-only-note` renders with the pinned sentence.
- Extended `ui/src/components/create-repository-resource.test.tsx` and
  `ui/src/components/create-filesystem-resource.test.tsx`:
  - zero `create-only-note` and zero `[data-create-only]` elements.
- `npm run verify` exits 0.
- Proof: `ui-resources-proof.sh:112` (the `no-delete-notice` visible on a cold
  credential tab) and phase G's `:195` (`publication-state` visible on the
  repository workspace).

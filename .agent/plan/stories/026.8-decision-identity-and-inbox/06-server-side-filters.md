# Story 6 — server-side filters before ranking, global counts

Epic: `.agent/plan/epics/026.8-decision-identity-and-inbox.md`
Depends on: Story 3, Story 4.

## Change

1. **Use case** — `src/app/project/get-decision-queue.ts`:

- `execute` signature (`:225`) becomes
  `async execute(input: { limit?: number; kind?: string; projectId?: string })`.
- Pinned step order inside `execute` (the tail that replaced `:358-375` in Story
  3):
  1. `const { items, warnings } = await this.#projection.project();` — the full,
     **unfiltered** set;
  2. reconcile occurrences and attach `id` / `kind` / `state` (Story 3);
  3. `counts.total = items.length` and `counts.byKind` over **all** items,
     keyed by machine kind (Story 4) — the counts are global and never see the
     filter;
  4. filter: keep an item when `input.kind === undefined || item.kind ===
input.kind`, and when `input.projectId === undefined || item.projectId ===
input.projectId`;
  5. `const filtered = …; const ranked = rankDecisions(filtered);`
  6. `const pageItems = ranked.slice(0, limit);`
     `const truncated = pageItems.length < filtered.length;`
- `warnings` are unchanged and are **not** filtered.
- `projectId` filtering happens after `project()`; never push it into
  `DecisionProjection` — the reconcile and the global counts both need every
  project.

2. **HTTP decode** — `src/apps/http/routes.ts:510-523` (`queue.get`):

```ts
decode: ({ query }) => {
  const limit = optionalQueryInt(query, "limit", { min: 1, max: 500 });
  const kind = optionalQueryString(query, "kind");
  const project = optionalQueryString(query, "project");
  if (kind !== undefined && !DECISION_KIND_VALUES.includes(kind as never)) {
    throw new InvalidInputError(
      "kind",
      `must be one of ${DECISION_KIND_VALUES.join(", ")}`,
    );
  }
  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(project !== undefined ? { projectId: project } : {}),
  };
},
```

The enum check mirrors the `status` param at `:410-420`; the
`project` → `projectId` rename mirrors `objective` → `objectiveId` at `:421`.
`project` is an **id**; it is never matched against a name.

3. **View** — `src/apps/http/views/queue.ts:65-85`: `DecisionQueueView.counts`
   gains no new field, but the `counts` doc comment states that the totals are
   global and unaffected by `kind` / `project`. `truncated` keeps its meaning
   relative to the **filtered** set.

## Constraints

- No sort parameter, no cursor, no offset — only `limit`, `kind`, `project`.
- A filtered call must not close any occurrence (asserted in Story 3).
- `?kind=` with an unknown value is `400`, never an empty result.

## Verify

- `node --test src/app/project/get-decision-queue.test.ts`:
  - a fixture of 9 items across two kinds with `{ kind: <one kind>, limit: 2 }`
    → `items` all of that kind, `counts.total === 9`, `counts.byKind` covering
    both kinds, `truncated` computed against the filtered count;
  - **filter before limit** proven with a fixture larger than the limit: 3 items
    of kind A ranked above 2 items of kind B, `{ kind: "B", limit: 2 }` returns
    the 2 B items (a filter applied after limiting would return none);
  - `{ projectId: "p2" }` returns only that project's items with global counts
    intact;
  - `{ kind, projectId }` together intersect;
  - a `projectId` that matches nothing returns `items: []`, `truncated: false`
    and the global `counts`.
- `node --test src/apps/http/routes.provider.test.ts`:
  - `GET /api/queue?kind=task-review&project=p1` forwards
    `{ kind: "task-review", projectId: "p1" }`;
  - `GET /api/queue` still forwards `{}`;
  - `?kind=nope` → `400` `invalid_input` and the use case not called;
  - `?limit` table-driven negatives at `:182-196` still pass.
- `npm run verify` exits 0.
- Proof: phase F (`the other kind matches nothing`, `counts stay global under a
filter`).

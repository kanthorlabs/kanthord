# Story 5 — `GET /api/queue/:id`: open, resolved, expired, 404

Epic: `.agent/plan/epics/026.8-decision-identity-and-inbox.md`
Depends on: Story 2, Story 3 (`DecisionProjection` and `ReconcileDecisions`).

## Change

1. **Use case** `src/app/project/get-decision.ts` — one class, one `execute`,
   beside `get-decision-queue.ts`:

```ts
export interface DecisionSource {
  get(id: string): DecisionOccurrenceRowLike | undefined;
}
export interface GetDecisionOutput {
  id: string;
  kind: string;
  state: "open" | "resolved" | "expired";
  closedReason: "verdict" | "superseded" | "vanished" | null;
  subject: { type: "task" | "objective" | "initiative"; id: string };
  openingEventId: string | null;
  closingEventId: string | null;
  historical: boolean;
  projectId: string;
  projectName: string;
  initiativeId: string;
  initiativeName: string | null;
  objectiveId: string | null;
  objectiveName: string | null;
  taskId: string | null;
  taskTitle: string | null;
}
export class GetDecision {
  constructor(
    private readonly projection: DecisionProjection, // Story 3
    private readonly reconciler: ReconcileDecisions, // Story 3
    private readonly source: DecisionSource,
  ) {}
  async execute(input: { id: string }): Promise<GetDecisionOutput>;
}
```

Pinned rules:

- **`execute` reconciles before reading the row**, in exactly three steps:

```ts
const { items } = await this.#projection.project();
this.#reconciler.run(items.map(toReconcileItem));
const row = this.#source.get(input.id);
```

Without the reconcile the detail endpoint reports `open` forever for a decision
that ended, because the lifecycle is only advanced when the decision set is
recomputed — and Proof phase E retries the task through the CLI and then reads
**only** the detail URL.

- `GetDecision` depends on the same two collaborators as `GetDecisionQueue`, so
  **no use case calls another use case** and no function-shaped stand-in hides
  one. `toReconcileItem` is the shared mapper from Story 3.
- A throw from `project()` or `run()` propagates; the detail must not answer
  `200 open` from stale state after a failed reconcile.
- The reconcile is over the **unfiltered** item set, as everywhere else.

- An id the store does not hold throws `UnknownReferenceError("decision", id)`
  (`src/app/errors.ts:94`), which the registry already maps to `404`
  `unknown_reference` (`src/apps/http/error-registry.ts:48`). No new error
  class, and **no `410` anywhere**.
- Every field comes from the stored row — the names are the snapshot Story 3
  wrote. The use case performs **no join** against projects, initiatives,
  objectives or tasks.
- The snapshot is **"as last observed while the decision was open"**, not "read
  at the instant it closed": a closing reconcile no longer sees the item, so it
  cannot re-read names. The view's doc comment and the UI's
  `decision-historical` text must both say exactly that (epic decision 7 words it
  as "taken when it closed" — see the report's open items).
- `historical = state !== "open"`.
- `DecisionOccurrenceRowLike` is the structural row type declared in
  `reconcile-decisions.ts` (Story 3); import the type from there.

2. **View** `src/apps/http/views/decision.ts`:
   `DecisionView` + `decisionView(result: GetDecisionOutput): DecisionView` — a
   whitelist of exactly the 16 output fields above (same style as
   `views/queue.ts:34-63`, `subject` copied as `{ type, id }`), with the index
   signature the sibling views carry.

3. **Route row** — `src/apps/http/routes.ts`, inserted immediately after
   `queue.get` (`:510-523`):

```ts
defineRoute({
  id: "queue.item.get",
  method: "GET",
  path: "/api/queue/:id",
  successStatus: 200,
  kind: "json",
  cliCommands: [],
  decode: ({ params }) => ({ id: requirePathParam(params, "id") }),
  run: async (deps, input) => deps.getDecision.execute(input),
  present: (result) => decisionView(result),
}),
```

`cliCommands: []` follows the `health.get` precedent (`:267-272`); no CLI leaf is
added in this epic.

4. **Deps + wiring** — add `getDecision` to `HttpDeps` beside `getDecisionQueue`
   and construct, in `src/composition.ts` near `:1025-1056`:

```ts
const getDecision = new GetDecision(decisionProjection, decisionReconciler, {
  get: (id) => decisionOccurrenceRepository.get(id),
});
```

reusing the two collaborators built in Story 3, and exposing `getDecision` on
the deps bundle beside `:1259`. The store is an arrow wrapper, never a bare
method reference.

## Constraints

- Do not add this route to any CLI command table.
- The detail response is not wrapped in anything but the standard
  `{ data: … }` envelope.

## Verify

- `node --test src/app/project/get-decision.test.ts` — `project()` and `run()`
  both happen **before** `source.get` (a fake records the order); a throwing
  `project()` or `run()` propagates and `source.get` is never called; a row the
  reconcile just closed is read in its closed state; then: an open row maps to
  `state: "open"`, `historical: false`, `closedReason: null`; a resolved row maps
  to `state: "resolved"`, `historical: true`, `closedReason: "verdict"` and its
  `closingEventId`; an `expired`/`superseded` row maps through with its
  `closingEventId`, and an `expired`/`vanished` row with `null`; an unknown id
  throws `UnknownReferenceError`; the source is called exactly once.
- `node --test src/apps/http/routes.provider.test.ts` (or a new
  `routes.decision.test.ts` following the same supertest conventions) —
  `GET /api/queue/<id>` is `200` for each of the three states and the body
  carries `state` and the snapshot names; an id whose fake throws
  `UnknownReferenceError` answers `404` with
  `error.code === "unknown_reference"`; `GET /api/queue/%20` is `400`
  `invalid_input` with the use case not called; **no response in the file has
  status `410`**.
- `node --test src/apps/http/error-registry.test.ts` — no entry in
  `TRANSPORT_ERRORS` or `DOMAIN_ERROR_MAPPINGS` carries `status: 410`, and
  `mapError` never returns `410` for any registered error type. This is the
  global form of the Proof's "never 410" claim, which a single response check
  cannot establish.
- `node --test src/apps/http/routes.test.ts` — `ROUTES.length` is `58` (title
  and assertion updated), `queue.item.get` is in the id inventory, and the
  policy test passes for the new row.
- `node --test src/apps/http/cli-coverage.test.ts` passes unchanged (the new row
  claims no leaf, so the uncovered-set count of `26` is unaffected).
- `node --test src/apps/http/views/decision.test.ts` — the presented key set is
  exactly the 16 fields, and an extra field on the input is not leaked.
- `npm run verify` exits 0.
- Proof: phase D (`an open decision reports its state`, `an id the server never
issued is 404`, `a known decision is 200, never 410`) and phase E (`a closed
decision is still 200`, `the closed decision is no longer open`).

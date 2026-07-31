# Story 2 — `diffAvailable` becomes a structural boolean, with no I/O in the domain

Epic: `.agent/plan/epics/026.9-candidate-review.md`
Depends on: Story 1 (`src/domain/candidate-source.ts`).

## Change

### 1. `src/domain/decision-queue.ts`

`QueueEvidenceInput` (`:46-53`) gains one field:

```ts
export interface QueueEvidenceInput {
  homeDir: string | null;
  baseOid: string | null;
  headOid: string | null;
  /**
   * The candidate source pair named for this element, or `null` when the
   * element has none. Structural only — it says a pair EXISTS, never that the
   * patch will render. Readability is answered by
   * `GET /api/(task|objective)/:id/candidate`.
   */
  source: CandidateSourceName | null;
}
```

`CandidateSourceName` is imported from `./candidate-source.ts` — a
`src/domain/` → `src/domain/` import, allowed.

`DecisionEvidence` (`:73-77`) becomes:

```ts
export interface DecisionEvidence {
  basis: "verification-and-summary";
  /** Structural: a candidate source pair is named for this decision's subject. */
  diffAvailable: boolean;
  diffUnavailableReason: "no-candidate" | null;
  inspect: { executable: "git"; args: string[] } | null;
}
```

`buildEvidence` (`:114-122`) becomes:

```ts
function buildEvidence(
  evidence: QueueEvidenceInput | undefined,
): DecisionEvidence {
  const available = evidence?.source != null;
  return {
    basis: "verification-and-summary",
    diffAvailable: available,
    diffUnavailableReason: available ? null : "no-candidate",
    inspect: buildInspect(evidence),
  };
}
```

`buildInspect` (`:101-112`) is unchanged. The three `buildEvidence` call sites
(`:184`, `:215`, `:244`) are unchanged.

### 2. `src/app/project/get-decision-queue.ts`

The task branch (`:284-303`) already holds `result` and already calls
`getCandidateByTask`. Move the candidate lookup **above** the `evidence.set`
call so its outcome feeds the source, and pass the source through
`#rawEvidence`:

```ts
if (t.status === "failed" || t.status === "awaiting_confirmation") {
  actionableIds.add(t.id);
  const result = this.#evidence.getTaskResult(t.id);
  const candidate =
    t.status === "awaiting_confirmation"
      ? this.#candidates.getCandidateByTask(t.id)
      : undefined;
  if (candidate !== undefined) candidateTaskIds.add(t.id);
  evidence.set(
    t.id,
    this.#rawEvidence(
      {
        homeDir,
        baseOid: result?.baseCommit ?? null,
        headOid: result?.commitSha ?? result?.proposalCommit ?? null,
        source:
          candidate !== undefined
            ? "landing-candidate"
            : result?.proposalCommit != null
              ? "escalation"
              : null,
      },
      pendingPresence,
    ),
  );
}
```

The objective branch (`:316-329`) gains
`source: o.commitOid != null ? "objective-candidate" : null`.

The initiative branch sets no evidence today; leave it — `buildEvidence(undefined)`
now yields `diffAvailable: false`, `diffUnavailableReason: "no-candidate"`,
which is correct for a publication decision.

`#rawEvidence` (`:139-155`) must pass `source` straight through untouched; the
presence logic it performs applies to `baseOid`/`headOid` only.

### 3. `src/apps/http/views/queue.ts`

`DecisionItemView.evidence` (`:22-30`) becomes:

```ts
readonly evidence: {
  readonly basis: "verification-and-summary";
  readonly diffAvailable: boolean;
  readonly diffUnavailableReason: "no-candidate" | null;
  readonly inspect: { readonly executable: "git"; readonly args: readonly string[] } | null;
};
```

and `decisionItemView` (`:49-59`) copies `diffUnavailableReason` alongside
`diffAvailable`. No other view field changes.

## Constraints

- `diffAvailable` must **not** be computed from a filesystem or git call. The
  only inputs are the persisted candidate row's existence, `proposalCommit`, and
  `commitOid`.
- `src/domain/decision-queue.ts` keeps importing only from `src/domain/`.
- The literal type `false` disappears from `DecisionEvidence`; do not leave a
  cast that reinstates it.

## Verify

- `node --test src/domain/decision-queue.test.ts` — the existing test at
  `:272-295` is rewritten: an item whose `QueueEvidenceInput.source` is
  `"landing-candidate"` has `diffAvailable === true` and
  `diffUnavailableReason === null`; one with `source: null` has
  `diffAvailable === false` and `diffUnavailableReason === "no-candidate"`; one
  with **no** evidence entry at all is likewise `false` / `"no-candidate"`;
  `basis` is unchanged for all three. The `item()` fixture at `:87` and
  `baseProject()` at `:60-74` are updated for the new field.
- `node --test src/app/project/get-decision-queue.test.ts` — an
  `awaiting_confirmation` task with a persisted candidate produces
  `evidence.diffAvailable === true` and the item's `cause === "candidate"`; the
  same task **without** a candidate but with a `proposalCommit` produces
  `diffAvailable === true` and `cause` absent; without either it is `false` with
  `"no-candidate"`; a `failed` task never calls `getCandidateByTask` (a
  recording fake asserts the call count is `0`); an objective with `commitOid`
  is `true` and one without is `false`.
- `node --test src/apps/http/views/queue.test.ts` — the presented evidence
  carries both fields and no extra key.
- A new `node --test src/domain/decision-queue.io.test.ts` — reads
  `src/domain/decision-queue.ts` and `src/domain/candidate-source.ts` with
  `readFileSync` and asserts neither source text contains `node:fs`,
  `node:child_process`, `execFile`, `readFileSync` or `require(`. This follows
  the source-grep convention of `src/apps/cli/architecture.test.ts:70-78`, and
  is the test epic decision 5 demands.
- `npm run verify` exits 0.
- Proof: none directly — this story keeps the queue honest for Story 8's
  screen. Its regression coverage is 026.8's Proof staying green.

# Worker V2 HANDOFF

This page holds the status of each step of the [build plan](plan.md). Remove this folder before `feature/worker-v2` merges into `main`.

Update a step when its state changes. Record the pull request of each step.

## Phase A: build

- [x] A1. Chain runner (D21 layer 4). Implementer: Fable 5.2. Reviewer: Opus 5.5.
- [ ] A2. Implement ports in the worker (D32 layer 1). Implementer: Opus 5.5. Reviewer: Fable 5.2.
- [ ] A3. Evaluation and examine ports (D32 layer 2). Implementer: Opus 5.5. Reviewer: Fable 5.2.
- [ ] A4. Stops as values (D32 layer 3). Implementer: Fable 5.2. Reviewer: Opus 5.5.
- [ ] A5. Boundary of the Foundry (D32 layer 4). Implementer: Opus 5.5. Reviewer: Fable 5.2.
- [ ] A6. Capabilities and guards (D32 layer 5). Implementer: Fable 5.2. Reviewer: Opus 5.5 and `/security-review`.
- [ ] A7. CLI host and `worker tasks run` (D32 layer 6). Implementer: Opus 5.5. Reviewer: Fable 5.2 and `/security-review`.
- [ ] A8. `worker tasks seed` and `worker tasks compare` (D31). Implementer: Opus 5.5. Reviewer: Fable 5.2 and `/security-review`.
- [ ] A9. Pages `agent.impl.md` and `engine/docs/cli/worker.md`. Writer: Sonnet 5.5. Check: `crucible`.

### A1 deviations

The chain runner of A1 keeps the behavior of today. These points differ from section 2 of the design. A later step removes each one.

- The `implement` chain passes the mutable `StepsState` of today through one resource key `state`. The read-before-write check does not cover the steps that use it. C1 and C2 replace it with value keys.
- Three steps hold more than one catalogue step: `base.refresh` holds the merge, the `Conflict` turn and gate G. `unit.turn` holds the turn and gate G. `release.verify` holds the release trees, the setup, `verify.all`, `affected.run` and the give of the trees. A2 to A5 and C1 split them.
- The steps `state.open`, `budget.check`, `unit.leave` and `unit.runner` have no catalogue entry. `done_record.put` becomes `unit_record.put` in C2.
- `runChain` throws the stop, and `executionBoundary` releases it. The budget-end mapping stays inside each step that has it today. The runner has no `stopMapped`.
- The `examine` chain holds only `workspace.review(base)` in `prepare`, so that each later budget end releases with `further_work: true`, as today.
- The phase spans of `implement` are one-frame loops. The runner opens no `worker.step` span. C5 adds it.
- Accepted change: the dispose stack releases the node workspace after a failed give of the base tree. The stop keeps the code of the first error.

## Phase B: eval set baseline

- [ ] B1. Select 8 to 12 executions. Ulrich selects. Aelita proposes candidates from the traces.
- [ ] B2. Export the seeds.
- [ ] B3. Live record run of each seed.
- [ ] B4. Baseline report.
- [ ] B5. Replay of each seed against its own record.

## Phase C: behavior layers

- [ ] C1. Gate G and restore reduction (D21 layer 1). Replay plus live run.
- [ ] C2. Unit record and trailer removal (D21 layer 2). Replay.
- [ ] C3. `ClaimWatch` and push fence (D21 layer 3). Replay.
- [ ] C4. Parallel groups and fail-early order (D21 layer 5). Replay.
- [ ] C5. Checkpoint merge, telemetry and stop detail (D21 layer 6). Replay.
- [ ] C6. The `Conflict` prompt (D22). Replay plus live run.

## Open items

- [ ] S1, open, before A8. Let the seed export serve an execution of a closed node, so that a past execution becomes an eval seed. A close deletes the unit records of the node, and `setup` holds them. The route answers the latest confirmed heads, not the heads at the claim. Design a closed-node seed with the heads at the claim and a rule for a node with no unit records.
- [ ] G5, open, at A2. Confirm whether the node-failure fallback of `env.setup` takes the base tree inside `tasks`. The main [HANDOFF](../HANDOFF.md) holds the item.
- [ ] Open, outside Worker V2. The case `footprint.measure.run` of `src/apps/server/adapter-conformance.test.ts` fails on the local machine of Ulrich at `engine` `ea454eab`, and passes in CI. The direct adapter answers the alert state `pending` and the HTTP adapter answers `firing`. A local gate of Worker V2 accepts this one failure.
- [ ] G6, open, at A2. Check the asset fields of `EvidenceDraft` against `engine/src/mission/contract.ts`. The main [HANDOFF](../HANDOFF.md) holds the item.

## Pull requests

| Step | Repository | Pull request                                                    | Merge commit |
| ---- | ---------- | --------------------------------------------------------------- | ------------ |
| A1   | `engine`   | [#623](https://github.com/kanthorlabs/kanthord-engine/pull/623) | `03531d79`   |

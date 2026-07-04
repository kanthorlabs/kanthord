# Story 002 - git.push & External Correlation

Epic: `.agent/plan/epics/014-real-broker-minimal-path.md`

## Goal

`git.push` is the first externally-mutating verb: it records branch+sha as the
durable external correlation, pushes idempotently (re-pushing the same state
resolves instead of erroring), and reconciles by querying the remote ref.

## Acceptance Criteria

- `git.push` has a registry entry (`tier: auto`, `idempotency: required`);
  submitting without an idempotency key is rejected (Epic 005 rule on the real
  verb).
- A successful push records `{ remote_url, branch, sha }` as the op's external
  correlation in the durable ledger (PRD §5 — external correlation in synced
  markdown; debate finding — remote identity is part of the correlation, so a
  reused branch name on a different remote can never satisfy reconcile), and the
  remote ref equals the sha. Force-push is not offered by the verb (fast-forward
  only in 2A; a non-fast-forward is `failed`).
- The push **diff content** (branch vs its remote base) passes the Epic 013
  scanner before submit; a seeded secret **in a committed file** blocks the push
  (debate finding — scan the repository bytes leaving the machine, not only the
  request metadata).
- Re-submitting the same push (same key, same branch+sha, remote already there)
  resolves `done` without error — idempotent by observed effect.
- A push rejected by the remote (non-fast-forward against a moved ref) resolves
  `failed` with a typed error naming the branch.
- **Reconcile by correlation:** an interrupted push whose remote ref already
  equals the desired sha resolves `done`; a missing remote ref resolves
  `resubmit`; a remote ref at a **different** sha escalates (desired-effect hash
  mismatch — Epic 005 gate rule applied to the real remote).
- The submit also passes through the shared Epic 013 choke point (a seeded
  secret in the push payload metadata is blocked) — the request-level check,
  distinct from the diff-content check above.

## Constraints

- Remote = local bare repo path in all tests (hermetic); the verb makes no
  distinction — the remote URL comes from the repo-slot config.
- Correlation and desired-effect hash live in the Epic 005 ledger entry shape —
  no new ledger fields beyond what Epic 005 defined (branch+sha fill the existing
  correlation + desired-effect slots).

## Verification Gate

- `npm test` green for `src/broker/verbs/git-push.test.ts`.

### Task T1 - Push adapter + idempotent re-push

**Input:** `src/broker/verbs/git-push.ts`, `broker/verbs/git.push.yaml`,
`src/broker/verbs/git-push.test.ts`

**Action - RED:** Write tests: (a) push lands the branch at the sha on the bare
remote and records `{branch, sha}` correlation in the ledger; (b) re-submit with
the same key resolves `done`, remote unchanged; (c) non-fast-forward resolves
`failed` naming the branch; (d) missing idempotency key is rejected.

**Action - GREEN:** Implement the push adapter + registry entry over the SU1 git
seam.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Reconcile against the remote ref + scan inheritance

**Input:** `src/broker/verbs/git-push.ts`, `src/broker/verbs/git-push.test.ts`

**Action - RED:** Write tests for the three reconcile branches (ref at desired
sha ⇒ done; ref absent ⇒ resubmit; ref at other sha ⇒ escalate — all keyed by
the full `{remote_url, branch, sha}` correlation, and a same-branch ref on a
*different* remote does not reconcile), plus: a seeded secret in the payload
metadata is blocked, and a seeded secret in a committed file's diff blocks the
push before submit.

**Action - GREEN:** Implement the reconcile path querying the remote ref via the
git seam, and the pre-submit diff-content scan through the Epic 013 scanner
seam.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

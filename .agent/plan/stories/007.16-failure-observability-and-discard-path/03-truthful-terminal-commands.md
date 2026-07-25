# Story 3 — Truthful approve / publish outcomes

Epic: `.agent/plan/epics/007.16-failure-observability-and-discard-path.md`

Five independent acceptance criteria. Implement all five; each has its own test.
A–C cover `approve` / `publish`; D–E cover `import graph --apply` and were folded in
from `.agent/findings/007.17-midway-insertion-findings.md` (`F1`, `F2`) because
they are the same defect class: a command that reports an outcome it did not
achieve, or lets a raw error escape.

## Change

### A — `approve objective` on a terminal objective is a conflict

`src/app/objective/approve-objective.ts:49-51` currently reads:

```ts
if (objective.status === "integrated") {
  return;
}
```

Delete those three lines. The existing status guard immediately below
(`:53`, `if (objective.status !== "awaiting_confirmation")`) then throws the
already-defined `ObjectiveNotAwaitingConfirmationError`, which reports the current
status. No new error type.

### B — `publish repository` on an unknown ref throws a typed error

`src/app/repository/publish-repository.ts:81` awaits `this.#resolveTargetOID(homeDir, branch)`.
Wrap it so the injected implementation's raw `execSync` failure becomes a typed
error instead of escaping to the process:

```ts
let localOID: string;
try {
  localOID = await this.#resolveTargetOID(homeDir, branch);
} catch {
  throw new UnknownReferenceError("branch", branch);
}
```

`UnknownReferenceError` is already imported at `publish-repository.ts:10`. Confirm
`src/apps/cli/error-map.ts` maps it to a single-line `unknown branch: <ref>`
message at a non-zero exit code; if the existing mapping renders a different
noun, keep the mapping generic and do not special-case it.

### C — re-publishing an already-published OID reports `already published`

`src/app/repository/publish-repository.ts:28-31` — add a fourth variant to
`PublishOutcome`:

```ts
| { kind: "already_published"; repositoryId: string; remoteOID: string }
```

At `:96-113`, `isRealTransition` is already computed correctly. Return the new
kind when it is `false`:

```ts
return isRealTransition
  ? { kind: "published", repositoryId, remoteOID: result.remoteOID }
  : { kind: "already_published", repositoryId, remoteOID: result.remoteOID };
```

Keep the `setPublication` call unconditional and the `feed.append` still guarded by
`isRealTransition` — the event behavior is already correct and must not change.

In the CLI publish handler (`src/apps/cli/repo.ts`, the `runPublishRepository`
function — locate it by `grep -n "repository published" src/apps/cli/repo.ts`),
branch on the outcome kind: print `already published @<remoteOID>` for
`already_published` and keep `repository published: <id> -> <oid>` for
`published`. **Exit code stays 0 for both** (epic decision record: publish is a
sync, so a no-op is a success).

### D — `import graph --apply` must not report success when it wrote nothing

`src/app/graph/apply-graph.ts:390` already computes the blocking conflict set
(`drifted | locked`) and correctly performs no CAS write when it is non-empty. The
defect is entirely in the reporting: the CLI prints `created:` per node, prints
`1 created, …`, and exits **0**.

In the CLI apply handler (`src/apps/cli/import-graph.ts`, `runApply`, ~`:172`):

- When the result's conflict set is non-empty, print
  `refused: <N> drifted node(s)` (and `<M> locked node(s)` when non-zero) as the
  **first** stderr line, and exit **non-zero**.
- In that case the per-node classification list must **not** use the word
  `created` / `updated` for nodes that were not written. Prefix the planned lines
  with `would create:` / `would update:` so no line claims a write that did not
  happen.
- Include every classification in the summary counter, including `drifted` and
  `locked` — today the summary reports only `created / updated / unchanged /
missing`, so the classes that decided the outcome appear in no counter.
- `--dry-run` keeps exit code 0 (it is a plan, not a refusal) but uses the same
  `would create:` wording.

### E — resolve graph refs on the `--apply` path

A new node whose `dependencies:` names an **existing** task by its package `ref`
currently throws before any write:

```
UnknownDependencyError: Task health-task depends on unknown task create-task
    at validateGraph (src/domain/graph.ts:57:15)
    at ApplyGraph.execute (src/app/graph/apply-graph.ts:386:5)
```

`create-task` is in the same package and in the DB; refs resolve on the `--create`
path but not here. At `apply-graph.ts:386`, resolve every dependency entry through
the same ref→id map already used for the create path **before** calling
`validateGraph`, so a ref and a ULID are interchangeable. If a dependency resolves
to neither a package ref nor an existing DB id, surface it through the CLI error
formatter as a single line — never a raw stack trace.

## Constraints

- Do not make re-publish an error, and do not make re-approval a success — the
  asymmetry is deliberate and human-confirmed.
- Do **not** change the drift/locked _classification_ logic in this story — only the
  reporting and the ref resolution. Reclassifying lifecycle-progressed nodes as
  `unchanged` is a separate, larger design change (findings `F1` root cause) and is
  explicitly **not** in 007.16.
- Do not change when `repository.published` is appended (Story 4 owns that event).
- `publish repository` must never force-push; leave the `PublishDivergedError`
  branch at `:114-120` untouched.

## Verify

- `node --test src/app/objective/approve-objective.test.ts` — add a test that
  approving an objective already in `integrated` throws
  `ObjectiveNotAwaitingConfirmationError` with `status === "integrated"`, and that
  the broker was **not** called and **no** event was appended.
- `node --test src/app/repository/publish-repository.test.ts` — add two tests:
  (1) a `resolveTargetOID` fake that throws yields `UnknownReferenceError` and the
  publisher is never called; (2) publishing twice with an unchanged remote OID
  returns `kind: "already_published"` on the second call and the fake feed holds
  exactly **one** `repository.published` event.
- `node --test src/apps/cli/repo.test.ts` — add a test asserting the
  `already_published` outcome renders a stdout line equal to
  `already published @deadbeef` with `exitCode === 0`.
- `node --test src/apps/cli/import-graph.test.ts` — add three tests: (a) an apply
  whose result carries a non-empty conflict set exits **non-zero**, its first
  stderr line matches `/^refused: \d+ drifted node\(s\)/`, and **no** stdout line
  starts with `created:`; (b) that same case's summary line includes a `drifted`
  count; (c) `--dry-run` with the same conflicts exits **0** and uses
  `would create:`.
- `node --test src/app/graph/apply-graph.test.ts` — add a test that a new node
  declaring `dependencies: ["<existing-ref>"]` applies successfully (no
  `UnknownDependencyError`), and that an unresolvable dependency throws a typed
  error the CLI formatter renders as one line.
- `npm run verify` exits 0.
- Proof: delivers Proof lines 5, 6 (first block) and 7 (second block). D and E add
  two lines to the first Proof block:
  ```sh
  # 6b) apply refuses visibly instead of reporting a phantom write (F1):
  ! node src/main.ts import graph "$GRAPH_DRIFTED" --apply --initiative $INIT >/dev/null 2>&1
  node src/main.ts import graph "$GRAPH_DRIFTED" --apply --initiative $INIT 2>&1 \
    | grep -qE '^refused: [0-9]+ drifted node\(s\)'
  # 6c) a new node may depend on an existing one by ref (F2):
  node src/main.ts import graph "$GRAPH_REFDEP" --apply --initiative $INIT --dry-run 2>&1 \
    | grep -vq 'UnknownDependencyError'
  ```

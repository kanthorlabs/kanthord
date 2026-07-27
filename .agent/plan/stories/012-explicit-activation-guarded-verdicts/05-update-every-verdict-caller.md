# Story 5 — Update every existing objective-verdict caller

Epic: `.agent/plan/epics/012-explicit-activation-guarded-verdicts.md`
Depends on: Story 3 (`commitOid` on the read view), Story 4 (the required flag).
Land in the same commit as Story 4 — between the two the tree does not run.

Every caller reads `commitOid` from the real read surface and echoes it back. No
caller may hard-code a commit id or bypass the guard.

## Change

### The shared reader (copy verbatim into each script that needs it)

The standalone `*-proof.sh` scripts do **not** source `scripts/e2e/e2e-common.sh`
and each define their own helpers, so add these two lines near the top of each
script listed below, beside its existing helpers. The `jv` body is byte-identical
to `scripts/e2e/activation-verdict-proof.sh:18`:

```sh
jv() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])))})' "$1"; }
obj_oid() { node src/main.ts get objective --id "$1" --json | jv 'v.commitOid'; }
```

Do **not** add `jv` to `scripts/e2e/e2e-common.sh` (`drive-run.sh` parses with
`jq`, not `jv`).

### `scripts/e2e/landing-proof.sh`

- Add `jv` + `obj_oid` beside the existing inline `node -e` helpers.
- `:71` — replace

  ```sh
  node src/main.ts approve objective --id "$OBJ" >/dev/null
  ```

  with

  ```sh
  OBJ_OID=$(obj_oid "$OBJ"); test -n "$OBJ_OID"
  node src/main.ts approve objective --id "$OBJ" --expected-commit "$OBJ_OID" >/dev/null
  ```

- `:58` is a prose comment — unchanged.

### `scripts/e2e/publish-idempotency-proof.sh`

- Add `jv` + `obj_oid`.
- `:117` — same replacement as above for its single `approve objective` call.

### `scripts/e2e/sequencing-proof.sh`

- Add `jv` + `obj_oid` beside `read_manifest` (`:105`) and `status_of` (`:110`).
- `:154` (`$AOBJ`), `:229` (`$O1`), `:235` (`$O1B`) — each becomes

  ```sh
  OID=$(obj_oid "<VAR>"); test -n "$OID"
  node src/main.ts approve objective --id "<VAR>" --expected-commit "$OID" >/dev/null
  ```

  Read the oid immediately before each approve — an earlier land can re-squash a
  later objective, so a value captured once is not reusable.

### `scripts/e2e/discard-proof.sh`

- Add `jv` + `obj_oid` beside `read_manifest` (`:63`) / `status_of` (`:75`).
- `:96` — the help assertion must cover the new flag:

  ```sh
  node src/main.ts reject objective --help | grep -q -- '--resolution'
  node src/main.ts reject objective --help | grep -q -- '--expected-commit'
  ```

- `:98-102` — `$OBJ` is already `discarded` here, so it has no live candidate.
  Pass the placeholder and tighten the assertion so the terminal-objective claim
  keeps being tested rather than passing on a missing-flag error:

  ```sh
  APPROVE_OUT=$(node src/main.ts approve objective --id "$OBJ" \
          --expected-commit 0000000000000000000000000000000000000000 2>&1 || true)
  printf '%s' "$APPROVE_OUT" | grep -qv 'objective integrated'
  printf '%s' "$APPROVE_OUT" | grep -q 'is not awaiting confirmation'
  ```

  This relies on Story 4's pinned order (status guard before stale guard).

### `scripts/e2e/drive-run.sh`

- `:60` — the snapshot query gains the column:

  ```js
  const objectives = db
    .prepare(
      "SELECT id,name,status,commitOid FROM objectives WHERE initiativeId = ? ORDER BY id",
    )
    .all(init);
  ```

- `:160-169` — the approve loop reads id + oid as a TSV pair, records a finding
  instead of approving when the oid is missing, and never calls approve with an
  empty guard:

  ```sh
  while IFS=$'\t' read -r obj oid; do
    [ -n "$obj" ] || continue
    if [ -z "$oid" ]; then
      e2e_finding P3 objective-missing-commitoid major \
        "objective $obj is awaiting_confirmation with no commitOid" round="$ROUND" objectiveId="$obj"
      continue
    fi
    log "approve objective $obj (automated orchestration of a human-gated command)"
    if e2e_kanthord approve objective --id "$obj" --expected-commit "$oid" >>"$LOG" 2>&1; then
      APPROVED=$((APPROVED + 1))
    else
      e2e_finding P3 approve-objective-failed major \
        "approve objective refused for $obj" round="$ROUND" objectiveId="$obj"
    fi
  done < <(jq -r '.objectives[] | select(.status=="awaiting_confirmation") | [.id, (.commitOid // "")] | @tsv' "$SNAP")
  ```

  Keep the surrounding `APPROVED` accounting and log wording as-is.

## Constraints

- **Do not modify `scripts/e2e/activation-verdict-proof.sh`** — it is the epic's
  Proof and already correct.
- Do not add `--paused` to any existing script: Story 2's flag defaults to
  `false`, so `setup-graph.sh:77`, `landing-proof.sh:43`,
  `publish-idempotency-proof.sh:109`, `sequencing-proof.sh:101`,
  `discard-proof.sh:60`, `abandon-run-proof.sh:51`,
  `client-discovery-proof.sh:58,74`, `sha-classification-proof.sh:59` and
  `uncreatable-objective-proof.sh:58` keep behaving exactly as today.
- Prose/log-only mentions stay untouched: `landing-proof.sh:58`,
  `make-initiative-graph.sh:25`, `make-todo-service-graph.sh:59`,
  `setup-graph.sh:114`, `drive-run.sh:162,166-167`.
- `docs/git-workflow.md` mentions `approve objective` at `:24,31,64,79,95,144,213,256`
  only inside tables, prose and mermaid diagrams — there is no copy-pasteable
  command line there. Do not edit it.
- Historical `Proof:` blocks in earlier epics and story files (e.g.
  `.agent/plan/epics/007.12-initiative-branch-workflow.md:73,80`,
  `.agent/plan/epics/007.13-repository-publication.md:54,56`) are records of past
  runs; leave them.
- No `src/` change belongs to this story — Story 4 owns all of `src/`.

## Verify

- `bash -n` exits 0 for each edited script: `landing-proof.sh`,
  `publish-idempotency-proof.sh`, `sequencing-proof.sh`, `discard-proof.sh`,
  `drive-run.sh`.
- The jq filter is valid and yields the pair:

  ```bash
  echo '{"objectives":[{"id":"o1","status":"awaiting_confirmation","commitOid":"abc"},{"id":"o2","status":"building"}]}' \
    | jq -r '.objectives[] | select(.status=="awaiting_confirmation") | [.id, (.commitOid // "")] | @tsv'
  ```

  prints exactly `o1\tabc`.

- Each of these exits 0 and prints its own ok line:
  `scripts/e2e/landing-proof.sh`, `scripts/e2e/publish-idempotency-proof.sh`,
  `scripts/e2e/sequencing-proof.sh`, `scripts/e2e/discard-proof.sh`.
- `scripts/e2e/activation-verdict-proof.sh` prints `012 ok: …` and the file is
  unchanged (`git diff --stat` lists no change for it).
- No caller bypasses the guard:

  ```bash
  grep -rn 'approve objective\|reject objective' scripts/ | grep -v 'expected-commit'
  ```

  returns only the prose/log lines listed under Constraints (and the `--help`
  assertions in `discard-proof.sh`).

- `npm run verify` exits 0.
- Proof: `D ok: …` in `scripts/e2e/activation-verdict-proof.sh`, plus keeping the
  ok lines of `landing-proof.sh`, `publish-idempotency-proof.sh`,
  `sequencing-proof.sh` and `discard-proof.sh` green.

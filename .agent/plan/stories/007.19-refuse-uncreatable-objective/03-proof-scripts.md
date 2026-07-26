# Story 3 — The Proof scripts (verification only — no edits)

Epic: `.agent/plan/epics/007.19-refuse-uncreatable-objective.md`
Depends on: Stories 1 and 2 (the Proof only passes once both have landed).

## Change

**None. This story writes no code and edits no file.**

Both scripts already exist on disk and are committed (`4687022`), authored by the
human maintainer as part of authoring the epic, per the AGENTS.md rule that a
Verification Gate must ship as a committed bash script whose expected failure was
demonstrated before implementation:

- `scripts/e2e/make-orphan-objective-graph.sh` — mode 755, the graph generator.
- `scripts/e2e/uncreatable-objective-proof.sh` — mode 755, the gate itself.

`scripts/**` is lane-forbidden to both the test-engineer and the software-engineer
(`scripts/lane-check.sh:12`). "Lane-forbidden" means **may not modify**; every role
may always **run** any script, including a `Proof:` command. So this story is
executed by running the scripts, not by editing them.

## Constraints

- **Do not edit either script.** If the Proof appears to need a change, that is a
  maintainer escalation: raise an `OPEN:` blocker naming the exact line and the
  reason. Do not work around it, and do not weaken an assertion to make it pass.
- **Do not add `.agent/`-external fixtures.** The Proof owns `.data/proof-00719`
  and clears it on every run, so a rerun is deterministic.
- The Proof is hermetic: no model, no network, no repository, no daemon run. It
  takes no arguments.

## Verify

Run both, in this order:

1. **Generator, default mode** — writes exactly three files and prints nothing:

   ```sh
   rm -rf /tmp/oo-check && scripts/e2e/make-orphan-objective-graph.sh /tmp/oo-check
   ls /tmp/oo-check   # initiative.md  objective.md  task-base.md
   ```

2. **Generator, additive mode** — adds exactly `objective-orphan.md` and
   `task-orphan.md`, leaving the other three byte-identical:

   ```sh
   scripts/e2e/make-orphan-objective-graph.sh /tmp/oo-check --add-orphan
   ls /tmp/oo-check   # + objective-orphan.md  task-orphan.md
   ```

3. **The gate** — exits 0 and prints the success string:

   ```sh
   scripts/e2e/uncreatable-objective-proof.sh
   ```

   Must print `007.19 PROOF OK` and exit 0. Its four cases are:
   - case 1 — `--dry-run` exits non-zero and its output contains `orphan-obj`
   - case 2 — `--apply` exits non-zero, `orphan-task` never lands, and the
     baseline task's title is unchanged
   - case 3 — the output contains `orphan-obj` and does **not** contain
     `InvalidObjectiveIdError`, `FOREIGN KEY constraint failed`, or
     `at ApplyGraph.execute`
   - case 4 — after removing the orphan files, a retitle still applies

4. **Rerun determinism** — run the gate a second time in the same tree; it must
   also exit 0. Before Stories 1-2 it fails at line 65 (`test "$DRY_STATUS" -ne 0`),
   which is the recorded pre-implementation failure.

`npm run verify` exits 0.

Proof: delivers the whole gate — `007.19 PROOF OK`.

# Story S5 — The program proof

Epic: `.agent/plan/epics/018-update-ai-provider.md`
Depends on: Stories S1–S4 (all of them)

## Change

- `scripts/e2e/update-ai-provider-proof.sh` **already exists** and is the epic's
  binding contract. Do **not** rewrite it to match the implementation; make the
  implementation satisfy it. The only edits permitted to it are ones this story
  names below.
- Verified starting state on the tree before S1–S4: phase A passes, phase B
  fails at the first `update ai-provider` call with
  `error: unknown command 'ai-provider'`.
- The script carries its own recording mock, written to its temp dir at
  `scripts/e2e/update-ai-provider-proof.sh:47-86` — it mirrors
  `scripts/e2e/mock-openai-completions.mjs` and additionally appends
  `"<model> <authorization>"` per request to `MOCK_RECORD`.
  **`scripts/e2e/mock-openai-completions.mjs` must not be modified** — phase A
  runs on pre-story code, and the 008.1 Story D proof depends on that file as it
  is.
- Permitted edits, and only for a reason the story names:
  - the exact success-line text asserted nowhere in the script (the script never
    greps the success line, so S4's wording is free);
  - `--allow-insecure` placement, if S3 rejects the flag on a `127.0.0.1` base
    URL for a reason the story did not foresee — in that case fix the
    implementation first and change the script only if the CLI contract genuinely
    differs.
  - If any other assertion cannot be met, that is a defect in S1–S4 or a
    planning defect. Raise it as an `OPEN:` blocker; never weaken the proof.

## Constraints

- Deterministic and hermetic: no outbound network (both mocks bind
  `127.0.0.1:0`), no model, no daemon, no writes outside `mktemp -d` and the
  temp `KANTHORD_DB`.
- Both mocks are killed by the `EXIT` trap
  (`update-ai-provider-proof.sh:23-30`); the script must leave no listening
  socket behind.
- The proof reads provider rows through its own `node:sqlite` readers
  (`prov()`, `count()`, `fingerprint()`), never through the command under test.

## Verify

- `scripts/e2e/update-ai-provider-proof.sh` exits 0 and prints, in order:
  `A ok: …`, `B ok: …`, `C ok: …`, `D ok: …`, `E ok: …`, `F ok: …`, `G ok: …`,
  then `018 ok: …`.
- Planner correction applied 2026-07-29: the `logged_out` refusal moved out of
  phase E into its own phase G, after F. The project chain lists ACTIVE
  providers only, so logging the sole provider out before F emptied the chain
  for a reason unrelated to this epic.
- Run it twice in a row from a clean tree — both runs pass (it builds its own
  database each time, so a second run must not depend on the first).
- `npm run verify` exits 0.
- Proof: this story delivers the whole `Proof:` block of the epic.

# Story S6 — Proof green, CLI-coverage inventory

Epic: `.agent/plan/epics/024-ai-provider-writes.md`
Depends on: Stories S1-S5. Every row exists and every `HttpDeps` field is
populated before this story starts.

Lands **no row**. `ROUTES.length` stays 72. This story turns the already-written
Proof from red to green and records the claimed leaves.

## Change

**1. `src/apps/http/cli-coverage.test.ts`** — add the 024 block, in the style of
the existing EPIC 020 block at `65-93`:

```
test("the 8 CLI leaves claimed by EPIC 024 all appear across ROUTES' cliCommands", …)
```

with exactly these eight, and no others:

```
register ai-provider
update ai-provider
assign ai-provider
unassign ai-provider
set-default ai-provider
logout ai-provider
remove ai-provider
test ai-provider
```

**2. `scripts/e2e/http-provider-writes-proof.sh`** — make it print `024 ok: …`.
The script is already committed with the epic and already fails for the right
reason. **Do not re-author it.** If a phase asserts something the epic did not
decide, raise an `OPEN:` blocker instead of editing the assertion.

## Constraints

- **`leaves.length === 80` stays true** (`cli-coverage.test.ts:48-51`). 024 adds
  no CLI leaf. If that assertion breaks, a story added a Commander command it
  should not have.
- **The "uncovered set is non-empty" assertion stays and is NOT edited**
  (`cli-coverage.test.ts:53-63`). After 024 the uncovered set still holds the
  EPIC 025 leaves (`run daemon`, `setup project`, `login provider`, `db migrate`,
  `db status`) and `land repository` / `publish repository`, which are unassigned
  since the old "Target 027 — delivery" was cut (2026-07-30), plus `serve` and
  `commands` which are never retired. **No planned epic flips it** — the
  retirement plan is on hold until Ulrich revisits it after the UI and
  integration, so this assertion stays true indefinitely.
- **Claim exactly eight leaves.** `get ai-provider` and `list ai-provider` were
  already claimed by EPIC 020 (`cli-coverage.test.ts:65-93`); do not re-add them,
  and do not claim a ninth for the probe row — its `cliCommands` is `[]` by
  design.
- **`test ai-provider` is claimed in FULL.** `…/completion` carries the caller's
  prompt and returns the model's reply, so there is no narrowing to record. Do
  not add a "partial coverage" comment.
- **No story edits `retirement.md` or anything under `.agent/plan/**`** —
  lane-forbidden to every role (`scripts/lane-check.sh:13-19`). Marking Target 024
  covered is a HUMAN follow-up after this story lands.
- Do not touch `composition.ts` — S1 made the epic's only edit there.
- Do not relax any Proof assertion to get green. In particular: the no-secret
  assertions in phases C, G and J, the `200`-not-`500` probe assertion in phase H,
  and the `412` replay in phase G are the epic's load-bearing claims.

## Verify

- `node --test src/apps/http/cli-coverage.test.ts` — the new 024 block passes;
  `leaves.length` is still 80; the uncovered set is still non-empty. Optionally
  inspect it with `KANTHORD_CLI_COVERAGE_REPORT=1 node --test
src/apps/http/cli-coverage.test.ts` and confirm the remaining entries are only
  the 026/027 leaves plus `serve` and `commands`.
- `node --test src/apps/http/routes.test.ts` — row count 72; all nine 024 ids
  present; `PUT_ROWS` holds exactly two entries.
- `npm run verify` exits 0.
- **`scripts/e2e/http-provider-writes-proof.sh` prints `024 ok: …` and exits 0.**
  Every phase must pass, notably:
  - **B** — `configured: false` with `ai_provider: missing` on a project that has
    a repository, a building initiative, an objective and one incomplete task;
  - **D** — `configured: true` through the global default alone, with the
    default-suffix present in the `ai_provider` detail;
  - **E** — the suffix GONE once assigned, and `rank: 0` putting the second
    provider at the head of `GET /api/project/:id/ai-provider`;
  - **F** — the identical `PUT /api/ai-provider/default` twice, both `204`, with
    exactly one provider `isDefault`;
  - **G** — `428` / `412` / `200`-with-fresh-`ETag`, then the replay `412`;
  - **H** — probe `ok`, completion returning `DATETIME-OK`, then after the mock
    dies probe `200/failed` and completion `502`;
  - **J** — neither secret, nor the `API_KEY`, nor the model marker in any log
    line, and `SIGTERM` closing the port.
- Confirm the run leaves nothing behind: no `serve` process, no mock process, and
  the temp directory removed by the `EXIT` trap.

## Human follow-up (NOT part of this story)

Already done at authoring time (2026-07-30), so do NOT redo it:
`retirement.md`'s Target 024 already carries the `Authored as …` line, the note
that the Proof is written and RED, the record that `test ai-provider` is covered
in FULL, and the record that `check project --probe-repositories` /
`--probe-provider` stay operator CLI flags and are never exposed over HTTP.

Left for a human AFTER this story turns the Proof green:

- `.agent/plan/stories/019-http-server/retirement.md` — add the
  **`Implemented: …, proved by …`** line to Target 024, in the exact form Target
  020 uses (`retirement.md:42-43`). That line means BUILT, so it must not be
  written before `scripts/e2e/http-provider-writes-proof.sh` prints `024 ok: …`.
- Consider whether `POST /api/ai-provider/:id/probe` should be surfaced to the
  readiness screen as EPIC 025's first provider call.

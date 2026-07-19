# Story 13 — End-to-end smoke: consolidate the epic Proof

Epic: `.agent/plan/epics/007.1-e2e-hardening.md`

## Goal

Wire every 007.1 fix together into ONE runnable Proof — the epic's
`## Verification Gate` block, made copy-paste-runnable against the real program.
This story invents no new production surface; it consolidates stories 1–12 into a
single script and adds the small deterministic fixtures the script references.
"Done" for the epic = `npm run verify` green AND this Proof shown working.

## Locked contracts (the Proof is the contract)

- **Part A is deterministic** — pure CLI + real git in temp dirs, NO model. It
  proves: D4 (`--value` removed, `--value-file`/`-`/timeout), D6 (value never in
  serialization), D3 (unknown model rejected at create + update), D1 (`update
ai-provider --model`), D2 (`--remote-url` rejects embedded userinfo; `--auth`
  union), C1 (`import graph --bind` → runnable task; unbound alias fails before
  the txn), C2/D5 (`repo land` lands to home `main`; re-land is idempotent), and
  the A `diagnostics export` canary (no sensitive strings in the shareable
  artifact).
- **Part B is a guarded live-provider smoke** (`KANTHORD_LIVE=1`) — runs the one
  imported task to completion and asserts the observability surfaces on a real
  completion: A1 stdout lifecycle log lines, A2 `get task --result`, A7
  `base_commit` recorded.
- The exact command block is the epic's `## Verification Gate` → `Proof:`. This
  story keeps the two files verbatim-in-sync; a drift is a bug.

## Constraints

- `set -euo pipefail`; every step asserts (no bare `echo` masking a failure);
  expected failures use `if ! …; then` so a non-zero exit does not pass silently.
- Concrete values only — `export`ed env vars, captured ids, real `test`/`grep`
  assertions — never prose comments standing in for a check (AGENTS.md binding
  rule: a proof that needs interpretation is not a proof).
- Part A must run in CI-like isolation: `KANTHORD_DB` under `mktemp -d`, all
  repos/workspaces under `mktemp -d`, no network, no reliance on `~/.data`.

## Verification Gate

- `npm run verify` green (typecheck + test + verify:handoff + lint + db status).
- The Part A Proof block runs to `Part A OK` on a clean checkout with no env set.
- Part B runs to `PROOF OK (A + B)` when `KANTHORD_LIVE=1` and a provider
  credential is configured.

### Task T1 — deterministic Part A runbook + fixtures

**Requires:** stories 1–12 landed (`update`, `get resource`, `diagnostics
export`, `import graph --bind`, `repo land`, D2 repo shape, D3/D4 CLI changes).

**Input:** the epic Proof block (`.agent/plan/epics/007.1-e2e-hardening.md`,
`Proof:` Part A); a new `test/e2e/007.1-hardening.sh` (or the repo's existing
e2e-smoke location — confirm at expansion by grepping `e2e-smoke` under
`src/apps/cli/`); any fixture files the script writes inline (it currently
writes the graph package + secret files with heredocs — keep them inline so the
script is self-contained).

**Action — RED:** add the Part A script as an executable smoke that the verify
pipeline (or a dedicated `npm run proof:007.1`) invokes; it fails today because
the D1–D6/C1/C2/A commands it calls do not yet exist.

**Action — GREEN:** with stories 1–12 landed, the script runs green to `Part A
OK`. Fix any drift between the script and the real CLI flag/output shapes
(assert on the actual `--json` field names the use cases emit).

**Action — REFACTOR:** factor repeated `jf`/id-capture helpers into the script
head (mirror EPIC 008.2's `jf()` idiom) so the assertions stay readable.

**Output:** a self-contained, hermetic Part A smoke proving D+C+A wiring with no
model.

**Verify:** the script exits 0 with `Part A OK`; `npm run verify` green.

### Task T2 — guarded Part B live smoke

**Requires:** T1; a configured provider credential (via story 2 `--value-file`).

**Input:** the epic Proof block Part B; the same script, gated behind
`[ -z "${KANTHORD_LIVE:-}" ] && exit 0`.

**Action — RED:** add the Part B section asserting A1 (`daemon run` stdout has
claim/verify/complete lines), A2 (`get task --result` shows summary + commit),
A7 (`base_commit` non-null in `get task --json`). It is skipped without
`KANTHORD_LIVE`, so the hermetic suite stays green.

**Action — GREEN:** with `KANTHORD_LIVE=1` and a real bound provider, the one
imported task completes and all three observability assertions pass to
`PROOF OK (A + B)`.

**Action — REFACTOR:** none.

**Output:** the full epic Proof, deterministic by default and live-verifiable on
demand.

**Verify:** default run prints `Part B skipped … PROOF OK (A)`; `KANTHORD_LIVE=1`
run prints `PROOF OK (A + B)`.

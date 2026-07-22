# EPIC 007.10 — CLI observability & recovery ergonomics — stories

Epic: `.agent/plan/epics/007.10-cli-observability-recovery.md`
Findings + debate: `.agent/plan/epics/007.10-e2e-findings.md` (run `e2e-0710`),
debate hardening folded into the epic ("Debate deltas").

Four stories that let an operator drive the full build → candidate → approve →
retry → land loop **from the CLI alone**, without the `e2e-status.sh` helper,
raw SQL, or a deliberately-doomed `approve`:

- **A — Landing-candidate visibility in `get task` (F1).** `get task` gains a
  nullable `landingCandidate` projection `{ state, baseSHA, candidateSHA,
target }`, in **both** human and `--json` output. Read-only join on
  `landing_candidates`; no landing fields on the `Task` domain entity. Delivers
  **Proof A**.
- **B — Explicit rebuild of a stale candidate (F2).** `retry task --rebuild`
  requeues a task in `awaiting_confirmation` whose candidate is `pending`.
  Plain `retry` stays rejected for a non-conflict awaiting candidate. Delivers
  **Proof B**.
- **C — Uniform `--json` for `list event` (F4).** `list event --json` becomes a
  single `{ events: [...], nextCursor: "..." }` envelope (was JSONL + trailing
  sentinel). All 007.7 consumers/tests/docs migrate in this story. Delivers
  **Proof C**.
- **D — Nested `--help` + `login provider` output (F5, F6).** Nested `<group>
<sub> --help` prints the subcommand's help across every group; `login
provider` adds a `credential created: <id>` line on stderr (bare id stays on
  stdout). Delivers **Proof D / D2**.

Dependency order: **A, B, C, D are independent** (disjoint files: `get task`
read path vs `retry-task` vs `list event` vs CLI command-group wiring). Land in
any order. The epic's `npm run verify` gate needs all four; each Proof section
(A/B/C/D) goes green after its own story.

Note (surfaced during exploration, informs Story B): the `saveConflictSnapshot`
optional on `ConflictCandidateStore` (`retry-task.ts:111`) is a no-op today —
`SqliteLandingRepository` never implemented it (only the test double does).
Story B must not depend on it; `--rebuild` resets the candidate to `pending`
and reuses the existing note/rebuild-prompt path, exactly as the conflict retry
does.

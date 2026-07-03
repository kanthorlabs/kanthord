# Story 001 - Draft-OK Semantics

Epic: `.agent/plan/epics/038-plan-tooling-and-tuning.md`

## Goal

A `draft_ok` consumer trades rework risk for parallelism with deterministic
mechanics: start against the draft, finalize silently on an identical final
artifact, re-open with evidence on a changed one — while `frozen` stays
exactly as it was.

## Acceptance Criteria

- Draft eligibility is an **explicit durable act**, not an artifact file's
  existence (debate finding — a checkpoint or partial write must not admit a
  consumer): the publisher's workflow publishes a draft via a
  `draft_published` record (artifact id, hash, publisher task id, at) —
  only then does a `draft_ok` consumer become dispatchable ahead of the
  publisher's exit gate; the consumption is journaled with the draft hash
  and a `draft` marker (PRD §7.3).
- The consumer **pins the draft hash at dispatch** (debate finding — the
  draft race needs a deterministic model): later `draft_published` records
  do not touch the running consumer; the one comparison that matters is
  final-vs-pinned at publisher exit.
- A `frozen` consumer in the same fixture stays blocked until the publisher's
  exit gate passes (default unchanged, asserted side by side).
- Publisher exit with a final artifact hash **equal** to the pinned draft:
  the consumer's consumption finalizes (marker cleared, journaled), no
  re-open, no escalation.
- Publisher exit with a **different** final hash: the consumer re-opens
  through the Epic 033 rework path with an escalation carrying both hashes
  **and the consumer's already-emitted external operations from the ledger**
  (debate finding — a completed consumer may have produced PRs/issues; the
  human contains those effects, and the evidence must list them — cross-repo
  rollback stays human, PRD §7.4); a consumer that already completed against
  the stale draft also re-opens (`rework`), and if its completion was
  merge-gated, the gate stays blocked.
- The draft consumption works with the Epic 028 artifact gate mechanics: the
  entry gate hash-checks against the **pinned** draft hash + marker — no
  bypass of the gate.
- Edge semantics come from the compiled plan (`semantics: draft_ok` per PRD
  §7.1.1 §5 frontmatter) — no runtime opt-in.

## Constraints

- Re-open rides the Epic 033 machinery; the finalize/re-open decision hooks
  the publisher's exit-gate transition (Epics 006/028) — no polling loop and
  no second rework mechanism (Epic 038 anchor).
- Compiler already emits edge semantics (Epic 002); this story consumes them
  — any compiler change is out of scope.

## Verification Gate

- `npm test` green for `src/workflow/draft-ok.test.ts`; `npm run typecheck`
  exits 0.

### Task T1 - Draft dispatch + finalize/re-open

**Input:** `src/workflow/draft-ok.ts`, `src/workflow/artifact-gates.ts`,
`src/workflow/draft-ok.test.ts`

**Action - RED:** Write tests: (a) no dispatch on a merely-written artifact
file; dispatch on the `draft_published` record with pinned hash + marker
journaled; `frozen` sibling stays blocked; (b) equal final hash ⇒ silent
finalize; (c) different final hash ⇒ re-open with both-hash + emitted-ops
escalation for an in-flight consumer **and** for an already-completed
consumer (merge gate stays blocked); (d) a second `draft_published` mid-run
does not disturb the consumer; final-vs-pinned decides.

**Action - GREEN:** Implement the `draft_published` record, pinned-hash gate
acceptance, and the exit-gate-driven finalize/re-open decision.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

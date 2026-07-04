# Story 005 - Artifact Handoff Gates (runtime)

Epic: `.agent/plan/epics/006-workflow-and-agent-session.md`

## Goal

The runtime half of artifact coordination: a publisher task records its artifact
(with a content hash) and its exit gate "artifact published" passes; a consumer
task's entry gate "artifact consumed" passes only when that artifact is published and
its hash matches the expected value — recorded to the gate-result sink so the
scheduler dispatches the handoff on fakes. (Epic 002 compiles the gate as data; this
Story evaluates it at runtime.)

## Acceptance Criteria

- When a publisher task completes, its artifact is recorded in the artifact registry
  (Epic 002 table) with a **content hash**, and its **exit** gate "artifact published"
  is written passed to the gate-result sink (Epic 006 Story 001) (PRD §7.2 — publisher
  exit gate: artifact published).
- A consumer task's **entry** gate "artifact consumed" passes **only** when the
  referenced artifact is published **and** its recorded hash matches the expected hash;
  otherwise the entry gate does not pass and the consumer is not dispatched (PRD §7.2 —
  consumer entry gate: artifact consumed (hash X)).
- The gate outcomes flow to the same gate-result sink the scheduler (Epic 004) reads,
  so the handoff drives DAG dispatch — the publisher must reach "published" before the
  consumer entry gate can pass (PRD §7.3).
- `frozen` vs `draft_ok` edge semantics (compiled by Epic 002) are honored: a `frozen`
  consumer waits for the published artifact; a `draft_ok` consumer may proceed against
  a draft (the Phase-1 fake models both paths) (PRD §7.1.1 §5, §7.3).
- Hash comparison is **byte-hash identity only** — no semantic/normalized diff (that is
  the Phase-2B contract-handler work; PRD §7.2).

## Constraints

- This Story **evaluates** the artifact gates compiled by Epic 002 (registry +
  consumption entry gate as data); it does not re-define the gate schema (Epic 002
  owns the data; Epic 006 owns the runtime outcome).
- Gate outcomes are recorded via the Epic 006 Story 001 gate-result sink; the scheduler
  reads that sink (Epic 004) — no separate wake path (PRD §7.3).
- Artifacts are fakes stored in the feature dir via the Epic 003 store; hashing reuses
  the Epic 001/002 hashing (byte identity). No network, no real generated output.
- Semantic contract handlers (proto/OpenAPI diff) are **out** — Phase 2B (PRD §7.2;
  Epic 006 Non-Goals extend accordingly).

## Verification Gate

- `npm test` green for `src/workflow/artifact-gates.test.ts`.

### Task T1 - Publisher exit gate: artifact published (+ hash)

**Input:** `src/workflow/artifact-gates.ts`, `src/workflow/artifact-gates.test.ts`

**Action - RED:** Write a test that on publisher-task completion the artifact is
recorded in the registry with a content hash and the "artifact published" exit gate is
written passed to the gate-result sink.

**Action - GREEN:** Implement `publishArtifact(task, artifact)` recording the artifact
+ hash and writing the publisher exit gate to the sink.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Consumer entry gate: consumed only on hash match (frozen/draft_ok)

**Input:** `src/workflow/artifact-gates.ts`, `src/workflow/artifact-gates.test.ts`

**Action - RED:** Write tests: (a) a `frozen` consumer's "artifact consumed" entry gate
does not pass until the artifact is published and its hash matches; a mismatched hash
keeps it un-passed; (b) a `draft_ok` consumer may pass against a draft artifact. Assert
the scheduler dispatches the consumer only after the entry gate passes.

**Action - GREEN:** Implement the consumer entry-gate evaluation (published + hash
match, honoring `frozen`/`draft_ok`) writing the outcome to the sink.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

# EPIC 007.4 — landing robustness — story index

Epic: `.agent/plan/epics/007.4-landing-robustness.md`

Three coupled defects from the post-007.3 TODO-API E2E. Order matters: S1 makes
landing reachable at all on a default install; S2 makes the conflict path
persist an event without a CHECK crash; S3 turns every landing outcome into a
typed result the CLI can format. S2 and S3 together close the non-fast-forward
crash.

- **01 — S1: absolute workspace paths + landing validation (F1 / BUG-1, CRITICAL)**
- **02 — S2: add `task.conflict` to events schema + drift guard (F2 / BUG-5, CRITICAL)**
- **03 — S3: discriminated approve outcomes (F3 / BUG-2, MAJOR)**

Deferred (own epic): BUG-3 (events CLI), BUG-4 (`list task --json` dependencies),
sibling-file conflict coordination, deep phase-aware landing recovery.

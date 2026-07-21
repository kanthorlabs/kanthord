# EPIC 007.5 — conflict recovery ergonomics — stories

Epic: `.agent/plan/epics/007.5-conflict-recovery.md`
Findings + debate: folded into the epic (Appendix A/B).

Two stories, both serving finding N1 (make conflict recovery discoverable and
intuitive). N2 (sibling integration) is deferred to `007.6-guided-conflict-resolution.md`.

- **01 — Honest, actionable conflict message.** The `approve` conflict line names
  the real recovery command (`retry task --id <id>`) and the conflicting files.
- **02 — `retry task` recovers a conflicted candidate.** `retry` accepts a task
  whose latest landing candidate is durably `state="conflict"`, re-queues it, and
  does not emit `task.rejected`.

Dependency order: S1 and S2 are independent at the code level but S2 is the
behavioral core; S1's message references the `retry task` command S2 enables, so
land S2's transition first if sequencing.

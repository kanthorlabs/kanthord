# EPIC 007.7 — dependency & event-feed observability — stories

Epic: `.agent/plan/epics/007.7-dependency-event-observability.md`
Findings + debate: folded into the epic (`007.6-...md` Appendix B, post-007.5 E2E).

Two independent stories, both making the CLI's "pull progress" trustworthy:

- **01 — Declared `dependencies` in `list task --json`.** The list read model
  exposes each task's static declared edges (from the entity) beside the runtime
  `waiting` set, so a client reconstructs the DAG from one call (BUG-4).
- **02 — Truncation signal for `list event`.** A capped non-follow page now
  advertises a resumable next cursor (ndjson sentinel line + human hint) instead
  of silently looking complete (N5).

Dependency order: S1 and S2 are fully independent (different files, different
read models). Land in either order.

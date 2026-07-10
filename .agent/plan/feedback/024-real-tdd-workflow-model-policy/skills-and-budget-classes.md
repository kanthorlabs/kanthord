# Feedback — 024 design inputs: skills-style guidance + per-task-class budgets

Recorded 2026-07-10 during the agentic-system dimension review (Ulrich +
debate engine). Owning epic: 024 (fold into authoring/debate).

## Input 1 — adopt pi's skills pattern for workflow guidance

pi-coding-agent injects only a skills *index* (name/description/path from
SKILL.md frontmatter) into the system prompt; the agent lazy-loads a skill
body with the `read` tool when the task matches. Progressive disclosure —
near-zero token cost until used.

kanthord has the eager version: RUNBOOK injected verbatim into every spawn,
bounded only by the §6.3.4 curation routine. Fold into 024: keep a small
always-injected RUNBOOK; move per-topic guidance (per-workflow recipes for
`tdd@1`, per-repo gotchas, broker-verb usage) into skill files with an index
block in the prompt assembly. ~50 lines, no new subsystem (pi-agent-core has
no skills support — kanthord replicates the pattern itself).

Constraints: ring-1 read-allow for the skills directory; skills are a
prompt-injection surface — covered by sign-off like plan files.

## Input 2 — budget ceilings per task class

Live shape is one global `taskBudget?: { ceiling, conservativeCost }`
(`run-loop.ts`). Architecture §6.3.3 says "raise its default ceiling in
config" per task class — impossible today. Without per-class ceilings the
budget-override routine becomes daily toil. Config table keyed by task
class/workflow, global value as fallback. (Durable accounting itself is a
019.2 item — see `019.2/live-path-enforcement-gaps.md` Gap 4.)

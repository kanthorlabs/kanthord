# Authoring Rules

How to author milestone work for the TDD pipeline. These rules are shared across
all milestones. Do not copy them into a milestone folder.

## Canonical Plan Layout

All implementation work must use the Epic / Story / Task structure consumed by
the TDD agents:

```text
.agent/plan/epics/<NNN>-<epic-slug>.md
.agent/plan/stories/<NNN>-<epic-slug>/<NNN>-<story-slug>.md
.agent/plan/feedback/<NNN>-<epic-slug>/...
```

Milestone folders may keep design sources and decision records, but they must not
be the executable implementation plan. The TDD loop reads `.agent/plan/epics/`
and `.agent/plan/stories/`.

## Units Of Work

- Epic: one reviewable outcome with a verification gate.
- Story: one coherent behavior slice inside an Epic, with acceptance criteria.
- Task: one RED -> GREEN -> REFACTOR loop inside a Story.

Do not author standalone numbered task briefs as the implementation unit. A task
is valid only inside a Story file under a `### Task <id>` heading.

## Epic Template

```md
# <NNN> <Epic Name>

## Outcome
<one paragraph describing the shipped capability>

## Decision Anchors
- <D/B/S/N or plan section references>

## Stories
- `<story-file>` - <one-line behavior slice>

## Verification Gate
- <commands and observable checks that close the Epic>

## Dependencies
- <prior epics, milestone setup, or findings files>

## Non-Goals
- <explicitly deferred work>

## Findings Out
- <path or `none`>
```

## Story Template

```md
# Story <NNN> - <Story Name>

Epic: `.agent/plan/epics/<NNN>-<epic-slug>.md`

## Goal
<one behavior slice>

## Acceptance Criteria
- <observable behavior and contract values>

## Constraints
- <mandated mechanism with decision citation>

## Verification Gate
- <story-level checks>

### Task <id> - <task name>

**Input:** <exact files or directories the role may touch>

**Action - RED:** <test-engineer work, or `none - GREEN-only` with reason>

**Action - GREEN:** <software-engineer behavior target, not implementation internals>

**Action - REFACTOR:** <named cleanup, or `none`>

**Verify:** <exact command or proof>
```

## ACs Vs Constraints

Acceptance Criteria describe observable behavior and external contract values,
not internal mechanism. Mandated mechanism goes in Constraints, citing the
decision that mandates it.

- AC examples (observable behavior / fixed contract values): a client request
  gets the expected response; a published port number; a required field is
  present on a record; a documented state transition runs end to end.
- Constraint examples (mandated mechanism, each citing the decision that mandates
  it): a specific write/locking scheme; a required dependency used directly and
  not wrapped; the component that owns the wire contract. Always cite the
  decision code.

A value fixed by the user or a decision is an AC. Dropping concrete values makes
the Story hard to test and review.

## Task Rules

1. Every Task must have `Input`, `Action - RED`, `Action - GREEN`, `Action -
   REFACTOR`, and `Verify` fields.
2. RED describes the failing test behavior, not the production implementation.
3. GREEN describes the behavior target and public seam the test needs.
4. REFACTOR is named and limited. Use `none` when no cleanup is required.
5. GREEN-only Tasks are allowed only when the Story explains where coverage is
   owned. The test-engineer pass-through must forward them.
6. Task `Input` is authoritative. If a task must edit config, docs, or generated
   files, name them explicitly so lane checks can allow it.
7. Do not edit locked Epic or Story files during implementation. Plan changes are
   a separate authoring task.

## Spike Gate

Require a spike only when a task hits one of these:

- unknown external API behavior;
- OS or container boundary behavior;
- a pinned dependency's real surface;
- unclear filesystem or atomicity semantics.

A spike de-risks the design. It does not close production work. The production
Story still needs an executable verification gate.

## Findings Contract

Write a findings file before authoring dependent work only when the task discovers
behavior a later task needs. No discovery means no findings file.

Findings files must link back to the decisions they affect. They are not a
parallel decision store.

## Review Requirements

- Every Epic has a clear Verification Gate.
- Every Story AC maps to a Task RED test, GREEN-only proof, or harness check.
- Every hard mechanism cites a decision or plan section.
- No build task is done without a passing executable check.
- If the same assertion fails two or more times for different root causes, stop
  and question the test or AC premise.

## Out Of Scope

Commit-message style and repo-wide git policy are not authoring rules.

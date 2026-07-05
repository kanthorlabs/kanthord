/**
 * Lint + projection scenarios — Story 003 T1 (Epic 010).
 *
 * Five isolated invalid-fixture scenarios, each driving the real Epics 001–009
 * lint/compile public seams to produce its expected planner-vocabulary error.
 */

import { compile } from "../compiler/compile.ts";
import { openStore } from "../foundations/sqlite-store.ts";
import { rebuildFromMarkdown, diffProjection } from "../store/rebuild.ts";
import type { Divergence } from "../store/rebuild.ts";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Shared fixture constants
// ---------------------------------------------------------------------------

const COMPILE_OPTS = { repoRegistry: ["backend"] };

const EPIC_MD = `---
id: feat-lint-test
repo: backend
ticket_system: jira
ticket: JIRA-L-001
---

## Acceptance

Feature complete.
`;

const RUNBOOK_MD = "# Runbook\n\nRunbook content.\n";
const INDEX_MD = "# Story index\n";

// ---------------------------------------------------------------------------
// Fixture builder helpers
// ---------------------------------------------------------------------------

type StorySpec = {
  name: string;
  tasks: Array<{ name: string; content: string }>;
};

async function buildFixture(stories: StorySpec[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "klint-"));
  await writeFile(join(dir, "epic.md"), EPIC_MD, "utf8");
  await writeFile(join(dir, "RUNBOOK.md"), RUNBOOK_MD, "utf8");
  for (const story of stories) {
    const storyDir = join(dir, story.name);
    await mkdir(storyDir, { recursive: true });
    await writeFile(join(storyDir, "INDEX.md"), INDEX_MD, "utf8");
    for (const task of story.tasks) {
      await writeFile(join(storyDir, task.name), task.content, "utf8");
    }
  }
  return dir;
}

async function runCompileScenario(
  stories: StorySpec[],
): Promise<{ errorMessage: string }> {
  const dir = await buildFixture(stories);
  const store = openStore(":memory:", { busyTimeout: 1000 });
  try {
    await compile(dir, store, COMPILE_OPTS);
    return { errorMessage: "" };
  } catch (e) {
    return { errorMessage: e instanceof Error ? e.message : String(e) };
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Minimal valid task template helpers
// ---------------------------------------------------------------------------

function validTask(id: string, ticket: string, extra = ""): string {
  return (
    `---\nid: ${id}\nworkflow: tdd@1\nrepo: backend\nticket_system: jira\n` +
    `ticket: ${ticket}${extra}\n---\n\n` +
    `## Prerequisites\n\nsetup\n\n## Inputs\n\nnothing\n\n` +
    `## Outputs\n\ntask output\n\n## Tests\n\nunit tests\n`
  );
}

// ---------------------------------------------------------------------------
// Scenario: cycle — mutual depends_on creates a cycle in the emitted graph.
// relintCompiledGraph detects it → "Cycle detected in emitted graph:".
// ---------------------------------------------------------------------------

const TASK_CYCLE_A = `---
id: task-cycle-a
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-CA
outputs:
  - out-a
depends_on:
  - task: task-cycle-b
    output: out-b
    semantics: frozen
---

## Prerequisites

setup a

## Inputs

needs out-b from task-cycle-b

## Outputs

out-a

## Tests

tests for a
`;

const TASK_CYCLE_B = `---
id: task-cycle-b
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-CB
outputs:
  - out-b
depends_on:
  - task: task-cycle-a
    output: out-a
    semantics: frozen
---

## Prerequisites

setup b

## Inputs

needs out-a from task-cycle-a

## Outputs

out-b

## Tests

tests for b
`;

export async function runCycleScenario(): Promise<{ errorMessage: string }> {
  return runCompileScenario([
    {
      name: "001-story-cycle",
      tasks: [
        { name: "001-task-cycle-a.md", content: TASK_CYCLE_A },
        { name: "002-task-cycle-b.md", content: TASK_CYCLE_B },
      ],
    },
  ]);
}

// ---------------------------------------------------------------------------
// Scenario: forward handoff — compile() with a real markdown fixture where a
// story-group-01 task depends_on a story-group-03 task (producer follows
// consumer).  assertNoForwardHandoffs fires before relintCompiledGraph so the
// error carries the planner-vocabulary text instead of "Cycle detected in
// emitted graph:".
// ---------------------------------------------------------------------------

const TASK_FH_EARLY = `---
id: task-fh-early
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-FHE
depends_on:
  - task: task-fh-late
    output: fh-late-out
    semantics: frozen
---

## Prerequisites

setup early

## Inputs

fh-late-out from task-fh-late.

## Outputs

nothing

## Tests

early tests.
`;

const TASK_FH_LATE = `---
id: task-fh-late
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-FHL
outputs:
  - fh-late-out
---

## Prerequisites

setup late

## Inputs

Nothing.

## Outputs

fh-late-out

## Tests

late tests.
`;

export async function runForwardHandoffScenario(): Promise<{ errorMessage: string }> {
  // story-group-01 task depends on story-group-03 task → forward handoff.
  return runCompileScenario([
    {
      name: "001-story-fh-early",
      tasks: [{ name: "001-task-fh-early.md", content: TASK_FH_EARLY }],
    },
    {
      name: "003-story-fh-late",
      tasks: [{ name: "001-task-fh-late.md", content: TASK_FH_LATE }],
    },
  ]);
}

// ---------------------------------------------------------------------------
// Scenario: overlapping lanes — two parallel stories with shared write_scope.
// shapeLint → "both write … — they cannot share a group".
// ---------------------------------------------------------------------------

const TASK_LANE1 = validTask("task-lane1", "JIRA-L1", "\nwrite_scope:\n  - lib/shared/");
const TASK_LANE2 = validTask("task-lane2", "JIRA-L2", "\nwrite_scope:\n  - lib/shared/utils/");

export async function runOverlappingLanesScenario(): Promise<{ errorMessage: string }> {
  return runCompileScenario([
    {
      name: "001.1-story-lane1",
      tasks: [{ name: "001-task-lane1.md", content: TASK_LANE1 }],
    },
    {
      name: "001.2-story-lane2",
      tasks: [{ name: "001-task-lane2.md", content: TASK_LANE2 }],
    },
  ]);
}

// ---------------------------------------------------------------------------
// Scenario: missing ticket — task omits ticket: field.
// coreLint → "is missing a required ticket reference".
// ---------------------------------------------------------------------------

const TASK_NO_TICKET = `---
id: task-no-ticket
workflow: tdd@1
repo: backend
ticket_system: jira
---

## Prerequisites

setup

## Inputs

nothing

## Outputs

task output

## Tests

unit tests
`;

export async function runMissingTicketScenario(): Promise<{ errorMessage: string }> {
  return runCompileScenario([
    {
      name: "001-story-a",
      tasks: [{ name: "001-task-no-ticket.md", content: TASK_NO_TICKET }],
    },
  ]);
}

// ---------------------------------------------------------------------------
// Scenario: missing body section — task omits ## Tests.
// shapeLint → "is missing a non-empty ## Tests section".
// ---------------------------------------------------------------------------

const TASK_NO_TESTS = `---
id: task-no-tests
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-NT
---

## Prerequisites

setup

## Inputs

nothing

## Outputs

task output
`;

export async function runMissingBodySectionScenario(): Promise<{ errorMessage: string }> {
  return runCompileScenario([
    {
      name: "001-story-a",
      tasks: [{ name: "001-task-no-tests.md", content: TASK_NO_TESTS }],
    },
  ]);
}

// ---------------------------------------------------------------------------
// Scenario: rebuild-from-markdown projection equality (Epic 003 contract).
// compile() populates a live store; rebuildFromMarkdown populates a shadow
// store from the same markdown files; diffProjection must return [].
// Mutating a runtime-only field (plan_generation.generation) in the live
// store must still yield [] — projectionOf strips runtime-only fields.
// ---------------------------------------------------------------------------

export async function runRebuildProjectionScenario(): Promise<{
  divergences: Divergence[];
  divergencesAfterMutation: Divergence[];
}> {
  const dir = await buildFixture([
    {
      name: "001-story-proj",
      tasks: [{ name: "001-task-proj.md", content: validTask("task-proj", "JIRA-P001") }],
    },
  ]);
  const liveStore = openStore(":memory:", { busyTimeout: 1000 });
  try {
    await compile(dir, liveStore, COMPILE_OPTS);
    const shadow = await rebuildFromMarkdown(dir, COMPILE_OPTS);
    try {
      const divergences = diffProjection(liveStore, shadow);
      // Mutate a runtime-only field in the live store — generation is runtime-only
      // and excluded by projectionOf, so divergencesAfterMutation must still be [].
      liveStore.run("UPDATE plan_generation SET generation = 99");
      const divergencesAfterMutation = diffProjection(liveStore, shadow);
      return { divergences, divergencesAfterMutation };
    } finally {
      shadow.close();
    }
  } finally {
    liveStore.close();
    await rm(dir, { recursive: true, force: true });
  }
}

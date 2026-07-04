export type ShapeTaskNode = {
  id: string;
  workflow: string;
  sections: Record<string, string>;
  write_scope?: string[];
  artifacts_out?: Array<{ id: string; kind: string }>;
};

export type ShapeStoryNode = {
  id: string;
  major?: number;
  lane?: number;
  tasks: ShapeTaskNode[];
};

export type ShapeEpicNode = {
  id: string;
  sections: Record<string, string>;
};

export type ShapeNodeTree = {
  epic: ShapeEpicNode;
  stories: ShapeStoryNode[];
  consumed_artifact_ids?: string[];
  edges?: Array<{ from: string; to: string }>;
};

export type ShapeDiagnostic = {
  kind: "error" | "warning";
  message: string;
};

export type ShapeLintResult = {
  diagnostics: ShapeDiagnostic[];
};

const REQUIRED_TASK_SECTIONS = ["Prerequisites", "Inputs", "Outputs", "Tests"] as const;
const REQUIRED_WORKFLOW = "tdd@1";

function laneLabel(major: number, lane: number): string {
  return `${String(major).padStart(3, "0")}.${lane}`;
}

function pathsOverlap(a: string, b: string): string | null {
  if (b.startsWith(a)) return a;
  if (a.startsWith(b)) return b;
  return null;
}

export function shapeLint(tree: ShapeNodeTree): ShapeLintResult {
  const diagnostics: ShapeDiagnostic[] = [];

  // Epic Acceptance section check
  const acceptanceValue = tree.epic.sections["Acceptance"];
  if (acceptanceValue === undefined || acceptanceValue.trim() === "") {
    diagnostics.push({
      kind: "error",
      message: `epic "${tree.epic.id}" is missing a non-empty ## Acceptance section`,
    });
  }

  // Minimum structure: feature must have at least one story
  if (tree.stories.length === 0) {
    diagnostics.push({
      kind: "error",
      message: `epic "${tree.epic.id}" must have at least one story — no stories found`,
    });
  }

  // Minimum structure: story with no tasks
  for (const story of tree.stories) {
    if (story.tasks.length === 0) {
      diagnostics.push({
        kind: "error",
        message: `story "${story.id}" has no tasks`,
      });
    }
  }

  // Lane disjointness: group stories by major, check parallel-lane pairs
  const groupMap = new Map<number, ShapeStoryNode[]>();
  for (const story of tree.stories) {
    const m = story.major;
    if (m === undefined) continue;
    const existing = groupMap.get(m);
    if (existing !== undefined) {
      existing.push(story);
    } else {
      groupMap.set(m, [story]);
    }
  }
  for (const group of groupMap.values()) {
    const parallelStories = group.filter((s) => s.lane !== undefined);
    if (parallelStories.length < 2) continue;
    for (let i = 0; i < parallelStories.length; i++) {
      for (let j = i + 1; j < parallelStories.length; j++) {
        const storyI = parallelStories[i];
        const storyJ = parallelStories[j];
        if (storyI === undefined || storyJ === undefined) continue;
        const laneI = storyI.lane;
        const laneJ = storyJ.lane;
        if (laneI === undefined || laneJ === undefined) continue;
        const labelI = laneLabel(storyI.major ?? 0, laneI);
        const labelJ = laneLabel(storyJ.major ?? 0, laneJ);
        for (const taskI of storyI.tasks) {
          for (const taskJ of storyJ.tasks) {
            for (const pathI of taskI.write_scope ?? []) {
              for (const pathJ of taskJ.write_scope ?? []) {
                const overlap = pathsOverlap(pathI, pathJ);
                if (overlap !== null) {
                  diagnostics.push({
                    kind: "error",
                    message: `lane "${labelI}" and lane "${labelJ}" both write "${overlap}" — they cannot share a group`,
                  });
                }
              }
            }
          }
        }
      }
    }

    // B7: cross-lane dependency via edges field
    const taskIdToLabel = new Map<string, string>();
    for (const ps of parallelStories) {
      const psLane = ps.lane;
      if (psLane === undefined) continue;
      const psLabel = laneLabel(ps.major ?? 0, psLane);
      for (const task of ps.tasks) {
        taskIdToLabel.set(task.id, psLabel);
      }
    }
    for (const edge of tree.edges ?? []) {
      const fromLabel = taskIdToLabel.get(edge.from);
      const toLabel = taskIdToLabel.get(edge.to);
      if (fromLabel !== undefined && toLabel !== undefined && fromLabel !== toLabel) {
        diagnostics.push({
          kind: "error",
          message: `task "${edge.from}" in lane "${fromLabel}" has a dependency path to task "${edge.to}" in lane "${toLabel}" — parallel lanes must not connect within the same major group`,
        });
      }
    }
  }

  // Per-task checks
  for (const story of tree.stories) {
    for (const task of story.tasks) {
      // Required body sections: present and non-empty
      for (const section of REQUIRED_TASK_SECTIONS) {
        const value = task.sections[section];
        if (value === undefined || value.trim() === "") {
          diagnostics.push({
            kind: "error",
            message: `task "${task.id}" is missing a non-empty ## ${section} section`,
          });
        }
      }

      // Workflow pin check
      if (task.workflow !== REQUIRED_WORKFLOW) {
        diagnostics.push({
          kind: "error",
          message: `task "${task.id}" has workflow "${task.workflow}" — only tdd@1 is permitted`,
        });
      }
    }
  }

  // Orphan artifact warning
  const consumedIds = new Set(tree.consumed_artifact_ids ?? []);
  for (const story of tree.stories) {
    for (const task of story.tasks) {
      for (const artifact of task.artifacts_out ?? []) {
        if (!consumedIds.has(artifact.id) && artifact.kind !== "pr" && artifact.kind !== "deploy") {
          diagnostics.push({
            kind: "warning",
            message: `artifact "${artifact.id}" is declared but never consumed`,
          });
        }
      }
    }
  }

  return { diagnostics };
}

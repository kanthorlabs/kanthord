export class CrossCheckError extends Error {
  readonly name: string;

  constructor(message: string) {
    super(message);
    this.name = "CrossCheckError";
  }
}

export type DependsOn = {
  task: string;
  output: string;
  semantics: string;
};

export type CheckNode = {
  id: string;
  file: string;
  outputs: string[];
  bodySectionIds?: string[];
  depends_on: DependsOn[];
};

export type CrossCheckContext = {
  storyDirs: Array<{ name: string; hasIndex: boolean }>;
  hasRunbook: boolean;
};

const DEFAULT_CONTEXT: CrossCheckContext = {
  storyDirs: [],
  hasRunbook: true,
};

/**
 * Cross-check a flat list of plan nodes for feature-wide consistency:
 *
 * Structural-doc checks (from context):
 * - Every story dir has an INDEX.md (names the dir on violation).
 * - The feature has a RUNBOOK.md (names "RUNBOOK.md" on violation).
 *
 * Node-level checks:
 * - All ids are unique (names both files + the duplicated id on violation).
 * - Frontmatter outputs have a matching body section id (bidirectional;
 *   only applies when `bodySectionIds` is explicitly provided).
 * - Every `depends_on.task` resolves to a known node id (names consumer file +
 *   missing task id on violation).
 * - The resolved task declares the referenced output (names consumer file +
 *   missing output on violation).
 * - `depends_on.semantics` is `"frozen"` or `"draft_ok"` (names consumer file +
 *   bad value on violation).
 *
 * Throws `CrossCheckError` with planner-vocabulary messages (file names, ids,
 * output names — never graph-node internals).
 */
export function crossCheck(
  nodes: CheckNode[],
  context?: CrossCheckContext
): void {
  const ctx = context ?? DEFAULT_CONTEXT;

  // Structural-doc checks.
  for (const dir of ctx.storyDirs) {
    if (!dir.hasIndex) {
      throw new CrossCheckError(
        `Story dir "${dir.name}" is missing its INDEX.md`
      );
    }
  }
  if (!ctx.hasRunbook) {
    throw new CrossCheckError(
      `Feature is missing required "RUNBOOK.md"`
    );
  }

  // Build id → node index, checking for duplicates.
  const index = new Map<string, CheckNode>();
  for (const node of nodes) {
    const existing = index.get(node.id);
    if (existing !== undefined) {
      throw new CrossCheckError(
        `Duplicate id "${node.id}" declared in both "${existing.file}" and "${node.file}"`
      );
    }
    index.set(node.id, node);
  }

  // Per-node checks.
  for (const node of nodes) {
    // Body/frontmatter bidirectional check — only when bodySectionIds is
    // explicitly provided (undefined means the field was omitted by the caller,
    // which is valid for nodes that pre-date this check).
    if (node.bodySectionIds !== undefined) {
      const sections = node.bodySectionIds;

      // Every output must have a matching body section.
      for (const outputId of node.outputs) {
        if (!sections.includes(outputId)) {
          throw new CrossCheckError(
            `"${node.file}" declares output "${outputId}" in frontmatter but no matching body section was found`
          );
        }
      }

      // Every body section must be declared as an output in frontmatter.
      for (const sectionId of sections) {
        if (!node.outputs.includes(sectionId)) {
          throw new CrossCheckError(
            `"${node.file}" has body section "${sectionId}" that is not declared as a frontmatter output`
          );
        }
      }
    }

    // Validate each depends_on entry.
    for (const dep of node.depends_on) {
      const producer = index.get(dep.task);
      if (producer === undefined) {
        throw new CrossCheckError(
          `"${node.file}" depends_on task "${dep.task}" which does not exist`
        );
      }
      if (!producer.outputs.includes(dep.output)) {
        throw new CrossCheckError(
          `"${node.file}" depends_on output "${dep.output}" which is not declared by "${producer.file}"`
        );
      }
      if (dep.semantics !== "frozen" && dep.semantics !== "draft_ok") {
        throw new CrossCheckError(
          `"${node.file}" depends_on has invalid semantics "${dep.semantics}" (must be "frozen" or "draft_ok")`
        );
      }
    }
  }
}

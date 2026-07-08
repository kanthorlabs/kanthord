export class CoreLintError extends Error {
  readonly name: string;

  constructor(message: string) {
    super(message);
    this.name = "CoreLintError";
  }
}

export type LintNode = {
  id: string;
  major: number;
  kind: "story" | "task";
  repo: string;
  ticket: string | undefined;
};

export type EdgeInputNode = {
  id: string;
  major: number;
  lane: number | undefined;
  kind: "story" | "task";
  depends_on: Array<{ task: string; output: string; semantics: "frozen" | "draft_ok" }>;
};

export type Edge = {
  from: string;
  to: string;
  kind: "grammar" | "handoff";
  semantics: "frozen" | "draft_ok" | null;
};

/**
 * Build grammar edges for a set of nodes grouped by major.
 *
 * For each major group N, every node in the previous existing major group
 * (skipping gaps) receives a grammar edge to every node in group N.  Nodes
 * within the same major (lane siblings) share no grammar edge between them.
 *
 * Exported so compile.ts can reuse the same algorithm without duplication.
 */
export function buildGrammarEdges(
  nodes: ReadonlyArray<{ id: string; major: number }>,
): Array<{ from: string; to: string }> {
  const result: Array<{ from: string; to: string }> = [];

  // Group by major.
  const groupMap = new Map<number, string[]>();
  for (const node of nodes) {
    const group = groupMap.get(node.major) ?? [];
    group.push(node.id);
    groupMap.set(node.major, group);
  }

  // Sort majors ascending.
  const sortedMajors = [...groupMap.keys()].sort((a, b) => a - b);

  // For each major (from index 1 onward), emit grammar edges from the
  // immediately preceding major group (gap-skipping is automatic since we
  // only track existing majors).
  for (let i = 1; i < sortedMajors.length; i++) {
    const currentMajor = sortedMajors[i];
    const prevMajor = sortedMajors[i - 1];
    if (currentMajor === undefined || prevMajor === undefined) continue;

    const currentGroup = groupMap.get(currentMajor);
    const prevGroup = groupMap.get(prevMajor);
    if (currentGroup === undefined || prevGroup === undefined) continue;

    for (const fromId of prevGroup) {
      for (const toId of currentGroup) {
        result.push({ from: fromId, to: toId });
      }
    }
  }

  return result;
}

/**
 * Build all edges for a feature's node set:
 *
 * - Grammar edges: for each kind ("story", "task") independently, each major
 *   group depends on every node in the previous existing major group.
 * - Explicit handoff edges: one per `depends_on` entry, carrying the declared
 *   semantics.
 */
export function buildEdges(nodes: EdgeInputNode[]): Edge[] {
  const edges: Edge[] = [];

  // Grammar edges — processed per kind so stories and tasks form independent
  // sequential chains.
  for (const kind of ["story", "task"] as const) {
    const kindNodes = nodes.filter((n) => n.kind === kind);
    for (const e of buildGrammarEdges(kindNodes)) {
      edges.push({ from: e.from, to: e.to, kind: "grammar", semantics: null });
    }
  }

  // Explicit handoff edges from depends_on declarations.
  for (const node of nodes) {
    for (const dep of node.depends_on) {
      edges.push({
        from: dep.task,
        to: node.id,
        kind: "handoff",
        semantics: dep.semantics,
      });
    }
  }

  return edges;
}

/**
 * Detect a cycle in the directed edge graph using DFS.
 * Returns the list of node ids forming the cycle, or null if the graph is acyclic.
 */
function findCycle(nodeIds: string[], edges: Edge[]): string[] | null {
  // Build adjacency list from all edges.
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) {
    adj.set(id, []);
  }
  for (const edge of edges) {
    const list = adj.get(edge.from) ?? [];
    list.push(edge.to);
    adj.set(edge.from, list);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(id: string, path: string[]): string[] | null {
    visited.add(id);
    inStack.add(id);
    path.push(id);

    for (const neighbor of adj.get(id) ?? []) {
      if (inStack.has(neighbor)) {
        // Back edge — reconstruct the cycle portion.
        const start = path.indexOf(neighbor);
        return [...path.slice(start), neighbor];
      }
      if (!visited.has(neighbor)) {
        const result = dfs(neighbor, path);
        if (result !== null) return result;
      }
    }

    inStack.delete(id);
    path.pop();
    return null;
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) {
      const result = dfs(id, []);
      if (result !== null) return result;
    }
  }

  return null;
}

/**
 * Assert no forward handoffs in the given edge set.
 *
 * A forward handoff is a `kind: "handoff"` edge where the producer (from)
 * node has a higher major than the consumer (to) node — meaning work would
 * flow backward in the story-group timeline.
 *
 * Exported so compile.ts can call this check independently (after crossCheck,
 * before the emitted-graph cycle relint) so that the planner-vocabulary
 * diagnostic fires before the cycle error.  coreLint also delegates to this
 * as check (d) — byte-identical behaviour.
 */
export function assertNoForwardHandoffs(nodes: LintNode[], handoffEdges: Edge[]): void {
  const nodeMap = new Map<string, LintNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }
  for (const edge of handoffEdges) {
    if (edge.kind !== "handoff") continue;
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (fromNode === undefined || toNode === undefined) continue;
    if (fromNode.major > toNode.major) {
      const producerMajor = String(fromNode.major).padStart(2, "0");
      const consumerMajor = String(toNode.major).padStart(2, "0");
      throw new CoreLintError(
        `Forward handoff: story group ${consumerMajor} cannot depend on story group ${producerMajor} (producer follows consumer)`,
      );
    }
  }
}

/**
 * Run core lint rules over a compiled node + edge set:
 *
 * (a) Acyclic — the directed edge graph must contain no cycle; throws naming
 *     all ids on the cycle.
 * (b) Registered repos — every node's `repo` must appear in `repoRegistry`;
 *     throws naming the node id and the unregistered repo.
 * (c) Ticket refs — every node must have a non-empty `ticket`; throws naming
 *     the node id.
 * (d) No forward handoffs — delegates to assertNoForwardHandoffs; a
 *     `kind: "handoff"` edge where major(from) > major(to) is invalid.
 */
export function coreLint(
  nodes: LintNode[],
  edges: Edge[],
  repoRegistry: string[] | undefined,
): void {
  // (a) Cycle detection.
  const cycle = findCycle(nodes.map((n) => n.id), edges);
  if (cycle !== null) {
    throw new CoreLintError(
      `Cycle detected in plan graph involving: ${cycle.join(", ")}`,
    );
  }

  // Build id → node map for subsequent checks.
  const nodeMap = new Map<string, LintNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // (b) Registered repos — skipped when repoRegistry is absent (treat all repos as valid).
  if (repoRegistry !== undefined) {
    const repoSet = new Set(repoRegistry);
    for (const node of nodes) {
      if (!repoSet.has(node.repo)) {
        throw new CoreLintError(
          `Node "${node.id}" references unregistered repo "${node.repo}"`,
        );
      }
    }
  }

  // (c) Ticket refs.
  for (const node of nodes) {
    if (node.ticket === undefined || node.ticket === "") {
      throw new CoreLintError(
        `Node "${node.id}" is missing a required ticket reference`,
      );
    }
  }

  // (d) No forward handoffs.
  assertNoForwardHandoffs(nodes, edges);
}

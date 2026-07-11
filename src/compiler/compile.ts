import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Store } from "../foundations/sqlite-store.ts";
import { parsePlanFile, sections, serializeFrontmatter } from "../foundations/plan-file.ts";
import { walkFeature, parseNodeName } from "./grammar.ts";
import { crossCheck } from "./crosscheck.ts";
import { coreLint, buildGrammarEdges, assertNoForwardHandoffs } from "./edges.ts";
import { shapeLint } from "./shape-lint.ts";

// ---------------------------------------------------------------------------
// Row types (mirror compiled-plan SQLite columns per the EPIC schema)
// ---------------------------------------------------------------------------

export type PlanNodeRow = {
  id: string;
  kind: "epic" | "story" | "task" | "deploy-stage";
  feature_id: string;
  repo: string | null;
  ticket_system: string | null;
  ticket_ref: string | null;
  major: number | null;
  lane: number | null;
  slug: string | null;
  generation: number;
  max_attempts?: number | null;
};

export type PlanEdgeRow = {
  from_node_id: string;
  to_node_id: string;
  kind: "grammar" | "handoff";
  semantics: "frozen" | "draft_ok" | null;
};

export type PlanGateRow = {
  node_id: string;
  phase: number;
  position: "entry" | "exit";
  name: string;
  artifact_id: string | null;
  semantics: "frozen" | "draft_ok" | null;
};

export type PlanArtifactRow = {
  id: string;
  publisher_node_id: string;
  kind: string;
  path: string;
};

export type PlanArtifactConsumerRow = {
  artifact_id: string;
  consumer_node_id: string;
};

export type DeployStageRow = {
  node_id: string;
  handlers: string;
  success_criteria: string;
  soak_duration: string;
};

export type CorePlanGraph = {
  nodes: PlanNodeRow[];
  edges: PlanEdgeRow[];
  gates: PlanGateRow[];
  artifacts: PlanArtifactRow[];
  artifactConsumers: PlanArtifactConsumerRow[];
  deployStages?: DeployStageRow[];
};

export type RelintDiagnostic = { kind: "error"; message: string };
export type RelintResult = { diagnostics: RelintDiagnostic[] };

export type SourceProvider = {
  getSnapshot(nodeId: string): Promise<{ content_hash: string; snapshot_at: number }>;
};

export type CompileOptions = {
  /** List of valid repo names for lint; when absent, the repo check is skipped. */
  repoRegistry?: string[];
  /** When true, include draft-lane nodes in the compiled graph. Defaults to false. */
  includeDraftLanes?: boolean;
  sourceProvider?: SourceProvider;
};

// ---------------------------------------------------------------------------
// Gate vocabulary for tdd@1
// ---------------------------------------------------------------------------

const TDD_GATE_NAMES = new Set([
  "failing_test_exists",
  "tests_pass",
  "prerequisites_satisfied",
  "feature_accepted",
]);

// ---------------------------------------------------------------------------
// relintCompiledGraph — pure function; never throws; accumulates diagnostics
// ---------------------------------------------------------------------------

export function relintCompiledGraph(graph: CorePlanGraph): RelintResult {
  const diagnostics: RelintDiagnostic[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  // (a) Dangling edge endpoints
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from_node_id)) {
      diagnostics.push({
        kind: "error",
        message: `Edge endpoint "${edge.from_node_id}" does not resolve to any node`,
      });
    }
    if (!nodeIds.has(edge.to_node_id)) {
      diagnostics.push({
        kind: "error",
        message: `Edge endpoint "${edge.to_node_id}" does not resolve to any node`,
      });
    }
  }

  // (b) Unresolved gate owners
  for (const gate of graph.gates) {
    if (!nodeIds.has(gate.node_id)) {
      diagnostics.push({
        kind: "error",
        message: `Gate owner "${gate.node_id}" does not resolve to any node`,
      });
    }
  }

  // (c) Gate name vocabulary — artifact-consumption gates (artifact_id != null) are exempt
  for (const gate of graph.gates) {
    if (gate.artifact_id === null && !TDD_GATE_NAMES.has(gate.name)) {
      diagnostics.push({
        kind: "error",
        message: `Gate name "${gate.name}" is not in the tdd@1 vocabulary`,
      });
    }
  }

  // (d) Unresolved artifact publishers
  for (const artifact of graph.artifacts) {
    if (!nodeIds.has(artifact.publisher_node_id)) {
      diagnostics.push({
        kind: "error",
        message: `Artifact "${artifact.id}" has unresolved publisher "${artifact.publisher_node_id}"`,
      });
    }
  }

  // (e) Unresolved artifact consumers
  for (const consumer of graph.artifactConsumers) {
    if (!nodeIds.has(consumer.consumer_node_id)) {
      diagnostics.push({
        kind: "error",
        message: `Artifact consumer "${consumer.consumer_node_id}" does not resolve to any node`,
      });
    }
  }

  // (f) Cycle detection
  const cycle = detectCycle(graph.nodes.map((n) => n.id), graph.edges);
  if (cycle !== null) {
    diagnostics.push({
      kind: "error",
      message: `Cycle detected in emitted graph: ${cycle.join(", ")}`,
    });
  }

  return { diagnostics };
}

function detectCycle(nodeIds: string[], edges: PlanEdgeRow[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) {
    adj.set(id, []);
  }
  for (const edge of edges) {
    const list = adj.get(edge.from_node_id) ?? [];
    list.push(edge.to_node_id);
    adj.set(edge.from_node_id, list);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(id: string, path: string[]): string[] | null {
    visited.add(id);
    inStack.add(id);
    path.push(id);
    for (const neighbor of adj.get(id) ?? []) {
      if (inStack.has(neighbor)) {
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

// ---------------------------------------------------------------------------
// Frontmatter shapes (cast from unknown; no runtime validation in Phase 1)
// ---------------------------------------------------------------------------

type EpicFm = {
  id: string;
  repo?: string;
  ticket_system?: string;
  ticket?: string;
  deploy_chain?: Array<{
    stage: string;
    handlers: Array<Record<string, string>>;
    success_criteria: string;
    soak_duration: string;
  }>;
};

type TaskFm = {
  id: string;
  workflow?: string;
  repo?: string;
  ticket_system?: string;
  ticket?: string;
  outputs?: string[];
  write_scope?: string[];
  artifacts_out?: Array<{ id: string; kind: string; path: string }>;
  depends_on?: Array<{ task: string; output: string; semantics: string }>;
  max_attempts?: number;
};

// ---------------------------------------------------------------------------
// buildCorePlan — pure derivation; no store write
// ---------------------------------------------------------------------------

export async function buildCorePlan(
  featureDir: string,
  opts: CompileOptions,
): Promise<CorePlanGraph> {
  // 1. Parse epic.md
  const epicPath = join(featureDir, "epic.md");
  const epicText = await readFile(epicPath, "utf8");
  const { frontmatter: rawEpicFm, body: epicBody } = parsePlanFile(epicPath, epicText);
  const epicFm = rawEpicFm as EpicFm;

  const featureId = epicFm.id;
  const epicSections = sections(epicBody);
  const generation = 0; // unassigned sentinel; compile() overrides with nextGen on insert

  const nodes: PlanNodeRow[] = [];
  const edges: PlanEdgeRow[] = [];
  const gates: PlanGateRow[] = [];
  const artifacts: PlanArtifactRow[] = [];
  const artifactConsumers: PlanArtifactConsumerRow[] = [];

  // Epic node
  nodes.push({
    id: featureId,
    kind: "epic",
    feature_id: featureId,
    repo: epicFm.repo ?? null,
    ticket_system: epicFm.ticket_system ?? null,
    ticket_ref: epicFm.ticket ?? null,
    major: null,
    lane: null,
    slug: null,
    generation,
  });

  // Feature-level exit criterion gate (from ## Acceptance)
  const acceptanceContent = epicSections["Acceptance"];
  if (acceptanceContent !== undefined && acceptanceContent.trim() !== "") {
    gates.push({
      node_id: featureId,
      phase: 1,
      position: "exit",
      name: "feature_accepted",
      artifact_id: null,
      semantics: null,
    });
  }

  // 2. Walk feature dir → story groups
  const walk = await walkFeature(featureDir);

  // Check for structural docs (for crossCheck context)
  const rootEntries = await readdir(featureDir, { withFileTypes: true });
  const hasRunbook = rootEntries.some((e) => e.isFile() && e.name === "RUNBOOK.md");

  // Lint data collections
  const checkNodes: Array<{
    id: string;
    file: string;
    outputs: string[];
    depends_on: Array<{ task: string; output: string; semantics: string }>;
  }> = [];
  const lintNodes: Array<{
    id: string;
    major: number;
    kind: "story" | "task";
    repo: string;
    ticket: string | undefined;
  }> = [];
  const shapeStories: Array<{
    id: string;
    major?: number;
    lane?: number;
    tasks: Array<{
      id: string;
      workflow: string;
      sections: Record<string, string>;
      write_scope?: string[];
      artifacts_out?: Array<{ id: string; kind: string }>;
    }>;
  }> = [];

  type StoryRef = { id: string; major: number };
  type TaskRef = { id: string; major: number; depends_on: Array<{ task: string; output: string; semantics: "frozen" | "draft_ok" }> };

  const storyRefs: StoryRef[] = [];
  const taskRefs: TaskRef[] = [];

  for (const group of walk.groups) {
    for (const story of group.stories) {
      const storyId = story.name;
      const storyMajor = story.parsed.major;
      const storyLane = story.parsed.lane ?? null;

      // Story node
      nodes.push({
        id: storyId,
        kind: "story",
        feature_id: featureId,
        repo: null,
        ticket_system: null,
        ticket_ref: null,
        major: storyMajor,
        lane: storyLane,
        slug: story.parsed.slug,
        generation,
      });
      storyRefs.push({ id: storyId, major: storyMajor });

      const shapeTasks: Array<{
        id: string;
        workflow: string;
        sections: Record<string, string>;
        write_scope?: string[];
        artifacts_out?: Array<{ id: string; kind: string }>;
      }> = [];

      // Read task files in this story
      for (const file of story.files) {
        if (file.kind !== "task") continue;

        const taskPath = join(featureDir, storyId, file.name);
        const taskText = await readFile(taskPath, "utf8");
        const { frontmatter: rawTaskFm, body: taskBody } = parsePlanFile(taskPath, taskText);
        const taskFm = rawTaskFm as TaskFm;

        const taskId = taskFm.id;
        const taskSecs = sections(taskBody);

        const dependsOn: Array<{ task: string; output: string; semantics: "frozen" | "draft_ok" }> =
          (taskFm.depends_on ?? []).map((d) => ({
            task: d.task,
            output: d.output,
            semantics: d.semantics as "frozen" | "draft_ok",
          }));

        // Task node (major/lane inherited from parent story)
        nodes.push({
          id: taskId,
          kind: "task",
          feature_id: featureId,
          repo: taskFm.repo ?? null,
          ticket_system: taskFm.ticket_system ?? null,
          ticket_ref: taskFm.ticket ?? null,
          major: storyMajor,
          lane: storyLane,
          slug: taskFm.id,
          generation,
          max_attempts: taskFm.max_attempts ?? null,
        });
        taskRefs.push({ id: taskId, major: storyMajor, depends_on: dependsOn });

        checkNodes.push({
          id: taskId,
          file: `${storyId}/${file.name}`,
          outputs: taskFm.outputs ?? [],
          depends_on: dependsOn,
        });
        lintNodes.push({
          id: taskId,
          major: storyMajor,
          kind: "task",
          repo: taskFm.repo ?? "",
          ticket: taskFm.ticket,
        });
        shapeTasks.push({
          id: taskId,
          workflow: taskFm.workflow ?? "",
          sections: taskSecs,
          write_scope: taskFm.write_scope,
          artifacts_out: (taskFm.artifacts_out ?? []).map((a) => ({ id: a.id, kind: a.kind })),
        });

        // TDD gate pair (per task with non-empty ## Tests)
        const testsContent = taskSecs["Tests"];
        if (testsContent !== undefined && testsContent.trim() !== "") {
          gates.push({
            node_id: taskId,
            phase: 1,
            position: "entry",
            name: "failing_test_exists",
            artifact_id: null,
            semantics: null,
          });
          gates.push({
            node_id: taskId,
            phase: 1,
            position: "exit",
            name: "tests_pass",
            artifact_id: null,
            semantics: null,
          });
        }

        // Phase-0 setup gate (per task with non-empty ## Prerequisites)
        const prereqContent = taskSecs["Prerequisites"];
        if (prereqContent !== undefined && prereqContent.trim() !== "") {
          gates.push({
            node_id: taskId,
            phase: 0,
            position: "entry",
            name: "prerequisites_satisfied",
            artifact_id: null,
            semantics: null,
          });
        }

        // Artifact-consumption entry gates + consumer rows (from depends_on)
        for (const dep of dependsOn) {
          gates.push({
            node_id: taskId,
            phase: 1,
            position: "entry",
            name: `consumes:${dep.output}`,
            artifact_id: dep.output,
            semantics: dep.semantics,
          });
          artifactConsumers.push({
            artifact_id: dep.output,
            consumer_node_id: taskId,
          });
        }

        // Artifact registry rows (from artifacts_out)
        for (const art of taskFm.artifacts_out ?? []) {
          artifacts.push({
            id: art.id,
            publisher_node_id: taskId,
            kind: art.kind,
            path: art.path,
          });
        }
      }

      shapeStories.push({
        id: storyId,
        major: storyMajor,
        lane: story.parsed.lane,
        tasks: shapeTasks,
      });
    }
  }

  // B1 — Lint calls: crossCheck, coreLint, shapeLint
  const storyDirsForLint = walk.groups.flatMap((g) =>
    g.stories.map((s) => ({
      name: s.name,
      hasIndex: s.files.some((f) => f.kind === "index"),
    })),
  );
  crossCheck(checkNodes, { storyDirs: storyDirsForLint, hasRunbook });

  const taskGrammarEdgesForLint = buildGrammarEdges(lintNodes).map((e) => ({
    from: e.from,
    to: e.to,
    kind: "grammar" as const,
    semantics: null as null,
  }));
  coreLint(lintNodes, taskGrammarEdgesForLint, opts.repoRegistry);

  // Forward-handoff check: fires after crossCheck (dep-resolution errors win)
  // and before the emitted-graph cycle relint in compile(), so the
  // planner-vocabulary diagnostic surfaces instead of "Cycle detected in
  // emitted graph:".  Legal handoffs (producer.major <= consumer.major) pass.
  const handoffEdgesForLint = taskRefs.flatMap((tr) =>
    tr.depends_on.map((dep) => ({
      from: dep.task,
      to: tr.id,
      kind: "handoff" as const,
      semantics: dep.semantics,
    })),
  );
  assertNoForwardHandoffs(lintNodes, handoffEdgesForLint);

  const consumedArtifactIds = taskRefs.flatMap((t) => t.depends_on.map((d) => d.output));
  const treeEdges = taskRefs.flatMap((t) =>
    t.depends_on.map((d) => ({ from: d.task, to: t.id })),
  );
  const shapeResult = shapeLint({
    epic: { id: featureId, sections: epicSections },
    stories: shapeStories,
    consumed_artifact_ids: consumedArtifactIds,
    edges: treeEdges,
  });
  const shapeErrors = shapeResult.diagnostics.filter((d) => d.kind === "error");
  if (shapeErrors.length > 0) {
    throw new Error(shapeErrors.map((d) => d.message).join("; "));
  }

  // 3. Grammar edges for stories and tasks (independent chains)
  for (const e of buildGrammarEdges(storyRefs)) {
    edges.push({ from_node_id: e.from, to_node_id: e.to, kind: "grammar", semantics: null });
  }
  for (const e of buildGrammarEdges(taskRefs)) {
    edges.push({ from_node_id: e.from, to_node_id: e.to, kind: "grammar", semantics: null });
  }

  // 4. Explicit handoff edges (from depends_on)
  for (const tr of taskRefs) {
    for (const dep of tr.depends_on) {
      edges.push({
        from_node_id: dep.task,
        to_node_id: tr.id,
        kind: "handoff",
        semantics: dep.semantics,
      });
    }
  }

  // 5. Deploy-stage nodes (from epic deploy_chain) + DAG edges (B3) + stage data (B4)
  const maxStoryMajor = storyRefs.reduce((max, s) => Math.max(max, s.major), -Infinity);
  const lastMajorStories = Number.isFinite(maxStoryMajor)
    ? storyRefs.filter((s) => s.major === maxStoryMajor)
    : [];

  const deployStageIds: string[] = [];
  const deployStages: DeployStageRow[] = [];

  for (const stage of epicFm.deploy_chain ?? []) {
    const stageNodeId = `${featureId}-deploy-${stage.stage}`;
    deployStageIds.push(stageNodeId);
    nodes.push({
      id: stageNodeId,
      kind: "deploy-stage",
      feature_id: featureId,
      repo: null,
      ticket_system: null,
      ticket_ref: null,
      major: null,
      lane: null,
      slug: stage.stage,
      generation,
    });
    deployStages.push({
      node_id: stageNodeId,
      handlers: JSON.stringify(stage.handlers),
      success_criteria: stage.success_criteria,
      soak_duration: stage.soak_duration,
    });
  }

  // Connect last-major story nodes to the first deploy-stage node, then chain stages
  const firstDeployId = deployStageIds[0];
  if (firstDeployId !== undefined && lastMajorStories.length > 0) {
    for (const sr of lastMajorStories) {
      edges.push({ from_node_id: sr.id, to_node_id: firstDeployId, kind: "grammar", semantics: null });
    }
  }

  // Terminal task nodes of the last-major stories → first deploy-stage.
  // Story-constraint (debate finding 2026-07-05): compiler emits these edges so
  // deploy gating uses the identical task-predecessor rule; story→deploy edges
  // are kept above as structural documentation (inert for scheduling).
  if (firstDeployId !== undefined && Number.isFinite(maxStoryMajor)) {
    const lastMajorTaskIds = new Set(
      taskRefs.filter((t) => t.major === maxStoryMajor).map((t) => t.id),
    );
    const hasSuccessorInLastMajor = new Set<string>();
    for (const t of taskRefs) {
      if (t.major !== maxStoryMajor) continue;
      for (const dep of t.depends_on) {
        if (lastMajorTaskIds.has(dep.task)) {
          hasSuccessorInLastMajor.add(dep.task);
        }
      }
    }
    for (const taskId of lastMajorTaskIds) {
      if (!hasSuccessorInLastMajor.has(taskId)) {
        edges.push({ from_node_id: taskId, to_node_id: firstDeployId, kind: "grammar", semantics: null });
      }
    }
  }
  for (let i = 1; i < deployStageIds.length; i++) {
    const prevId = deployStageIds[i - 1];
    const currId = deployStageIds[i];
    if (prevId !== undefined && currId !== undefined) {
      edges.push({ from_node_id: prevId, to_node_id: currId, kind: "grammar", semantics: null });
    }
  }

  return { nodes, edges, gates, artifacts, artifactConsumers, deployStages };
}

// ---------------------------------------------------------------------------
// Compiled-plan migration — creates tables if not yet present
// ---------------------------------------------------------------------------

export function applyCompiledPlanMigration(store: Store): void {
  store.run(
    `CREATE TABLE IF NOT EXISTS plan_node (
      id TEXT NOT NULL PRIMARY KEY,
      kind TEXT NOT NULL,
      feature_id TEXT NOT NULL,
      repo TEXT,
      ticket_system TEXT,
      ticket_ref TEXT,
      major INTEGER,
      lane INTEGER,
      slug TEXT,
      generation INTEGER NOT NULL,
      content_hash TEXT,
      snapshot_at INTEGER,
      max_attempts INTEGER
    )`,
  );
  store.run(
    `CREATE TABLE IF NOT EXISTS plan_edge (
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      semantics TEXT
    )`,
  );
  store.run(
    `CREATE TABLE IF NOT EXISTS plan_gate (
      node_id TEXT NOT NULL,
      phase INTEGER NOT NULL,
      position TEXT NOT NULL,
      name TEXT NOT NULL,
      artifact_id TEXT,
      semantics TEXT
    )`,
  );
  store.run(
    `CREATE TABLE IF NOT EXISTS plan_artifact (
      id TEXT NOT NULL PRIMARY KEY,
      publisher_node_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      path TEXT NOT NULL
    )`,
  );
  store.run(
    `CREATE TABLE IF NOT EXISTS plan_artifact_consumer (
      artifact_id TEXT NOT NULL,
      consumer_node_id TEXT NOT NULL
    )`,
  );
  store.run(
    `CREATE TABLE IF NOT EXISTS plan_generation (
      generation INTEGER NOT NULL,
      compile_hash TEXT NOT NULL,
      feature_id TEXT NOT NULL,
      at TEXT NOT NULL
    )`,
  );
  store.run(
    `CREATE TABLE IF NOT EXISTS plan_deploy_stage (
      node_id TEXT NOT NULL PRIMARY KEY,
      handlers TEXT,
      success_criteria TEXT,
      soak_duration TEXT
    )`,
  );
}

// ---------------------------------------------------------------------------
// computeCompileHash — deterministic SHA-256 over the covered file set
// Covered: epic.md (compile: key stripped to avoid circularity), INDEX.md,
// task files.  Excluded: RUNBOOK.md, *.state.md, *.journal.jsonl.
// ---------------------------------------------------------------------------

export async function computeCompileHash(featureDir: string): Promise<string> {
  const h = createHash("sha256");
  const entries: Array<{ relPath: string; content: string }> = [];

  // epic.md — strip compile: key before hashing
  const epicPath = join(featureDir, "epic.md");
  const epicRaw = await readFile(epicPath, "utf8");
  const { frontmatter: rawEpicFm, body: epicBody } = parsePlanFile(epicPath, epicRaw);
  const { compile: _c, ...epicFmNoCompile } = rawEpicFm as Record<string, unknown>;
  entries.push({
    relPath: "epic.md",
    content: serializeFrontmatter(epicFmNoCompile) + epicBody,
  });

  // feature-root INDEX.md (if present)
  try {
    const indexContent = await readFile(join(featureDir, "INDEX.md"), "utf8");
    entries.push({ relPath: "INDEX.md", content: indexContent });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // file absent — not part of covered set
  }

  // Walk story directories
  const rootEntries = await readdir(featureDir, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (!entry.isDirectory()) continue;
    const dirName = `${entry.name}/`;
    let parsedKind: string;
    try {
      const parsed = parseNodeName(dirName);
      parsedKind = parsed.kind;
    } catch {
      continue;
    }
    if (parsedKind !== "story") continue;

    const storyPath = join(featureDir, entry.name);
    const storyFiles = await readdir(storyPath, { withFileTypes: true });
    for (const sf of storyFiles) {
      if (!sf.isFile()) continue;
      const fname = sf.name;
      if (fname === "RUNBOOK.md") continue;
      if (fname.endsWith(".state.md")) continue;
      if (fname.endsWith(".journal.jsonl")) continue;
      const relPath = `${entry.name}/${fname}`;
      const content = await readFile(join(storyPath, fname), "utf8");
      entries.push({ relPath, content });
    }
  }

  entries.sort((a, b) => a.relPath.localeCompare(b.relPath));
  for (const { relPath, content } of entries) {
    h.update(relPath);
    h.update("\0");
    h.update(content);
    h.update("\0");
  }
  return h.digest("hex");
}

// ---------------------------------------------------------------------------
// writeCompileBlock — write compile: { shape, hash, at } into epic.md
// ---------------------------------------------------------------------------

async function writeCompileBlock(featureDir: string, hash: string): Promise<void> {
  const epicPath = join(featureDir, "epic.md");
  const epicRaw = await readFile(epicPath, "utf8");
  const { frontmatter: rawFm, body: epicBody } = parsePlanFile(epicPath, epicRaw);
  const fm = rawFm as Record<string, unknown>;
  fm["compile"] = { shape: "tdd@1", hash, at: new Date().toISOString() };
  await writeFile(epicPath, serializeFrontmatter(fm) + epicBody, "utf8");
}

// ---------------------------------------------------------------------------
// compile — buildCorePlan + relint + store write
// ---------------------------------------------------------------------------

export async function compile(
  featureDir: string,
  store: Store,
  opts: CompileOptions,
): Promise<void> {
  // 1. Compute compile_hash (excluding compile: key and excluded file types)
  const hash = await computeCompileHash(featureDir);

  // 2. Apply migration (idempotent DDL)
  applyCompiledPlanMigration(store);

  // 3. Determine featureId from epic.md
  const epicPath = join(featureDir, "epic.md");
  const epicRaw = await readFile(epicPath, "utf8");
  const { frontmatter: rawEpicFm } = parsePlanFile(epicPath, epicRaw);
  const featureId = (rawEpicFm as EpicFm).id;

  // 4. Early-return when hash is unchanged (no-op recompile)
  const existingGenRow = store.get<{ compile_hash: string }>(
    "SELECT compile_hash FROM plan_generation WHERE feature_id = ? ORDER BY generation DESC LIMIT 1",
    featureId,
  );
  if (existingGenRow !== undefined && existingGenRow.compile_hash === hash) {
    return;
  }

  // 5. Build graph + relint
  const graph = await buildCorePlan(featureDir, opts);
  const relint = relintCompiledGraph(graph);
  if (relint.diagnostics.length > 0) {
    const msgs = relint.diagnostics.map((d) => d.message).join("; ");
    throw new Error(`Compiled graph failed re-lint: ${msgs}`);
  }

  // 6. Compute next generation (max existing + 1, default 1)
  const maxGenRow = store.get<{ max_gen: number | null }>(
    "SELECT MAX(generation) AS max_gen FROM plan_generation WHERE feature_id = ?",
    featureId,
  );
  const nextGen = (maxGenRow?.max_gen ?? 0) + 1;

  // 7. Delete existing plan rows for this feature
  const oldNodeIds = store
    .all<{ id: string }>("SELECT id FROM plan_node WHERE feature_id = ?", featureId)
    .map((r) => r.id);
  if (oldNodeIds.length > 0) {
    const ph = oldNodeIds.map(() => "?").join(",");
    const oldArtIds = store
      .all<{ id: string }>(
        `SELECT id FROM plan_artifact WHERE publisher_node_id IN (${ph})`,
        ...oldNodeIds,
      )
      .map((r) => r.id);
    if (oldArtIds.length > 0) {
      const aph = oldArtIds.map(() => "?").join(",");
      store.run(`DELETE FROM plan_artifact_consumer WHERE artifact_id IN (${aph})`, ...oldArtIds);
    }
    store.run(
      `DELETE FROM plan_edge WHERE from_node_id IN (${ph}) OR to_node_id IN (${ph})`,
      ...oldNodeIds,
      ...oldNodeIds,
    );
    store.run(`DELETE FROM plan_gate WHERE node_id IN (${ph})`, ...oldNodeIds);
    store.run(`DELETE FROM plan_artifact WHERE publisher_node_id IN (${ph})`, ...oldNodeIds);
    store.run(`DELETE FROM plan_deploy_stage WHERE node_id IN (${ph})`, ...oldNodeIds);
    store.run("DELETE FROM plan_node WHERE feature_id = ?", featureId);
  }

  // 8. Fetch content snapshots per node (optional sourceProvider)
  const snapshots = new Map<string, { content_hash: string; snapshot_at: number }>();
  if (opts.sourceProvider !== undefined) {
    const provider = opts.sourceProvider;
    await Promise.all(
      graph.nodes.map(async (node) => {
        const snap = await provider.getSnapshot(node.id);
        snapshots.set(node.id, snap);
      }),
    );
  }

  // 9. Write plan_node rows (with updated generation and optional snapshot fields)
  for (const node of graph.nodes) {
    const snap = snapshots.get(node.id);
    store.run(
      "INSERT INTO plan_node (id, kind, feature_id, repo, ticket_system, ticket_ref, major, lane, slug, generation, content_hash, snapshot_at, max_attempts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      node.id,
      node.kind,
      node.feature_id,
      node.repo,
      node.ticket_system,
      node.ticket_ref,
      node.major,
      node.lane,
      node.slug,
      nextGen,
      snap?.content_hash ?? null,
      snap?.snapshot_at ?? null,
      node.max_attempts ?? null,
    );
  }

  // 10. Write plan_edge rows
  for (const edge of graph.edges) {
    store.run(
      "INSERT INTO plan_edge (from_node_id, to_node_id, kind, semantics) VALUES (?, ?, ?, ?)",
      edge.from_node_id,
      edge.to_node_id,
      edge.kind,
      edge.semantics,
    );
  }

  // 11. Write plan_gate rows
  for (const gate of graph.gates) {
    store.run(
      "INSERT INTO plan_gate (node_id, phase, position, name, artifact_id, semantics) VALUES (?, ?, ?, ?, ?, ?)",
      gate.node_id,
      gate.phase,
      gate.position,
      gate.name,
      gate.artifact_id,
      gate.semantics,
    );
  }

  // 12. Write plan_artifact rows
  for (const artifact of graph.artifacts) {
    store.run(
      "INSERT INTO plan_artifact (id, publisher_node_id, kind, path) VALUES (?, ?, ?, ?)",
      artifact.id,
      artifact.publisher_node_id,
      artifact.kind,
      artifact.path,
    );
  }

  // 13. Write plan_artifact_consumer rows
  for (const consumer of graph.artifactConsumers) {
    store.run(
      "INSERT INTO plan_artifact_consumer (artifact_id, consumer_node_id) VALUES (?, ?)",
      consumer.artifact_id,
      consumer.consumer_node_id,
    );
  }

  // 14. Write plan_deploy_stage rows (B4)
  for (const ds of graph.deployStages ?? []) {
    store.run(
      "INSERT INTO plan_deploy_stage (node_id, handlers, success_criteria, soak_duration) VALUES (?, ?, ?, ?)",
      ds.node_id,
      ds.handlers,
      ds.success_criteria,
      ds.soak_duration,
    );
  }

  // 16. Stamp plan_generation (keeps all previous rows for history)
  store.run(
    "INSERT INTO plan_generation (generation, compile_hash, feature_id, at) VALUES (?, ?, ?, ?)",
    nextGen,
    hash,
    featureId,
    new Date().toISOString(),
  );

  // 17. Write compile: { shape, hash, at } block into epic.md
  await writeCompileBlock(featureDir, hash);
}

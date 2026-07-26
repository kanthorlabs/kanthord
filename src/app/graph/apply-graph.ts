/**
 * Story 07 — `import graph --apply` — preflight classifier + apply execution.
 *
 * T1 scope: classify all package nodes (created / updated / unchanged /
 * missing / drifted / locked) BEFORE any CAS writes.
 * T2 scope: merged-graph validation before mutating.
 * T3 scope: apply the classified changes inside one UnitOfWork.
 */
import type {
  InitiativeRepository,
  TaskRepository,
  UnitOfWork,
  GraphImportMap,
  CasResult,
} from "../../storage/port.ts";
import {
  sha256Hex,
  canonicalTask,
  canonicalObjective,
  canonicalInitiative,
} from "../../domain/sha.ts";
import type { GraphPackage } from "./graph-package.ts";
import type { StoreGraph } from "./store-graph.ts";
import {
  validateGraph,
  validateDag,
  type GraphNode,
  type DagNode,
} from "../../domain/graph.ts";
import { newTask } from "../../domain/task.ts";
import type { Task, TaskStatus } from "../../domain/task.ts";
import {
  CrossInitiativeError,
  UnknownNodeError,
  StaleManifestError,
  UncreatableObjectiveError,
} from "./import-errors.ts";
import { GRAPH_FORMAT_VERSION } from "./format.ts";

// 26-char uppercase Crockford base-32 (B6) — inline to avoid importing from apps/.
const ULID_RE_APPLY = /^[0-9A-HJKMNP-TV-Z]{26}$/;

// ---------------------------------------------------------------------------
// Exported types (locked contracts — Story 07)
// ---------------------------------------------------------------------------

export type NodeClass =
  "created" | "updated" | "unchanged" | "missing" | "drifted" | "locked";

export interface ApplyClassification {
  kind: "initiative" | "objective" | "task";
  ref: string;
  id?: string;
  sourcePath?: string;
  class: NodeClass;
  reason?: string; // expected-vs-actual context (B15)
  name?: string; // human-readable label (task title for missing nodes)
  /** Task status observed during preflight; the CAS status predicate. Tasks only. */
  liveStatus?: string;
  /** Set only when a write-phase task CAS failed; says which predicate refused. */
  casReason?: { kind: "sha" } | { kind: "status"; currentStatus: string };
}

export interface EdgeChange {
  kind: "initiative" | "objective";
  id: string; // owner id
  dependency: string; // the prerequisite id
  change: "added" | "removed" | "would-remove";
}

export interface ApplyGraphResult {
  applied: boolean;
  classifications: ApplyClassification[]; // ALL node types (B14/TS1)
  summary: {
    created: number;
    updated: number;
    unchanged: number;
    missing: number;
    deleted?: number;
  };
  conflicts: ApplyClassification[]; // drifted | locked — non-empty ⇒ !applied
  /** Fresh shas read from DB after a successful apply (absent on dry-run or conflicts). */
  freshNodeShas?: Record<string, string>;
  /** Newly created nodes (absent on dry-run or when no nodes were created). */
  createdNodes?: Array<{ ref: string; id: string; sourcePath?: string }>;
  /** Edge changes detected (absent when no sequencing is configured). */
  edgeChanges?: EdgeChange[];
  /** Edge removals blocked by the gate — present only when the apply was refused
   *  because edges would be removed without --confirm-delete. */
  refusedEdgeRemovals?: EdgeChange[];
}

// ---------------------------------------------------------------------------
// Classification helper
// ---------------------------------------------------------------------------

/**
 * Given an intended new sha (from the package's declarative content),
 * a baseline sha (from the manifest), a live DB sha, and the live status,
 * return the classification for the node.
 *
 * For initiative and objective nodes pass `"pending"` as liveStatus so the
 * locked check never fires (they have no lifecycle status).
 */
function classifyNode(
  intendedSha: string,
  baselineSha: string,
  liveSha: string | undefined,
  liveStatus: string,
): NodeClass {
  // DB-drifted check must come first: a node whose live sha diverged from the
  // baseline is always a conflict, even if the package made no changes to it.
  if (liveSha !== baselineSha) return "drifted";
  if (intendedSha === baselineSha) return "unchanged";
  // Live sha matches baseline (DB unchanged since export).
  if (liveStatus !== "pending") return "locked";
  return "updated";
}

// ---------------------------------------------------------------------------
// Edge change helpers (Story 5c)
// ---------------------------------------------------------------------------

/**
 * Compute the resolved after set for an owner.
 * When `confirmDelete` is false, edges in the DB but absent from the package
 * are preserved (gated removal). When true, the package's intent is taken.
 */
function computeResolvedAfter(
  pkgAfter: string[],
  dbAfter: string[],
  confirmDelete: boolean,
): string[] {
  if (confirmDelete) {
    return [...new Set(pkgAfter)]; // package intent accepted
  }
  // Gate: preserve DB edges that the package tried to drop
  const pkgSet = new Set(pkgAfter);
  const preserved = dbAfter.filter((id) => !pkgSet.has(id));
  return [...new Set([...pkgAfter, ...preserved])].sort();
}

/** True if two edge sets differ (treated as sets, ignoring order). */
function setsDiffer(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.some((v, i) => v !== sortedB[i]);
}

// ---------------------------------------------------------------------------
// Late-CAS sentinel — thrown inside the UoW transaction to force rollback.
// ---------------------------------------------------------------------------

class LateCasConflict extends Error {
  readonly conflicting: ApplyClassification;
  constructor(cls: ApplyClassification) {
    super("late CAS conflict");
    this.conflicting = cls;
  }
}

/**
 * Turn a task CAS conflict into the classification reported to the caller.
 * A failed status predicate is a lifecycle refusal (`locked`); a failed sha
 * predicate is an out-of-band content change (`drifted`).
 */
function casConflictClassification(
  cls: ApplyClassification,
  conflict: { reason: "sha" | "status"; currentStatus: string },
): ApplyClassification {
  return conflict.reason === "status"
    ? {
        ...cls,
        class: "locked",
        casReason: { kind: "status", currentStatus: conflict.currentStatus },
      }
    : { ...cls, class: "drifted", casReason: { kind: "sha" } };
}

// ---------------------------------------------------------------------------
// Use case
// ---------------------------------------------------------------------------

/**
 * Sequencing operations needed by ApplyGraph for edge handling.
 * Mutation methods are optional — ApplyGraph tries `set*After` first,
 * then falls back to `seed*After` (for fake/test compatibility).
 */
export interface ApplyGraphSequencing {
  listInitiativeAfter(initiativeId: string): string[];
  listObjectiveAfter(objectiveId: string): string[];
  setInitiativeAfter?(initiativeId: string, after: string[]): void;
  setObjectiveAfter?(objectiveId: string, after: string[]): void;
  seedInitiativeAfter?(initiativeId: string, after: string[]): void;
  seedObjectiveAfter?(objectiveId: string, after: string[]): void;
}

export class ApplyGraph {
  readonly #deps: {
    initiatives: InitiativeRepository;
    tasks: TaskRepository;
    storeGraph: StoreGraph;
    importMap: GraphImportMap;
    uow: UnitOfWork;
    newId: () => string;
    sequencing?: ApplyGraphSequencing;
  };

  constructor(deps: {
    initiatives: InitiativeRepository;
    tasks: TaskRepository;
    storeGraph: StoreGraph;
    importMap: GraphImportMap;
    uow: UnitOfWork;
    newId: () => string;
    sequencing?: ApplyGraphSequencing;
  }) {
    this.#deps = deps;
  }

  async execute(input: {
    pkg: GraphPackage;
    initiativeId: string;
    dryRun?: boolean;
    deleteMissing?: boolean;
    confirmDelete?: boolean;
  }): Promise<ApplyGraphResult> {
    const { pkg } = input;
    const manifest = pkg.manifest;
    if (
      manifest !== undefined &&
      manifest.formatVersion < GRAPH_FORMAT_VERSION
    ) {
      throw new StaleManifestError(
        manifest.formatVersion,
        GRAPH_FORMAT_VERSION,
        manifest.initiativeId,
      );
    }
    const classifications: ApplyClassification[] = [];

    // A task's objectiveRef may be a package-local ref slug (new objective
    // authored in this apply) or already the live objective ULID (exported
    // task, or a ULID pointing at a pre-existing DB objective) — resolve it
    // to the live id the same way create-graph.ts does, so classify, write,
    // and creation-sha phases all digest the same value.
    const objRefToId = new Map(
      pkg.objectives.map((o) => [o.ref, o.id ?? o.ref]),
    );
    const resolveObjectiveId = (ref: string): string =>
      objRefToId.get(ref) ?? ref;

    // --- Classify initiative ---
    if (pkg.initiative.id !== undefined) {
      const dbInit = this.#deps.initiatives.get(pkg.initiative.id);
      const baselineSha = manifest?.nodes[pkg.initiative.id];
      const liveSha = this.#deps.initiatives.getSha256(pkg.initiative.id);

      if (dbInit !== undefined && baselineSha !== undefined) {
        const intendedSha = sha256Hex(
          canonicalInitiative({
            name: pkg.initiative.name,
            projectId: dbInit.projectId,
            after: pkg.initiative.after ?? [],
          }),
        );
        classifications.push({
          kind: "initiative",
          ref: pkg.initiative.ref,
          id: pkg.initiative.id,
          sourcePath: pkg.initiative.sourcePath,
          class: classifyNode(intendedSha, baselineSha, liveSha, "pending"),
        });
      }
    }

    // --- Classify objectives ---
    for (const obj of pkg.objectives) {
      if (obj.id !== undefined) {
        const baselineSha = manifest?.nodes[obj.id];
        const liveSha = this.#deps.initiatives.getSha256(obj.id);

        if (baselineSha !== undefined) {
          // obj.initiativeRef is the initiative ULID in an exported package (B18)
          const intendedSha = sha256Hex(
            canonicalObjective({
              name: obj.name,
              initiativeId: obj.initiativeRef,
              after: obj.after ?? [],
            }),
          );
          classifications.push({
            kind: "objective",
            ref: obj.ref,
            id: obj.id,
            sourcePath: obj.sourcePath,
            class: classifyNode(intendedSha, baselineSha, liveSha, "pending"),
          });
        }
      }
    }

    // --- Classify tasks ---
    // Track which node ids are accounted for by the package tasks.
    const packageTaskIds = new Set<string>();

    for (const task of pkg.tasks) {
      if (task.id !== undefined) {
        packageTaskIds.add(task.id);
        const baselineSha = manifest?.nodes[task.id];
        const liveTask = this.#deps.tasks.get(task.id);
        const liveSha = this.#deps.tasks.getSha256(task.id);
        const liveStatus = liveTask?.status ?? "pending";

        if (baselineSha !== undefined) {
          const intendedSha = sha256Hex(
            canonicalTask({
              title: task.title,
              instructions: task.instructions,
              ac: task.ac,
              agent: task.agent,
              verification: task.verification ?? undefined,
              dependencies: task.dependencies,
              objectiveId: resolveObjectiveId(task.objectiveRef),
            }),
          );
          classifications.push({
            kind: "task",
            ref: task.ref,
            id: task.id,
            sourcePath: task.sourcePath,
            class: classifyNode(intendedSha, baselineSha, liveSha, liveStatus),
            liveStatus,
          });
        }
      } else {
        // id-less node: check the durable idempotency map (round-5)
        const hit = this.#deps.importMap.lookup(
          pkg.packageId,
          "task",
          task.ref,
        );
        if (hit !== undefined) {
          // Treat as the mapped node; CAS against creationSha
          const { nodeId, creationSha } = hit;
          packageTaskIds.add(nodeId);
          const liveTask = this.#deps.tasks.get(nodeId);
          const liveSha = this.#deps.tasks.getSha256(nodeId);
          const liveStatus = liveTask?.status ?? "pending";
          const intendedSha = sha256Hex(
            canonicalTask({
              title: task.title,
              instructions: task.instructions,
              ac: task.ac,
              agent: task.agent,
              verification: task.verification ?? undefined,
              dependencies: task.dependencies,
              objectiveId: resolveObjectiveId(task.objectiveRef),
            }),
          );
          classifications.push({
            kind: "task",
            ref: task.ref,
            id: nodeId,
            sourcePath: task.sourcePath,
            class: classifyNode(intendedSha, creationSha, liveSha, liveStatus),
            liveStatus,
          });
        } else {
          // No map hit → new node to create
          classifications.push({
            kind: "task",
            ref: task.ref,
            sourcePath: task.sourcePath,
            class: "created",
          });
        }
      }
    }

    // --- Classify missing nodes (in manifest.files but absent from the package) ---
    if (manifest !== undefined) {
      const packageInitId = pkg.initiative.id;
      const packageObjIds = new Set<string>(
        pkg.objectives
          .map((o) => o.id)
          .filter((id): id is string => id !== undefined),
      );

      for (const fileId of manifest.files) {
        const inPackage =
          fileId === packageInitId ||
          packageObjIds.has(fileId) ||
          packageTaskIds.has(fileId);

        if (!inPackage) {
          // Determine kind from the manifest context
          let kind: "initiative" | "objective" | "task";
          if (fileId === manifest.initiativeId) {
            kind = "initiative";
          } else if (
            Object.values(manifest.refToId.objectives).includes(fileId)
          ) {
            kind = "objective";
          } else {
            kind = "task";
          }

          let liveStatus: string | undefined;
          let liveTask: Task | undefined;
          if (kind === "task") {
            liveTask = this.#deps.tasks.get(fileId);
            liveStatus = liveTask?.status ?? "pending";
          }

          // When --delete-missing is set, enrich the reason for ineligible nodes.
          let reason: string | undefined = undefined;
          if (input.deleteMissing === true) {
            if (kind === "task") {
              const liveSha = this.#deps.tasks.getSha256(fileId);
              if (liveTask !== undefined && liveTask.status !== "pending") {
                reason = "non-pending";
              } else if (liveSha !== manifest.nodes[fileId]) {
                reason = "drifted";
              }
            } else if (kind === "objective") {
              const liveSha = this.#deps.initiatives.getSha256(fileId);
              if (liveSha !== manifest.nodes[fileId]) {
                reason = "drifted";
              }
            }
          }

          const taskName = liveTask?.title;

          classifications.push({
            kind,
            ref: fileId,
            id: fileId,
            class: "missing",
            reason,
            ...(taskName !== undefined ? { name: taskName } : {}),
            ...(liveStatus !== undefined ? { liveStatus } : {}),
          });
        }
      }
    }

    // --- ObjectiveRef + cross-initiative validation (B6/B15/S4) ---
    // Must run before validateGraph so the user receives a named error.
    const packageObjectiveIds = new Set<string>(
      pkg.objectives
        .map((o) => o.id)
        .filter((id): id is string => id !== undefined),
    );

    for (const task of pkg.tasks) {
      // If objectiveRef is a ULID that resolves to neither the package nor the DB, reject it.
      if (ULID_RE_APPLY.test(task.objectiveRef)) {
        if (
          !packageObjectiveIds.has(task.objectiveRef) &&
          this.#deps.initiatives.getSha256(task.objectiveRef) === undefined
        ) {
          throw new UnknownNodeError(task.sourcePath, task.objectiveRef);
        }
      }
      // If a dep ULID belongs to a different initiative, reject with CrossInitiativeError.
      for (const dep of task.dependencies) {
        if (ULID_RE_APPLY.test(dep)) {
          const depInitId = this.#deps.tasks.getInitiativeId(dep);
          if (depInitId !== undefined && depInitId !== input.initiativeId) {
            throw new CrossInitiativeError(
              task.sourcePath,
              dep,
              input.initiativeId,
              depInitId,
            );
          }
        }
      }
    }

    // --- Edge classification + gating + objective DAG validation (Story 5c) ---
    const resolvedEdgeChanges: Array<{
      kind: "initiative" | "objective";
      id: string;
      after: string[];
      dbAfter: string[];
    }> = [];
    const edgeChanges: EdgeChange[] = [];

    if (this.#deps.sequencing !== undefined) {
      const seq = this.#deps.sequencing;
      const confirmDelete = input.confirmDelete === true;

      // 1. Classify initiative-level edge changes
      if (pkg.initiative.id !== undefined) {
        const pkgAfter = pkg.initiative.after ?? [];
        const dbAfter = seq.listInitiativeAfter(pkg.initiative.id);
        const resolvedAfter = computeResolvedAfter(
          pkgAfter,
          dbAfter,
          confirmDelete,
        );
        // Build per-dependency edge changes
        const pkgSet = new Set(pkgAfter);
        const dbSet = new Set(dbAfter);
        for (const dep of dbAfter) {
          if (!pkgSet.has(dep)) {
            edgeChanges.push({
              kind: "initiative",
              id: pkg.initiative.id,
              dependency: dep,
              change: confirmDelete ? "removed" : "would-remove",
            });
          }
        }
        for (const dep of pkgAfter) {
          if (!dbSet.has(dep)) {
            edgeChanges.push({
              kind: "initiative",
              id: pkg.initiative.id,
              dependency: dep,
              change: "added",
            });
          }
        }
        if (setsDiffer(resolvedAfter, dbAfter)) {
          resolvedEdgeChanges.push({
            kind: "initiative",
            id: pkg.initiative.id,
            after: resolvedAfter,
            dbAfter,
          });
        }
      }

      // 2. Classify objective-level edge changes
      for (const obj of pkg.objectives) {
        if (obj.id !== undefined) {
          const pkgAfter = obj.after ?? [];
          const dbAfter = seq.listObjectiveAfter(obj.id);
          const resolvedAfter = computeResolvedAfter(
            pkgAfter,
            dbAfter,
            confirmDelete,
          );
          // Build per-dependency edge changes
          const pkgSet = new Set(pkgAfter);
          const dbSet = new Set(dbAfter);
          for (const dep of dbAfter) {
            if (!pkgSet.has(dep)) {
              edgeChanges.push({
                kind: "objective",
                id: obj.id,
                dependency: dep,
                change: confirmDelete ? "removed" : "would-remove",
              });
            }
          }
          for (const dep of pkgAfter) {
            if (!dbSet.has(dep)) {
              edgeChanges.push({
                kind: "objective",
                id: obj.id,
                dependency: dep,
                change: "added",
              });
            }
          }
          if (setsDiffer(resolvedAfter, dbAfter)) {
            resolvedEdgeChanges.push({
              kind: "objective",
              id: obj.id,
              after: resolvedAfter,
              dbAfter,
            });
          }
        }
      }

      // 3. Validate merged objective DAG (package edges override DB edges)
      const mergedDagNodes: DagNode[] = [];
      const processedObjIds = new Set<string>();
      for (const obj of pkg.objectives) {
        if (obj.id !== undefined) {
          const pkgAfter = obj.after ?? [];
          const dbAfter = seq.listObjectiveAfter(obj.id);
          // The effective after set: package intent, gated by confirmDelete
          const effectiveAfter = computeResolvedAfter(
            pkgAfter,
            dbAfter,
            confirmDelete,
          );
          mergedDagNodes.push({ id: obj.id, dependencies: effectiveAfter });
          processedObjIds.add(obj.id);
        }
      }
      // Include DB-only objectives (present in DB but absent from package → their edges are unchanged)
      for (const cls of classifications) {
        if (
          cls.kind === "objective" &&
          cls.id !== undefined &&
          cls.class === "missing" &&
          !processedObjIds.has(cls.id)
        ) {
          const dbAfter = seq.listObjectiveAfter(cls.id);
          mergedDagNodes.push({ id: cls.id, dependencies: dbAfter });
          processedObjIds.add(cls.id);
        }
      }
      validateDag(mergedDagNodes);
    }

    // Collect edge removals that would be refused (without --confirm-delete).
    const refusedEdgeRemovals = edgeChanges.filter(
      (ec) => ec.change === "would-remove",
    );

    // --- Merged-graph validation (B10) ---
    // Load all DB tasks for this initiative and build a merged node set.
    // Package nodes override DB nodes for the same id.
    // id-less package tasks use their ref as a temporary id.
    const dbTasks = this.#deps.tasks.listByInitiative(input.initiativeId);
    const mergedMap = new Map<string, GraphNode>();
    for (const dbTask of dbTasks) {
      mergedMap.set(dbTask.id, {
        id: dbTask.id,
        status: dbTask.status,
        dependencies: dbTask.dependencies,
      });
    }
    // A dependency entry may reference an existing/new node by its package
    // `ref` rather than its ULID (Story 03 E) — resolve refs to ids first so
    // ref and ULID are interchangeable for validation.
    const refToId = new Map<string, string>();
    for (const pkgTask of pkg.tasks) {
      refToId.set(pkgTask.ref, pkgTask.id ?? pkgTask.ref);
    }
    for (const pkgTask of pkg.tasks) {
      const nodeId = pkgTask.id ?? pkgTask.ref;
      const liveTask =
        pkgTask.id !== undefined ? this.#deps.tasks.get(pkgTask.id) : undefined;
      const liveStatus = liveTask?.status ?? "pending";
      const resolvedDependencies = pkgTask.dependencies.map(
        (dep) => refToId.get(dep) ?? dep,
      );
      mergedMap.set(nodeId, {
        id: nodeId,
        status: liveStatus,
        dependencies: resolvedDependencies,
      });
    }
    validateGraph([...mergedMap.values()]);

    // --- Aggregate ---
    const conflicts = classifications.filter(
      (c) => c.class === "drifted" || c.class === "locked",
    );
    const summary: ApplyGraphResult["summary"] = {
      created: classifications.filter((c) => c.class === "created").length,
      updated: classifications.filter((c) => c.class === "updated").length,
      unchanged: classifications.filter((c) => c.class === "unchanged").length,
      missing: classifications.filter((c) => c.class === "missing").length,
    };

    // --- Apply half (T3) ---
    // Only mutate when preflight found no conflicts and this is not a dry-run.
    let freshNodeShas: Record<string, string> | undefined;
    let createdNodes:
      Array<{ ref: string; id: string; sourcePath?: string }> | undefined;

    // --- Preflight: refuse uncreatable objective refs (EPIC 007.19 Story 1) ---
    // An objective ref is uncreatable when resolveObjectiveId returns a value
    // that does not correspond to an existing DB objective (checked by
    // getSha256) and the objective was not in the package with a persisted id.
    const unresolvableByRef = new Map<string, string[]>();
    for (const task of pkg.tasks) {
      const resolved = resolveObjectiveId(task.objectiveRef);
      if (this.#deps.initiatives.getSha256(resolved) === undefined) {
        const refs = unresolvableByRef.get(task.objectiveRef) ?? [];
        refs.push(task.ref);
        unresolvableByRef.set(task.objectiveRef, refs);
      }
    }
    if (unresolvableByRef.size > 0) {
      const unresolvable = [...unresolvableByRef.entries()].map(
        ([objectiveRef, taskRefs]) => ({ objectiveRef, taskRefs }),
      );
      throw new UncreatableObjectiveError(input.initiativeId, unresolvable);
    }

    if (
      conflicts.length === 0 &&
      refusedEdgeRemovals.length === 0 &&
      !input.dryRun
    ) {
      // Build fast lookups into the package for the apply pass.
      const pkgTaskById = new Map(
        pkg.tasks.filter((t) => t.id !== undefined).map((t) => [t.id!, t]),
      );
      const pkgTaskByRef = new Map(
        pkg.tasks.filter((t) => t.id === undefined).map((t) => [t.ref, t]),
      );
      const pkgObjById = new Map(
        pkg.objectives.filter((o) => o.id !== undefined).map((o) => [o.id!, o]),
      );
      // resolveObjectiveId is hoisted above the classify pass so both phases
      // agree on one resolution.

      let deletedCount = 0;
      const createdNodesList: Array<{
        ref: string;
        id: string;
        sourcePath?: string;
      }> = [];

      // RB3: wrap the write transaction so any late CAS conflict aborts the
      // whole UnitOfWork and is surfaced as applied:false.
      let lateCasConflict: ApplyClassification | undefined;
      try {
        this.#deps.uow.transaction(() => {
          for (const cls of classifications) {
            if (cls.class === "updated") {
              if (cls.kind === "task" && cls.id !== undefined) {
                const pkgTask = pkgTaskById.get(cls.id);
                if (pkgTask === undefined || manifest === undefined) continue;
                const liveTask = this.#deps.tasks.get(cls.id);
                if (liveTask === undefined) continue;

                const baselineSha = manifest.nodes[cls.id];
                if (baselineSha === undefined) continue;

                // Detect if only objectiveRef changed (pure reparent) by checking
                // whether the sha computed with the LIVE objectiveId still equals
                // the manifest baseline (i.e., spec fields are unchanged).
                const intendedShaWithOrigObj = sha256Hex(
                  canonicalTask({
                    title: pkgTask.title,
                    instructions: pkgTask.instructions,
                    ac: pkgTask.ac,
                    agent: pkgTask.agent,
                    verification: pkgTask.verification ?? undefined,
                    dependencies: pkgTask.dependencies,
                    objectiveId: liveTask.objectiveId,
                  }),
                );
                const specChanged = intendedShaWithOrigObj !== baselineSha;
                const resolvedObjectiveId = resolveObjectiveId(
                  pkgTask.objectiveRef,
                );
                const objectiveChanged =
                  resolvedObjectiveId !== liveTask.objectiveId;

                if (!specChanged && objectiveChanged) {
                  // Pure reparent — only the parent reference changed.
                  const reparentResult = this.#deps.tasks.conditionalReparent(
                    cls.id,
                    baselineSha,
                    resolvedObjectiveId,
                  );
                  if (reparentResult.status === "conflict") {
                    throw new LateCasConflict(cls);
                  }
                } else if (specChanged) {
                  // Spec (and/or deps) changed — use CAS spec update.
                  const casResult = this.#deps.tasks.compareAndApply(
                    cls.id,
                    baselineSha,
                    (cls.liveStatus ?? "pending") as TaskStatus,
                    {
                      title: pkgTask.title,
                      instructions: pkgTask.instructions,
                      ac: pkgTask.ac,
                      agent: pkgTask.agent,
                      verification: pkgTask.verification ?? null,
                      dependencies: pkgTask.dependencies,
                    },
                  );
                  if (casResult.status === "conflict") {
                    throw new LateCasConflict(
                      casConflictClassification(cls, casResult),
                    );
                  }
                  // If the objectiveRef also changed, reparent using the fresh sha
                  // returned by compareAndApply (the row's sha changed after the update).
                  if (objectiveChanged) {
                    const reparentResult = this.#deps.tasks.conditionalReparent(
                      cls.id,
                      casResult.freshSha,
                      resolvedObjectiveId,
                    );
                    if (reparentResult.status === "conflict") {
                      throw new LateCasConflict(cls);
                    }
                  }
                }
              } else if (
                cls.kind === "initiative" &&
                cls.id !== undefined &&
                manifest !== undefined
              ) {
                const baselineSha = manifest.nodes[cls.id];
                if (baselineSha !== undefined) {
                  const renameResult =
                    this.#deps.initiatives.conditionalRenameInitiative(
                      cls.id,
                      baselineSha,
                      pkg.initiative.name,
                    );
                  if (renameResult.status === "conflict") {
                    throw new LateCasConflict(cls);
                  }
                }
              } else if (
                cls.kind === "objective" &&
                cls.id !== undefined &&
                manifest !== undefined
              ) {
                const baselineSha = manifest.nodes[cls.id];
                const pkgObj = pkgObjById.get(cls.id);
                if (baselineSha !== undefined && pkgObj !== undefined) {
                  const renameResult =
                    this.#deps.initiatives.conditionalRenameObjective(
                      cls.id,
                      baselineSha,
                      pkgObj.name,
                    );
                  if (renameResult.status === "conflict") {
                    throw new LateCasConflict(cls);
                  }
                }
              }
            } else if (cls.class === "created" && cls.kind === "task") {
              const pkgTask = pkgTaskByRef.get(cls.ref);
              if (pkgTask === undefined) continue;

              const newTaskId = this.#deps.newId();
              const resolvedObjectiveId = resolveObjectiveId(
                pkgTask.objectiveRef,
              );
              const task = newTask({
                id: newTaskId,
                objectiveId: resolvedObjectiveId,
                title: pkgTask.title,
                instructions: pkgTask.instructions,
                ac: pkgTask.ac,
                agent: pkgTask.agent,
                verification: pkgTask.verification ?? undefined,
                dependencies: pkgTask.dependencies,
              });
              this.#deps.tasks.save(task);

              // Compute the creation sha from the canonical formula (same formula
              // as the SQLite write-hook) so it matches what the repo will stamp.
              // Must use the SAME resolved objectiveId just persisted, or the
              // freshly created task classifies `drifted` on the very next apply.
              const creationSha = sha256Hex(
                canonicalTask({
                  title: pkgTask.title,
                  instructions: pkgTask.instructions,
                  ac: pkgTask.ac,
                  agent: pkgTask.agent,
                  verification: pkgTask.verification ?? undefined,
                  dependencies: pkgTask.dependencies,
                  objectiveId: resolvedObjectiveId,
                }),
              );
              this.#deps.importMap.reserve(
                pkg.packageId,
                "task",
                cls.ref,
                newTaskId,
                creationSha,
              );

              // Track newly created node for B1 id-handoff + manifest refresh.
              createdNodesList.push({
                ref: cls.ref,
                id: newTaskId,
                sourcePath: cls.sourcePath,
              });
            } else if (
              cls.class === "missing" &&
              cls.kind === "task" &&
              cls.id !== undefined &&
              cls.reason === undefined &&
              input.confirmDelete === true &&
              manifest !== undefined
            ) {
              // Eligible pending missing task — delete it (TB3: drifted tasks are
              // skipped by the reason check above; only reason===undefined are eligible).
              const baselineSha = manifest.nodes[cls.id];
              if (baselineSha !== undefined) {
                const casResult = this.#deps.tasks.conditionalDeleteTask(
                  cls.id,
                  baselineSha,
                  (cls.liveStatus ?? "pending") as TaskStatus,
                );
                if (casResult.status === "applied") {
                  deletedCount++;
                } else if (casResult.status === "conflict") {
                  throw new LateCasConflict(
                    casConflictClassification(cls, casResult),
                  );
                }
              }
            }
          }

          // After task deletions, attempt to delete eligible missing objectives
          // (TB5: empty objective whose sha still matches the baseline).
          if (input.confirmDelete === true && manifest !== undefined) {
            for (const cls of classifications) {
              if (
                cls.class === "missing" &&
                cls.kind === "objective" &&
                cls.id !== undefined &&
                cls.reason === undefined
              ) {
                const baselineSha = manifest.nodes[cls.id];
                if (baselineSha !== undefined) {
                  const casResult =
                    this.#deps.initiatives.conditionalDeleteObjective(
                      cls.id,
                      baselineSha,
                    );
                  if (casResult.status === "applied") {
                    deletedCount++;
                  } else if (casResult.status === "conflict") {
                    throw new LateCasConflict(cls);
                  }
                }
              }
            }
          }

          // --- Write sequencing edges (Story 5c) ---
          if (
            this.#deps.sequencing !== undefined &&
            resolvedEdgeChanges.length > 0
          ) {
            const seq = this.#deps.sequencing;
            for (const change of resolvedEdgeChanges) {
              if (change.kind === "initiative") {
                if (typeof seq.setInitiativeAfter === "function") {
                  seq.setInitiativeAfter(change.id, change.after);
                } else if (typeof seq.seedInitiativeAfter === "function") {
                  seq.seedInitiativeAfter(change.id, change.after);
                }
              } else {
                if (typeof seq.setObjectiveAfter === "function") {
                  seq.setObjectiveAfter(change.id, change.after);
                } else if (typeof seq.seedObjectiveAfter === "function") {
                  seq.seedObjectiveAfter(change.id, change.after);
                }
              }
            }
          }
        });
      } catch (err) {
        if (err instanceof LateCasConflict) {
          lateCasConflict = err.conflicting;
        } else {
          throw err;
        }
      }

      // Late CAS conflict — the transaction was rolled back; report as not applied.
      if (lateCasConflict !== undefined) {
        return {
          applied: false,
          classifications,
          summary,
          conflicts: [lateCasConflict],
        };
      }

      if (deletedCount > 0) {
        summary.deleted = deletedCount;
      }

      // Gather fresh shas from DB after the transaction commits (B4 manifest
      // refresh — B4e: "rewrite the manifest with the fresh per-node shas").
      // Read shas for every successfully processed node (updated/unchanged/created).
      // Missing/drifted/locked nodes keep their existing manifest baseline shas.
      const gathered: Record<string, string> = {};
      for (const cls of classifications) {
        if (cls.id === undefined) continue;
        if (
          cls.class === "drifted" ||
          cls.class === "locked" ||
          cls.class === "missing"
        )
          continue;
        let sha: string | undefined;
        if (cls.kind === "task") {
          sha = this.#deps.tasks.getSha256(cls.id);
        } else {
          sha = this.#deps.initiatives.getSha256(cls.id);
        }
        if (sha !== undefined) {
          gathered[cls.id] = sha;
        }
      }
      // Add fresh shas for newly created nodes.
      for (const cn of createdNodesList) {
        const sha = this.#deps.tasks.getSha256(cn.id);
        if (sha !== undefined) gathered[cn.id] = sha;
      }
      freshNodeShas = gathered;
      createdNodes = createdNodesList.length > 0 ? createdNodesList : undefined;
    }

    return {
      applied: conflicts.length === 0 && refusedEdgeRemovals.length === 0,
      classifications,
      summary,
      conflicts,
      freshNodeShas,
      createdNodes,
      edgeChanges: edgeChanges.length > 0 ? edgeChanges : undefined,
      refusedEdgeRemovals:
        refusedEdgeRemovals.length > 0 ? refusedEdgeRemovals : undefined,
    };
  }
}

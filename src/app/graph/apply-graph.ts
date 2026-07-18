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
import { validateGraph, type GraphNode } from "../../domain/graph.ts";
import { newTask } from "../../domain/task.ts";
import { CrossInitiativeError, UnknownNodeError } from "./import-errors.ts";

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
}

// ---------------------------------------------------------------------------
// Classification helper
// ---------------------------------------------------------------------------

/**
 * Given an intended new sha (from the package's content + live DB status),
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
// Late-CAS sentinel — thrown inside the UoW transaction to force rollback.
// ---------------------------------------------------------------------------

class LateCasConflict extends Error {
  readonly conflicting: ApplyClassification;
  constructor(cls: ApplyClassification) {
    super("late CAS conflict");
    this.conflicting = cls;
  }
}

// ---------------------------------------------------------------------------
// Use case
// ---------------------------------------------------------------------------

export class ApplyGraph {
  readonly #deps: {
    initiatives: InitiativeRepository;
    tasks: TaskRepository;
    storeGraph: StoreGraph;
    importMap: GraphImportMap;
    uow: UnitOfWork;
    newId: () => string;
  };

  constructor(deps: {
    initiatives: InitiativeRepository;
    tasks: TaskRepository;
    storeGraph: StoreGraph;
    importMap: GraphImportMap;
    uow: UnitOfWork;
    newId: () => string;
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
    const classifications: ApplyClassification[] = [];

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
              dependencies: task.dependsOn,
              objectiveId: task.objectiveRef,
              status: liveStatus,
            }),
          );
          classifications.push({
            kind: "task",
            ref: task.ref,
            id: task.id,
            sourcePath: task.sourcePath,
            class: classifyNode(intendedSha, baselineSha, liveSha, liveStatus),
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
              dependencies: task.dependsOn,
              objectiveId: task.objectiveRef,
              status: liveStatus,
            }),
          );
          classifications.push({
            kind: "task",
            ref: task.ref,
            id: nodeId,
            sourcePath: task.sourcePath,
            class: classifyNode(intendedSha, creationSha, liveSha, liveStatus),
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

          // When --delete-missing is set, enrich the reason for ineligible nodes.
          let reason: string | undefined = undefined;
          if (input.deleteMissing === true) {
            if (kind === "task") {
              const liveTask = this.#deps.tasks.get(fileId);
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

          const taskName =
            kind === "task" ? this.#deps.tasks.get(fileId)?.title : undefined;

          classifications.push({
            kind,
            ref: fileId,
            id: fileId,
            class: "missing",
            reason,
            ...(taskName !== undefined ? { name: taskName } : {}),
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
      for (const dep of task.dependsOn) {
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
    for (const pkgTask of pkg.tasks) {
      const nodeId = pkgTask.id ?? pkgTask.ref;
      const liveTask =
        pkgTask.id !== undefined ? this.#deps.tasks.get(pkgTask.id) : undefined;
      const liveStatus = liveTask?.status ?? "pending";
      mergedMap.set(nodeId, {
        id: nodeId,
        status: liveStatus,
        dependencies: pkgTask.dependsOn,
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

    if (conflicts.length === 0 && !input.dryRun) {
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
                    dependencies: pkgTask.dependsOn,
                    objectiveId: liveTask.objectiveId,
                    status: liveTask.status,
                  }),
                );
                const specChanged = intendedShaWithOrigObj !== baselineSha;
                const objectiveChanged =
                  pkgTask.objectiveRef !== liveTask.objectiveId;

                if (!specChanged && objectiveChanged) {
                  // Pure reparent — only the parent reference changed.
                  const reparentResult = this.#deps.tasks.conditionalReparent(
                    cls.id,
                    baselineSha,
                    pkgTask.objectiveRef,
                  );
                  if (reparentResult.status === "conflict") {
                    throw new LateCasConflict(cls);
                  }
                } else if (specChanged) {
                  // Spec (and/or deps) changed — use CAS spec update.
                  const casResult = this.#deps.tasks.compareAndApply(
                    cls.id,
                    baselineSha,
                    {
                      title: pkgTask.title,
                      instructions: pkgTask.instructions,
                      ac: pkgTask.ac,
                      agent: pkgTask.agent,
                      verification: pkgTask.verification ?? null,
                      dependencies: pkgTask.dependsOn,
                    },
                  );
                  if (casResult.status === "conflict") {
                    throw new LateCasConflict(cls);
                  }
                  // If the objectiveRef also changed, reparent using the fresh sha
                  // returned by compareAndApply (the row's sha changed after the update).
                  if (objectiveChanged) {
                    const reparentResult = this.#deps.tasks.conditionalReparent(
                      cls.id,
                      casResult.freshSha,
                      pkgTask.objectiveRef,
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
              const task = newTask({
                id: newTaskId,
                objectiveId: pkgTask.objectiveRef,
                title: pkgTask.title,
                instructions: pkgTask.instructions,
                ac: pkgTask.ac,
                agent: pkgTask.agent,
                verification: pkgTask.verification ?? undefined,
                dependencies: pkgTask.dependsOn,
              });
              this.#deps.tasks.save(task);

              // Compute the creation sha from the canonical formula (same formula
              // as the SQLite write-hook) so it matches what the repo will stamp.
              const creationSha = sha256Hex(
                canonicalTask({
                  title: pkgTask.title,
                  instructions: pkgTask.instructions,
                  ac: pkgTask.ac,
                  agent: pkgTask.agent,
                  verification: pkgTask.verification ?? undefined,
                  dependencies: pkgTask.dependsOn,
                  objectiveId: pkgTask.objectiveRef,
                  status: "pending",
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
                );
                if (casResult.status === "applied") {
                  deletedCount++;
                } else if (casResult.status === "conflict") {
                  throw new LateCasConflict(cls);
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
      applied: conflicts.length === 0,
      classifications,
      summary,
      conflicts,
      freshNodeShas,
      createdNodes,
    };
  }
}

import type { CreateGraphResult } from "../../../app/graph/create-graph.ts";
import type {
  ApplyGraphResult,
  ApplyClassification,
  EdgeChange,
} from "../../../app/graph/apply-graph.ts";

export interface GraphCreateView {
  readonly initiativeId: string;
  readonly refToId: {
    readonly objectives: Record<string, string>;
    readonly tasks: Record<string, string>;
  };
  readonly nodes: Record<string, string>;
}

export function graphCreateView(r: CreateGraphResult): GraphCreateView {
  return {
    initiativeId: r.initiativeId,
    refToId: {
      objectives: { ...r.refToId.objectives },
      tasks: { ...r.refToId.tasks },
    },
    nodes: { ...r.nodes },
  };
}

export interface ApplyClassificationView {
  readonly kind: "initiative" | "objective" | "task";
  readonly ref: string;
  readonly class: ApplyClassification["class"];
  readonly id?: string;
  readonly sourcePath?: string;
  readonly reason?: string;
  readonly name?: string;
  readonly liveStatus?: string;
  readonly casReason?:
    | { readonly kind: "sha" }
    | { readonly kind: "status"; readonly currentStatus: string };
}

export function applyClassificationView(
  r: ApplyClassification,
): ApplyClassificationView {
  return {
    kind: r.kind,
    ref: r.ref,
    class: r.class,
    ...(r.id !== undefined ? { id: r.id } : {}),
    ...(r.sourcePath !== undefined ? { sourcePath: r.sourcePath } : {}),
    ...(r.reason !== undefined ? { reason: r.reason } : {}),
    ...(r.name !== undefined ? { name: r.name } : {}),
    ...(r.liveStatus !== undefined ? { liveStatus: r.liveStatus } : {}),
    ...(r.casReason !== undefined
      ? {
          casReason:
            r.casReason.kind === "sha"
              ? { kind: "sha" as const }
              : {
                  kind: "status" as const,
                  currentStatus: r.casReason.currentStatus,
                },
        }
      : {}),
  };
}

export interface EdgeChangeView {
  readonly kind: "initiative" | "objective";
  readonly id: string;
  readonly dependency: string;
  readonly change: "added" | "removed" | "would-remove";
}

function edgeChangeView(r: EdgeChange): EdgeChangeView {
  return { kind: r.kind, id: r.id, dependency: r.dependency, change: r.change };
}

export interface GraphApplyView {
  readonly applied: boolean;
  readonly classifications: ApplyClassificationView[];
  readonly summary: {
    readonly created: number;
    readonly updated: number;
    readonly unchanged: number;
    readonly missing: number;
    readonly deleted?: number;
  };
  readonly conflicts: ApplyClassificationView[];
  readonly freshNodeShas?: Record<string, string>;
  readonly createdNodes?: Array<{
    readonly ref: string;
    readonly id: string;
    readonly sourcePath?: string;
  }>;
  readonly edgeChanges?: EdgeChangeView[];
  readonly refusedEdgeRemovals?: EdgeChangeView[];
}

export function graphApplyView(r: ApplyGraphResult): GraphApplyView {
  return {
    applied: r.applied,
    classifications: r.classifications.map(applyClassificationView),
    summary: {
      created: r.summary.created,
      updated: r.summary.updated,
      unchanged: r.summary.unchanged,
      missing: r.summary.missing,
      ...(r.summary.deleted !== undefined
        ? { deleted: r.summary.deleted }
        : {}),
    },
    conflicts: r.conflicts.map(applyClassificationView),
    ...(r.freshNodeShas !== undefined
      ? { freshNodeShas: { ...r.freshNodeShas } }
      : {}),
    ...(r.createdNodes !== undefined
      ? {
          createdNodes: r.createdNodes.map((n) => ({
            ref: n.ref,
            id: n.id,
            ...(n.sourcePath !== undefined ? { sourcePath: n.sourcePath } : {}),
          })),
        }
      : {}),
    ...(r.edgeChanges !== undefined
      ? { edgeChanges: r.edgeChanges.map(edgeChangeView) }
      : {}),
    ...(r.refusedEdgeRemovals !== undefined
      ? { refusedEdgeRemovals: r.refusedEdgeRemovals.map(edgeChangeView) }
      : {}),
  };
}

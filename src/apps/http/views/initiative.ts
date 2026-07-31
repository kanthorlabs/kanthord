import type { GetInitiativeOutput } from "../../../app/initiative/get-initiative.ts";
import type { GetInitiativeGraphOutput } from "../../../app/initiative/get-initiative-graph.ts";
import {
  nullableActionView,
  unsatisfiedEdgeView,
  type ActionView,
  type UnsatisfiedEdgeView,
} from "./shared.ts";

export interface InitiativeResult {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly paused: boolean;
  readonly status?: string;
  readonly workspace?: string;
}

export interface InitiativeView {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly paused: boolean;
  readonly status?: string;
  readonly workspace?: string;
  readonly [key: string]: unknown;
}

export function initiativeView(result: InitiativeResult): InitiativeView {
  return {
    id: result.id,
    projectId: result.projectId,
    name: result.name,
    paused: result.paused,
    ...(result.status !== undefined ? { status: result.status } : {}),
    ...(result.workspace !== undefined ? { workspace: result.workspace } : {}),
  };
}

export interface InitiativeDetailView {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly status: string;
  readonly paused: boolean;
  readonly branch: string;
  readonly workspace?: string;
  readonly after: readonly string[];
  readonly waiting: readonly UnsatisfiedEdgeView[];
  readonly [key: string]: unknown;
}

export function initiativeDetailView(
  result: GetInitiativeOutput,
): InitiativeDetailView {
  return {
    id: result.id,
    projectId: result.projectId,
    name: result.name,
    status: result.status,
    paused: result.paused,
    branch: result.branch,
    ...(result.workspace !== undefined ? { workspace: result.workspace } : {}),
    after: [...result.after],
    waiting: result.waiting.map(unsatisfiedEdgeView),
  };
}

export interface InitiativeGraphInitiativeView {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly paused: boolean;
  readonly branch: string;
  readonly action: ActionView | null;
}

export interface InitiativeGraphGroupView {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly repositories: readonly string[];
  readonly commitOid: string | null;
  readonly conflictReason: string | null;
  readonly after: readonly string[];
  readonly waiting: readonly UnsatisfiedEdgeView[];
  readonly action: ActionView | null;
}

export interface InitiativeGraphNodeView {
  readonly id: string;
  readonly groupId: string;
  readonly title: string;
  readonly status: string;
  readonly dependencyState: string;
  readonly executionState: string;
  readonly dependencies: readonly string[];
  readonly waiting: readonly UnsatisfiedEdgeView[];
  readonly blockedForever: boolean;
  readonly downstream: number;
  readonly lastEventId: string | null;
  readonly lastEventAtMs: number | null;
  readonly agent: string | null;
  readonly instructions: string | null;
  readonly ac: readonly string[];
  readonly verificationRequested: readonly string[];
  readonly verificationResults: ReadonlyArray<{
    readonly command: string;
    readonly exitCode: number;
    readonly output: string;
  }>;
  readonly failureReason: string | null;
  readonly rejection: {
    readonly resolution: string;
    readonly reason: string | null;
  } | null;
  readonly produced: {
    readonly summary: string | null;
    readonly evidenceCount: number;
  } | null;
  readonly note: string | null;
  readonly candidate: {
    readonly candidateSHA: string;
    readonly baseSHA: string | null;
    readonly target: string | null;
    readonly state: string | null;
    readonly source: string;
  } | null;
  readonly action: ActionView | null;
}

export interface InitiativeGraphView {
  readonly projectId: string;
  readonly initiative: InitiativeGraphInitiativeView;
  readonly groups: readonly InitiativeGraphGroupView[];
  readonly nodes: readonly InitiativeGraphNodeView[];
  readonly edges: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
  }>;
  readonly criticalPath: {
    readonly metric: string;
    readonly nodeIds: readonly string[];
    readonly length: number;
  };
  readonly counts: {
    readonly pending: number;
    readonly running: number;
    readonly completed: number;
    readonly failed: number;
    readonly awaiting_confirmation: number;
    readonly discarded: number;
    readonly blocked: number;
    readonly blockedForever: number;
    readonly actionable: number;
  };
  readonly [key: string]: unknown;
}

export function initiativeGraphView(
  result: GetInitiativeGraphOutput,
): InitiativeGraphView {
  return {
    projectId: result.projectId,
    initiative: {
      id: result.initiative.id,
      name: result.initiative.name,
      status: result.initiative.status,
      paused: result.initiative.paused,
      branch: result.initiative.branch,
      action: nullableActionView(result.initiative.action),
    },
    groups: result.groups.map((g) => ({
      id: g.id,
      name: g.name,
      status: g.status,
      repositories: [...g.repositories],
      commitOid: g.commitOid,
      conflictReason: g.conflictReason,
      after: [...g.after],
      waiting: g.waiting.map(unsatisfiedEdgeView),
      action: nullableActionView(g.action),
    })),
    nodes: result.nodes.map((n) => ({
      id: n.id,
      groupId: n.groupId,
      title: n.title,
      status: n.status,
      dependencyState: n.dependencyState,
      executionState: n.executionState,
      dependencies: [...n.dependencies],
      waiting: n.waiting.map(unsatisfiedEdgeView),
      blockedForever: n.blockedForever,
      downstream: n.downstream,
      lastEventId: n.lastEventId,
      lastEventAtMs: n.lastEventAtMs,
      agent: n.agent,
      instructions: n.instructions,
      ac: [...n.ac],
      verificationRequested: [...n.verificationRequested],
      verificationResults: n.verificationResults.map((v) => ({
        command: v.command,
        exitCode: v.exitCode,
        output: v.output,
      })),
      failureReason: n.failureReason,
      rejection:
        n.rejection === null
          ? null
          : {
              resolution: n.rejection.resolution,
              reason: n.rejection.reason,
            },
      produced:
        n.produced === null
          ? null
          : {
              summary: n.produced.summary,
              evidenceCount: n.produced.evidenceCount,
            },
      note: n.note,
      candidate:
        n.candidate === null
          ? null
          : {
              candidateSHA: n.candidate.candidateSHA,
              baseSHA: n.candidate.baseSHA,
              target: n.candidate.target,
              state: n.candidate.state,
              source: n.candidate.source,
            },
      action: nullableActionView(n.action),
    })),
    edges: result.edges.map((e) => ({ from: e.from, to: e.to })),
    criticalPath: {
      metric: result.criticalPath.metric,
      nodeIds: [...result.criticalPath.nodeIds],
      length: result.criticalPath.length,
    },
    counts: {
      pending: result.counts.pending,
      running: result.counts.running,
      completed: result.counts.completed,
      failed: result.counts.failed,
      awaiting_confirmation: result.counts.awaiting_confirmation,
      discarded: result.counts.discarded,
      blocked: result.counts.blocked,
      blockedForever: result.counts.blockedForever,
      actionable: result.counts.actionable,
    },
  };
}

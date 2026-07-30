import type { GetProjectOverviewOutput } from "../../../app/project/get-project-overview.ts";
import {
  actionView,
  eventView,
  nullableActionView,
  type ActionView,
  type EventView,
} from "./shared.ts";

export interface ProjectResult {
  readonly id: string;
  readonly name: string;
}

export interface ProjectView {
  readonly id: string;
  readonly name: string;
  readonly [key: string]: unknown;
}

export function projectView(result: ProjectResult): ProjectView {
  return { id: result.id, name: result.name };
}

export interface ProjectOverviewView {
  readonly projectId: string;
  readonly initiatives: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly paused: boolean;
    readonly taskCounts: {
      readonly pending: number;
      readonly running: number;
      readonly completed: number;
      readonly failed: number;
      readonly awaiting_confirmation: number;
      readonly discarded: number;
    };
    readonly needsHuman: number;
    readonly action: ActionView | null;
  }>;
  readonly lanes: ReadonlyArray<{
    readonly repositoryId: string | null;
    readonly objectiveIds: readonly string[];
    readonly initiativeIds: readonly string[];
  }>;
  readonly decisions: ReadonlyArray<{
    readonly action: ActionView;
    readonly initiativeId: string;
    readonly objectiveId: string | null;
    readonly taskId: string | null;
    readonly downstream: number;
    readonly actionableSince: number | null;
  }>;
  readonly digest: {
    readonly since: string | null;
    readonly latest: string | null;
    readonly totalCount: number;
    readonly byType: Record<string, number>;
    readonly events: EventView[];
    readonly hasMore: boolean;
    readonly pageCursor: string | null;
  };
  readonly [key: string]: unknown;
}

export function projectOverviewView(
  result: GetProjectOverviewOutput,
): ProjectOverviewView {
  return {
    projectId: result.projectId,
    initiatives: result.initiatives.map((i) => ({
      id: i.id,
      name: i.name,
      status: i.status,
      paused: i.paused,
      taskCounts: {
        pending: i.taskCounts.pending,
        running: i.taskCounts.running,
        completed: i.taskCounts.completed,
        failed: i.taskCounts.failed,
        awaiting_confirmation: i.taskCounts.awaiting_confirmation,
        discarded: i.taskCounts.discarded,
      },
      needsHuman: i.needsHuman,
      action: nullableActionView(i.action),
    })),
    lanes: result.lanes.map((l) => ({
      repositoryId: l.repositoryId,
      objectiveIds: [...l.objectiveIds],
      initiativeIds: [...l.initiativeIds],
    })),
    decisions: result.decisions.map((d) => ({
      action: actionView(d.action),
      initiativeId: d.initiativeId,
      objectiveId: d.objectiveId,
      taskId: d.taskId,
      downstream: d.downstream,
      actionableSince: d.actionableSince,
    })),
    digest: {
      since: result.digest.since,
      latest: result.digest.latest,
      totalCount: result.digest.totalCount,
      byType: { ...result.digest.byType },
      events: result.digest.events.map(eventView),
      hasMore: result.digest.hasMore,
      pageCursor: result.digest.pageCursor,
    },
  };
}

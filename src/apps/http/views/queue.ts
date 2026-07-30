import type { GetDecisionQueueOutput } from "../../../app/project/get-decision-queue.ts";
import { actionView } from "./shared.ts";

/**
 * `DecisionItem` is declared in `src/domain/decision-queue.ts`, which
 * `apps/http` may not import. Derived structurally from the app-layer output
 * type instead of naming the domain type directly.
 */
type DecisionItem = GetDecisionQueueOutput["items"][number];

export interface DecisionItemView {
  readonly verdicts: readonly unknown[];
  readonly kindLabel: string;
  readonly cause?: "candidate" | "escalation";
  readonly projectId: string;
  readonly projectName: string;
  readonly initiativeId: string;
  readonly objectiveId?: string;
  readonly taskId?: string;
  readonly downstream: number;
  readonly actionableSince: number | null;
  readonly evidence: {
    readonly basis: "verification-and-summary";
    readonly diffAvailable: false;
    readonly inspect: {
      readonly executable: "git";
      readonly args: readonly string[];
    } | null;
  };
  readonly expectedCommit?: string;
  readonly [key: string]: unknown;
}

export function decisionItemView(item: DecisionItem): DecisionItemView {
  return {
    verdicts: item.verdicts.map(actionView),
    kindLabel: item.kindLabel,
    ...(item.cause !== undefined ? { cause: item.cause } : {}),
    projectId: item.projectId,
    projectName: item.projectName,
    initiativeId: item.initiativeId,
    ...(item.objectiveId !== undefined
      ? { objectiveId: item.objectiveId }
      : {}),
    ...(item.taskId !== undefined ? { taskId: item.taskId } : {}),
    downstream: item.downstream,
    actionableSince: item.actionableSince,
    evidence: {
      basis: item.evidence.basis,
      diffAvailable: item.evidence.diffAvailable,
      inspect:
        item.evidence.inspect === null
          ? null
          : {
              executable: item.evidence.inspect.executable,
              args: [...item.evidence.inspect.args],
            },
    },
    ...(item.expectedCommit !== undefined
      ? { expectedCommit: item.expectedCommit }
      : {}),
  };
}

export interface DecisionQueueView {
  readonly items: readonly DecisionItemView[];
  readonly counts: {
    readonly total: number;
    readonly byKind: Record<string, number>;
  };
  readonly truncated: boolean;
  readonly warnings: readonly string[];
  readonly [key: string]: unknown;
}

export function decisionQueueView(
  result: GetDecisionQueueOutput,
): DecisionQueueView {
  return {
    items: result.items.map(decisionItemView),
    counts: { total: result.counts.total, byKind: { ...result.counts.byKind } },
    truncated: result.truncated,
    warnings: [...result.warnings],
  };
}

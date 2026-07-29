// src/apps/cli/queue.ts — Story 6 §C (EPIC 017).
// Handler for the top-level `queue` leaf: lists every decision waiting on a
// human, ranked by impact, cross-project. Thin — parses args, calls the use
// case, formats output. No business logic.

import type { GetDecisionQueue } from "../../app/project/get-decision-queue.ts";
import { toResult } from "./error-map.ts";
import type { HandlerResult } from "./project-readiness.ts";

export async function runQueueList(
  args: Record<string, unknown>,
  getDecisionQueue: GetDecisionQueue,
): Promise<HandlerResult> {
  const limitRaw = args["limit"] as string | undefined;
  let limit: number | undefined;
  if (limitRaw !== undefined) {
    const parsed = parseInt(limitRaw, 10);
    if (isNaN(parsed) || parsed <= 0 || String(parsed) !== limitRaw) {
      return {
        exitCode: 1,
        stdout: [],
        stderr: [`error: --limit must be a positive integer, got: ${limitRaw}`],
      };
    }
    limit = parsed;
  }

  let output;
  try {
    output = await getDecisionQueue.execute(
      limit !== undefined ? { limit } : {},
    );
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }

  // Review R3-S3 — the use case is read-only and never prints; it degrades a
  // failing home's commit probe into a warning string instead of throwing.
  // This is the seam that writes those warnings to stderr, verbatim.
  const stderr = [...output.warnings];

  const json = args["json"] === true;
  if (json) {
    // Review R4 — warnings travel on stderr in BOTH modes, so the channel is
    // the same whatever the flag. Emitting them here too would duplicate
    // them; stdout stays purely the data contract.
    const { warnings: _warnings, ...payload } = output;
    return { exitCode: 0, stdout: [JSON.stringify(payload)], stderr };
  }

  const stdout: string[] = [];
  for (const item of output.items) {
    const elementId = item.taskId ?? item.objectiveId ?? item.initiativeId;
    const verdicts = item.verdicts.map((v) => v.kind).join(",");
    stdout.push(
      `${item.kindLabel} ${item.projectName} ${elementId} downstream=${item.downstream} verdicts=${verdicts}`,
    );
  }
  stdout.push(`total: ${output.counts.total}`);
  stdout.push(`truncated: ${output.truncated}`);

  return { exitCode: 0, stdout, stderr };
}

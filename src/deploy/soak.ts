import type { Clock } from "../foundations/clock.ts";

/**
 * SoakStageNode — describes one deploy stage to observe through a soak window.
 */
export type SoakStageNode = {
  nodeId: string;
  handlers: Array<{ observer: string }>;
  soakDurationMs: number;
  pollIntervalMs: number;
};

/**
 * ObserverMap — maps observer name → observer function.
 */
export type ObserverMap = Map<
  string,
  (stageId: string, clock: Clock) => Promise<{ healthy: boolean; value: unknown }>
>;

/**
 * SoakEvidence — captured detail when an observer fails during the soak window.
 * Includes the full soak-window history at the point of failure (EPIC §Verification Gate).
 */
export type SoakEvidence = {
  observer: string;
  value: unknown;
  clockInstant: number;
  stageId: string;
  soakWindowHistory: Array<{
    clockInstant: number;
    results: Array<{ observer: string; healthy: boolean; value: unknown }>;
  }>;
};

/**
 * SoakOutcome — discriminated union for soak resolution.
 */
export type SoakOutcome =
  | { result: "on_pass"; event: "notify_human" }
  | { result: "on_fail"; resolution: "halt_and_escalate"; evidence: SoakEvidence };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type HistoryEntry = {
  clockInstant: number;
  results: Array<{ observer: string; healthy: boolean; value: unknown }>;
};

type PollResult =
  | { healthy: true }
  | { healthy: false; evidence: SoakEvidence };

async function runPollObservers(
  stageId: string,
  handlers: Array<{ observer: string }>,
  observers: ObserverMap,
  clock: Clock,
  history: HistoryEntry[],
): Promise<PollResult> {
  const instant = clock.now();
  const results: Array<{ observer: string; healthy: boolean; value: unknown }> = [];

  for (const { observer } of handlers) {
    const fn = observers.get(observer);
    if (fn === undefined) continue;
    const r = await fn(stageId, clock);
    results.push({ observer, healthy: r.healthy, value: r.value });
    if (!r.healthy) {
      // Record the partial results up to this point before returning evidence.
      history.push({ clockInstant: instant, results });
      return {
        healthy: false,
        evidence: {
          observer,
          value: r.value,
          clockInstant: instant,
          stageId,
          soakWindowHistory: [...history],
        },
      };
    }
  }

  history.push({ clockInstant: instant, results });
  return { healthy: true };
}

// ---------------------------------------------------------------------------
// soakStage — public entry point
// ---------------------------------------------------------------------------

/**
 * soakStage — monitors a deploy stage across a soak window by scheduling
 * repeated observer polls on the injected clock.
 *
 * - Uses `clock.setTimer(pollIntervalMs, cb)` for each poll — observable repeated
 *   invocations at poll points, not a private one-shot loop (EPIC verification gate).
 * - AND criteria: every declared observer must return `{ healthy: true }` at
 *   every poll; first unhealthy result halts and escalates with evidence.
 * - After all polls across the full soak duration pass, resolves `on_pass` and
 *   emits `notify_human` — no auto-merge (PRD §7.4 / §9).
 */
export function soakStage(
  stageNode: SoakStageNode,
  observers: ObserverMap,
  clock: Clock,
): Promise<SoakOutcome> {
  return new Promise<SoakOutcome>((resolve, reject) => {
    const totalPolls = Math.ceil(stageNode.soakDurationMs / stageNode.pollIntervalMs);
    let pollsCompleted = 0;
    const history: HistoryEntry[] = [];

    const schedulePoll = (): void => {
      clock.setTimer(stageNode.pollIntervalMs, () => {
        runPollObservers(
          stageNode.nodeId,
          stageNode.handlers,
          observers,
          clock,
          history,
        ).then((pollResult) => {
          if (!pollResult.healthy) {
            resolve({
              result: "on_fail",
              resolution: "halt_and_escalate",
              evidence: pollResult.evidence,
            });
            return;
          }
          pollsCompleted += 1;
          if (pollsCompleted >= totalPolls) {
            resolve({ result: "on_pass", event: "notify_human" });
          } else {
            schedulePoll();
          }
        }).catch(reject);
      });
    };

    schedulePoll();
  });
}

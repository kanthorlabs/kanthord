import type { RunDaemon } from "../../app/task/run-daemon.ts";

type DaemonFactory = (failTaskIds: string[]) => RunDaemon;

export async function runDaemon(
  args: Record<string, unknown>,
  buildDaemon: DaemonFactory,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  // Validate --poll-interval (must be a positive integer string when provided)
  const pollIntervalRaw = args["poll-interval"] as string | undefined;
  let pollIntervalMs: number | undefined;
  if (pollIntervalRaw !== undefined) {
    const parsed = parseInt(pollIntervalRaw, 10);
    if (isNaN(parsed) || parsed <= 0 || String(parsed) !== pollIntervalRaw) {
      return {
        exitCode: 1,
        stdout: [],
        stderr: [
          `error: --poll-interval must be a positive integer, got: ${pollIntervalRaw}`,
        ],
      };
    }
    pollIntervalMs = parsed;
  }

  const untilIdle = (args["until-idle"] as boolean | undefined) ?? false;

  // Normalise --fail: may be a string, string[], or absent
  const rawFail = args["fail"];
  const failTaskIds: string[] =
    rawFail === undefined
      ? []
      : Array.isArray(rawFail)
        ? (rawFail as string[])
        : [rawFail as string];

  const daemon = buildDaemon(failTaskIds);

  // Wire SIGINT → daemon.stop() so an in-flight task finishes cleanly.
  const sigintHandler = () => daemon.stop();
  process.on("SIGINT", sigintHandler);
  try {
    const result = await daemon.execute({ untilIdle, pollIntervalMs });
    const stderr: string[] =
      result.escalatedCount > 0
        ? [`${result.escalatedCount} task(s) awaiting confirmation`]
        : [];
    return { exitCode: result.exitCode, stdout: [], stderr };
  } finally {
    process.removeListener("SIGINT", sigintHandler);
  }
}

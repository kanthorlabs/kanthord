/** Structural shape of an event row as seen by the CLI. */
type CliEvent = {
  id: string;
  type: string;
  taskId: string;
  payload?: Record<string, string>;
};

/**
 * CLI handler for `events --after <cursor> [--limit n] [--json] [--follow]
 * [--poll-interval ms]`.
 *
 * Human output: one `stderr` line per event — `"<id> <type> <taskId>"` plus
 * the payload as JSON when present.
 * JSON output: one `stdout` ndjson line per event.
 *
 * Paging: when a full page is returned (length === limit), the next read
 * starts immediately without sleeping.  In --follow mode, a short/empty page
 * triggers a sleep then another read; the loop exits when the AbortSignal
 * fires or (without --follow) after the first short page.
 */
export async function runEvents(
  args: Record<string, unknown>,
  listEvents: { execute(p: { after: string; limit?: number }): CliEvent[] },
  sleep: (ms: number) => Promise<void>,
  signal: AbortSignal,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const after = (args["after"] as string) ?? "0";
  const follow = (args["follow"] as boolean | undefined) ?? false;
  const json = (args["json"] as boolean | undefined) ?? false;

  const rawLimit = args["limit"];
  const limit: number | undefined =
    rawLimit === undefined
      ? undefined
      : typeof rawLimit === "number"
        ? rawLimit
        : parseInt(String(rawLimit), 10);

  const rawPollInterval = args["poll-interval"];
  const pollIntervalMs: number =
    rawPollInterval === undefined
      ? 1000
      : parseInt(String(rawPollInterval), 10);

  const stdout: string[] = [];
  const stderr: string[] = [];
  let cursor = after;
  // Display-side throttle for agent.progress (human mode only): at most one
  // line per taskId per 5 seconds; JSON mode always emits all events.
  const lastProgressMs = new Map<string, number>();

  while (true) {
    if (signal.aborted) break;

    let page: CliEvent[];
    try {
      page = listEvents.execute({ after: cursor, limit });
    } catch (err) {
      if (err instanceof RangeError) {
        return {
          exitCode: 1,
          stdout: [],
          stderr: [`error: ${(err as RangeError).message}`],
        };
      }
      throw err;
    }

    for (const event of page) {
      if (json) {
        stdout.push(JSON.stringify(event));
      } else {
        // Display throttle: for agent.progress, emit at most one line per
        // taskId per 5 seconds (capture is un-throttled per A3).
        if (event.type === "agent.progress") {
          const last = lastProgressMs.get(event.taskId) ?? 0;
          if (Date.now() - last < 5000) {
            continue;
          }
          lastProgressMs.set(event.taskId, Date.now());
        }
        let line = `${event.id} ${event.type} ${event.taskId}`;
        if (event.payload !== undefined) {
          line += ` ${JSON.stringify(event.payload)}`;
        }
        stderr.push(line);
      }
    }

    // Advance cursor to the last returned event id.
    if (page.length > 0) {
      cursor = page[page.length - 1]!.id;
    }

    // Full page → re-read immediately without sleeping.
    if (limit !== undefined && page.length === limit) {
      if (follow) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      continue;
    }

    if (follow) {
      if (signal.aborted) break;
      await sleep(pollIntervalMs);
      // After sleep, loop back to top which re-checks signal.aborted.
    } else {
      break;
    }
  }

  return { exitCode: 0, stdout, stderr };
}

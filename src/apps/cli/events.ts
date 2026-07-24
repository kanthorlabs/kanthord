/** Structural shape of an event row as seen by the CLI. */
type CliEvent = {
  id: string;
  type: string;
  taskId?: string;
  objectiveId?: string;
  initiativeId?: string;
  payload?: Record<string, string>;
};

/**
 * CLI handler for `events --after <cursor> [--limit n] [--json] [--follow]
 * [--poll-interval ms]`.
 *
 * Human output: one `stderr` line per event — `"<id> <type> <taskId>"` plus
 * the payload as JSON when present.
 * JSON output: exactly one `stdout` document per page — a single
 * `{"events":[...],"nextCursor":"<id-or-empty>"}` envelope (never bare
 * per-event lines). In `--follow` mode an empty poll page pushes no
 * envelope at all (idle polling must not spam an empty document); a
 * non-follow invocation always emits its one envelope, even when empty.
 *
 * Non-follow paging: returns a single page of `--limit` events (default 10).
 * It reads one extra row (`pageSize + 1`); if that probe row comes back, more
 * events exist, so it drops the probe and sets the envelope's `nextCursor` to
 * the last shown event's id (JSON) or appends a `more available — pass
 * --after <lastId>` line (human). A page that reaches the tail leaves
 * `nextCursor` as `""` (JSON) and emits no hint (human).
 *
 * --follow paging (unchanged): a full page (length === --limit) re-reads
 * immediately; a short/empty page sleeps then re-reads; the loop exits when the
 * AbortSignal fires. Follow never emits a truncation signal.
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
  // Default page size for the paged (non-follow) read; --limit overrides it.
  const pageSize = limit ?? 10;
  // Non-follow probes ONE extra row (pageSize + 1): if that row comes back, a
  // next page exists — no second query needed. An invalid explicit --limit is
  // passed through unchanged so the feed rejects it with a RangeError.
  const invalidLimit =
    limit !== undefined && (!Number.isInteger(limit) || limit <= 0);
  const fetchLimit = follow ? limit : invalidLimit ? limit : pageSize + 1;
  // Display-side throttle for agent.progress (human mode only): at most one
  // line per taskId per 5 seconds; JSON mode always emits all events.
  const lastProgressMs = new Map<string, number>();

  while (true) {
    if (signal.aborted) break;

    let batch: CliEvent[];
    try {
      batch = listEvents.execute({ after: cursor, limit: fetchLimit });
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

    // Non-follow: a returned (pageSize + 1)-th row means there is a next page;
    // show only the first pageSize rows and remember there is more.
    const hasMore = !follow && batch.length > pageSize;
    const visible = hasMore ? batch.slice(0, pageSize) : batch;

    const pageEvents: CliEvent[] = [];
    for (const event of visible) {
      if (json) {
        pageEvents.push(event);
      } else {
        // Display throttle: for agent.progress, emit at most one line per
        // taskId per 5 seconds (capture is un-throttled per A3).
        if (event.type === "agent.progress" && event.taskId !== undefined) {
          const last = lastProgressMs.get(event.taskId) ?? 0;
          if (Date.now() - last < 5000) {
            continue;
          }
          lastProgressMs.set(event.taskId, Date.now());
        }
        const scopeId = event.taskId ?? event.objectiveId ?? event.initiativeId;
        let line = `${event.id} ${event.type} ${scopeId}`;
        if (event.payload !== undefined) {
          line += ` ${JSON.stringify(event.payload)}`;
        }
        stderr.push(line);
      }
    }

    // Advance cursor to the last emitted event id.
    if (visible.length > 0) {
      cursor = visible[visible.length - 1]!.id;
    }

    // JSON output: exactly one envelope per page — never bare per-event lines.
    // In follow mode, skip the push for an empty page (idle polling must not
    // spam an empty envelope); non-follow always emits its one envelope.
    if (json && (!follow || pageEvents.length > 0)) {
      stdout.push(
        JSON.stringify({
          events: pageEvents,
          nextCursor: hasMore ? cursor : "",
        }),
      );
    }

    // Non-follow: single page only — emit a truncation hint (human) when a
    // next page exists (the probe row came back), then stop.
    if (!follow) {
      if (hasMore && !json) {
        stderr.push(`more available — pass --after ${cursor}`);
      }
      break;
    }

    // Follow mode: full page → re-read immediately without sleeping.
    if (limit !== undefined && batch.length === limit) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      continue;
    }

    // Follow mode: short/empty page → sleep, then loop.
    if (signal.aborted) break;
    await sleep(pollIntervalMs);
    // After sleep, loop back to top which re-checks signal.aborted.
  }

  return { exitCode: 0, stdout, stderr };
}

/**
 * src/cli/timeline.ts
 *
 * Story 005 T2 (Epic 019.5) — kanthord timeline CLI (hermetic, injected output sink).
 *
 * Reads the first page (default 100) newest-first via queryTaskTimeline.
 * Prints one line per event to the injected output sink.
 */

import type { Store } from "../foundations/sqlite-store.ts";
import { queryTaskTimeline } from "../metrics/timeline-query.ts";

export function runTimelineCli(
  store: Store,
  opts: { taskId: string; failures?: boolean },
  out: { write(s: string): void },
): void {
  const events = queryTaskTimeline(store, opts.taskId, { failuresOnly: opts.failures });

  for (const ev of events) {
    let line = `[${ev.ts}] kind=${ev.kind}`;

    if (ev.observed_failure_signal != null) {
      line += ` signal=${ev.observed_failure_signal}`;
    }

    if (ev.account_id != null) {
      line += ` account_id=${ev.account_id}`;
    }

    if (ev.model != null) {
      line += ` model=${ev.model}`;
    }

    if (ev.summary != null) {
      line += ` summary=${ev.summary}`;
    }

    out.write(line + "\n");
  }
}

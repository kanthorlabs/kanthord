import type { Event } from "../domain/event.ts";

/**
 * Append-only event feed backed by a strictly monotonic ULID cursor.
 *
 * Contract: `readAfter` correctness depends on all event ids being strictly
 * increasing (ULIDs from a single-writer process). Events whose ids come from
 * external sources are out of contract.
 */
export interface EventFeed {
  append(event: Event): void;
  readAfter(cursor: string, limit?: number): Event[];
}

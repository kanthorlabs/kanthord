// src/app/task/read-event-page.ts — the CQRS-lite query behind
// GET /api/event (EPIC 022 decision 4). One page of the feed plus the
// CONTINUATION cursor.
//
// `nextCursor` is the last RETURNED event id. On an empty page it echoes the
// input cursor, so the same poll is repeatable (idempotent polling); it is
// `null` only when the caller started at the head of the feed (`after: ""`)
// and nothing came back. It is NOT a scan watermark: the scoped read filters
// foreign and NULL-project rows inside SQL (`src/events/sqlite.ts:94-106`) and
// the port exposes no watermark.
//
// `ListEvents` is left alone: the CLI owns its own paging, probe and follow
// behaviour (`src/apps/cli/events.ts`).
import type { Event } from "../../domain/event.ts";

/** Narrow structural interface — only the read half of EventFeed is needed. */
interface ReadableEventFeed {
  readAfter(cursor: string, limit?: number, projectId?: string): Event[];
}

export interface ReadEventPageOutput {
  readonly events: readonly Event[];
  readonly nextCursor: string | null;
}

export class ReadEventPage {
  readonly #feed: ReadableEventFeed;

  constructor(feed: ReadableEventFeed) {
    this.#feed = feed;
  }

  execute({
    after,
    limit,
    projectId,
  }: {
    after: string;
    limit?: number;
    projectId?: string;
  }): ReadEventPageOutput {
    const events = this.#feed.readAfter(after, limit, projectId);
    const last = events.at(-1);
    return { events, nextCursor: last?.id ?? (after === "" ? null : after) };
  }
}

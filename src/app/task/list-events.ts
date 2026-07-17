import type { Event } from "../../domain/event.ts";

/** Narrow structural interface — only the read half of EventFeed is needed. */
interface ReadableEventFeed {
  readAfter(cursor: string, limit?: number): Event[];
}

/**
 * CQRS-lite query: reads the event feed after a cursor.
 * Delegates directly to the EventFeed port — no domain objects involved.
 */
export class ListEvents {
  readonly #feed: ReadableEventFeed;

  constructor(feed: ReadableEventFeed) {
    this.#feed = feed;
  }

  execute({ after, limit }: { after: string; limit?: number }): Event[] {
    return this.#feed.readAfter(after, limit);
  }
}

import type { ReadEventPageOutput } from "../../../app/task/read-event-page.ts";
import { type EventView, eventView } from "./shared.ts";

export interface EventPageView {
  readonly events: readonly EventView[];
  readonly nextCursor: string | null;
  readonly [key: string]: unknown;
}

export function eventPageView(result: ReadEventPageOutput): EventPageView {
  return {
    events: result.events.map(eventView),
    nextCursor: result.nextCursor,
  };
}

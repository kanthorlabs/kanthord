import { decodeTime } from "ulid";
import { newId } from "./entity.ts";

export const EVENT_TYPES = [
  "task.created",
  "task.ready",
  "task.started",
  "task.completed",
  "task.failed",
  "task.dependencies_changed",
  "task.escalated",
  "task.approved",
  "task.rejected",
  "task.discarded",
  "task.abandoned", // 013 Story 5 — operator revoked a run's lease
  "task.blocked",
  "task.conflict",
  "agent.started",
  "agent.progress",
  "agent.finished",
  "task.verification",
  "provider.retry",
  "provider.failover", // 008.4 Story B — chain advance on provider error
  "objective.building",
  "objective.awaiting_confirmation",
  "objective.integrated",
  "objective.conflict",
  "initiative.landed",
  "candidate.transplanted",
  "repository.published",
  "objective.discarded",
  "initiative.discarded",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface Event {
  id: string;
  type: EventType;
  taskId?: string;
  objectiveId?: string;
  initiativeId?: string;
  repositoryId?: string;
  payload?: Record<string, string>;
}

export function newEvent(
  type: EventType,
  input: {
    taskId?: string;
    objectiveId?: string;
    initiativeId?: string;
    repositoryId?: string;
    payload?: Record<string, string>;
  },
): Event {
  const event: Event = {
    id: newId(),
    type,
  };
  if (input.taskId !== undefined) {
    event.taskId = input.taskId;
  }
  if (input.objectiveId !== undefined) {
    event.objectiveId = input.objectiveId;
  }
  if (input.initiativeId !== undefined) {
    event.initiativeId = input.initiativeId;
  }
  if (input.repositoryId !== undefined) {
    event.repositoryId = input.repositoryId;
  }
  if (input.payload !== undefined) {
    event.payload = input.payload;
  }
  return event;
}

// ---------------------------------------------------------------------------
// Story 3 (EPIC 016) — `events` has no timestamp column; the time encoded
// in the event's ULID is the only oracle.
// ---------------------------------------------------------------------------

/**
 * Milliseconds encoded in an event's ULID. `events` has no timestamp column
 * (see `src/storage/sqlite/migrations.ts:771-784`); the id is a real ULID
 * minted by `newEvent`, so `decodeTime(id)` is the event's wall-clock time.
 */
export function eventTimeMs(eventId: string): number {
  return decodeTime(eventId);
}

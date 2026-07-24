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
  "task.blocked",
  "task.conflict",
  "agent.started",
  "agent.progress",
  "agent.finished",
  "task.verification",
  "provider.retry",
  "objective.building",
  "objective.awaiting_confirmation",
  "objective.integrated",
  "objective.conflict",
  "initiative.awaiting_pr",
  "initiative.delivered",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface Event {
  id: string;
  type: EventType;
  taskId?: string;
  objectiveId?: string;
  initiativeId?: string;
  payload?: Record<string, string>;
}

export function newEvent(
  type: EventType,
  input: {
    taskId?: string;
    objectiveId?: string;
    initiativeId?: string;
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
  if (input.payload !== undefined) {
    event.payload = input.payload;
  }
  return event;
}

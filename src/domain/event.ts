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
  "agent.started",
  "agent.progress",
  "agent.finished",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface Event {
  id: string;
  type: EventType;
  taskId: string;
}

export function newEvent(type: EventType, input: { taskId: string }): Event {
  return {
    id: newId(),
    type,
    taskId: input.taskId,
  };
}

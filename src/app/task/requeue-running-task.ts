import type { Task } from "../../domain/task.ts";
import { transitionTask } from "../../domain/task.ts";
import { newEvent } from "../../domain/event.ts";
import type { ClaimedJob, JobQueue } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";

export interface RequeueStore {
  get(id: string): Task | undefined;
  save(task: Task): void;
}

/**
 * Move a `running` task back to `pending`, drop its job row, and re-enqueue it.
 * Appends `task.ready` only when the re-enqueue inserted a new queued row.
 * Returns that insert result. Caller must already be inside a transaction.
 */
export function requeueRunningTask(
  job: ClaimedJob,
  deps: { store: RequeueStore; queue: JobQueue; feed: EventFeed },
): boolean {
  const task = deps.store.get(job.taskId);
  if (task === undefined) return false;
  const pending = transitionTask(task, "pending");
  deps.store.save(pending);
  deps.queue.discard(job.id);
  const inserted = deps.queue.enqueue(job.taskId);
  if (inserted) {
    deps.feed.append(newEvent("task.ready", { taskId: job.taskId }));
  }
  return inserted;
}

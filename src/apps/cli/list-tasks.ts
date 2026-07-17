import type { TaskRepository } from "../../storage/port.ts";
import { ListTasks } from "../../app/task/list-tasks.ts";
import { toResult } from "./error-map.ts";
import { formatTaskLine } from "./format.ts";

interface ListTasksDeps {
  taskRepository: TaskRepository;
}

interface HandlerResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

export async function runListTasks(
  args: Record<string, unknown>,
  deps: ListTasksDeps,
): Promise<HandlerResult> {
  const initiativeId = args["initiative"] as string;

  try {
    const rows = await new ListTasks(deps.taskRepository).execute({
      initiativeId,
    });

    if (args["json"]) {
      return {
        exitCode: 0,
        stdout: [JSON.stringify(rows)],
        stderr: [],
      };
    }

    // Build an id→title map for resolving waiting dep titles
    const titleById = new Map(rows.map((r) => [r.id, r.title]));

    const lines = rows.map((r) => {
      const waitingTitles = r.waiting.map(
        (depId) => titleById.get(depId) ?? depId,
      );
      return formatTaskLine(r.title, r.state, waitingTitles);
    });

    return { exitCode: 0, stdout: lines, stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

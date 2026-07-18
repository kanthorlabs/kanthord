import type { ListTasks } from "../../app/task/list-tasks.ts";
import type { TaskStatus } from "../../app/errors.ts";
import { toResult } from "./error-map.ts";
import { formatTaskLine } from "./format.ts";

interface HandlerResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

export async function runListTasks(
  args: Record<string, unknown>,
  listTasks: ListTasks,
): Promise<HandlerResult> {
  const initiativeId = args["initiative"] as string;
  const status = args["status"] as TaskStatus | undefined;
  const objectiveId = args["objective"] as string | undefined;

  try {
    const rows = await listTasks.execute({ initiativeId, status, objectiveId });

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
      if (r.status !== "pending") {
        return `${r.title}  ${r.status}`;
      }
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

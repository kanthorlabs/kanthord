import type {
  TaskRepository,
  InitiativeRepository,
  ProjectRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import { CreateTask } from "../../app/task/create-task.ts";
import { MissingFlagError, toResult } from "./error-map.ts";

export interface CreateTaskDeps {
  taskRepository: TaskRepository;
  initiativeRepository: InitiativeRepository;
  projectRepository: ProjectRepository;
  referenceResolver: ReferenceResolver;
}

export async function runCreateTask(
  args: Record<string, unknown>,
  deps: CreateTaskDeps,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const objectiveId = args["objective"];
  if (typeof objectiveId !== "string" || objectiveId === "") {
    const err = new MissingFlagError("--objective");
    return { ...toResult(err), stdout: [] };
  }

  const title = args["title"];
  if (typeof title !== "string" || title === "") {
    const err = new MissingFlagError("--title");
    return { ...toResult(err), stdout: [] };
  }

  // Normalize --depends-on: may be a string, string[], or absent
  const rawDeps = args["depends-on"];
  let dependencies: string[] | undefined;
  if (rawDeps !== undefined) {
    dependencies = Array.isArray(rawDeps)
      ? (rawDeps as string[])
      : [rawDeps as string];
  }

  // Parse --context entries: each is "type=resourceId"
  const rawContext = args["context"];
  let context: Record<string, string> | undefined;
  if (rawContext !== undefined) {
    const entries = Array.isArray(rawContext)
      ? (rawContext as string[])
      : [rawContext as string];
    context = {};
    for (const entry of entries) {
      const eqIdx = entry.indexOf("=");
      if (eqIdx === -1) {
        return {
          exitCode: 1,
          stdout: [],
          stderr: [
            `error: invalid --context value "${entry}": expected format type=resourceId`,
          ],
        };
      }
      const type = entry.slice(0, eqIdx);
      const resourceId = entry.slice(eqIdx + 1);
      context[type] = resourceId;
    }
  }

  try {
    const useCase = new CreateTask(
      deps.taskRepository,
      deps.initiativeRepository,
      deps.projectRepository,
      deps.referenceResolver,
    );
    const id = await useCase.execute({
      objectiveId,
      title,
      dependencies,
      context,
    });
    return { exitCode: 0, stdout: [id], stderr: [`task created: ${title}`] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

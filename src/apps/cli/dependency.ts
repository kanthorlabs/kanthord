import type {
  TaskRepository,
  InitiativeRepository,
  ReferenceResolver,
  Transactor,
} from "../../storage/port.ts";
import type { EventFeed } from "../../events/port.ts";
import { AddDependency } from "../../app/task/add-dependency.ts";
import { RemoveDependency } from "../../app/task/remove-dependency.ts";
import { MissingFlagError, toResult } from "./error-map.ts";

export interface DependencyDeps {
  taskRepository: TaskRepository;
  initiativeRepository: InitiativeRepository;
  referenceResolver: ReferenceResolver;
  events: EventFeed;
  transactor: Transactor;
}

export async function runAddDependency(
  args: Record<string, unknown>,
  deps: DependencyDeps,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const taskId = args["task"];
  if (typeof taskId !== "string" || taskId === "") {
    const err = new MissingFlagError("--task");
    return { ...toResult(err), stdout: [] };
  }

  const dependsOn = args["depends-on"];
  if (typeof dependsOn !== "string" || dependsOn === "") {
    const err = new MissingFlagError("--depends-on");
    return { ...toResult(err), stdout: [] };
  }

  try {
    const useCase = new AddDependency(
      deps.taskRepository,
      deps.initiativeRepository,
      deps.referenceResolver,
      deps.events,
      deps.transactor,
    );
    await useCase.execute({ taskId, dependsOn });
    return {
      exitCode: 0,
      stdout: [],
      stderr: [`dependency added: ${taskId} → ${dependsOn}`],
    };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

export async function runRemoveDependency(
  args: Record<string, unknown>,
  deps: DependencyDeps,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const taskId = args["task"];
  if (typeof taskId !== "string" || taskId === "") {
    const err = new MissingFlagError("--task");
    return { ...toResult(err), stdout: [] };
  }

  const dependsOn = args["depends-on"];
  if (typeof dependsOn !== "string" || dependsOn === "") {
    const err = new MissingFlagError("--depends-on");
    return { ...toResult(err), stdout: [] };
  }

  try {
    const useCase = new RemoveDependency(
      deps.taskRepository,
      deps.initiativeRepository,
      deps.referenceResolver,
      deps.events,
      deps.transactor,
    );
    await useCase.execute({ taskId, dependsOn });
    return { exitCode: 0, stdout: [], stderr: [] };
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }
}

import type { Task } from "../domain/task.ts";
import type {
  AgentRunner,
  AgentRunnerResolver,
  TaskContextBinding,
} from "./port.ts";
import { RunnerNotResolvableError } from "./port.ts";

export class RegistryRunnerResolver implements AgentRunnerResolver {
  readonly #defaultRunner: AgentRunner;

  constructor({ defaultRunner }: { defaultRunner: AgentRunner }) {
    this.#defaultRunner = defaultRunner;
  }

  for(task: Task, context: TaskContextBinding[]): AgentRunner {
    const aiBinding = context.find((b) => b.type === "ai_provider");
    if (aiBinding !== undefined) {
      throw new RunnerNotResolvableError(task.id, aiBinding.resourceId);
    }
    return this.#defaultRunner;
  }
}

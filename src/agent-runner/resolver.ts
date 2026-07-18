import type { Task } from "../domain/task.ts";
import type {
  AgentRunner,
  AgentRunnerResolver,
  TaskContextBinding,
} from "./port.ts";
import { RunnerNotResolvableError } from "./port.ts";

type ResolverOptions =
  { runners: Map<string, AgentRunner> } | { defaultRunner: AgentRunner };

export class RegistryRunnerResolver implements AgentRunnerResolver {
  readonly #runners: Map<string, AgentRunner>;
  readonly #defaultRunner: AgentRunner | undefined;

  constructor(opts: ResolverOptions) {
    if ("runners" in opts) {
      this.#runners = opts.runners;
      this.#defaultRunner = undefined;
    } else {
      this.#runners = new Map();
      this.#defaultRunner = opts.defaultRunner;
    }
  }

  for(task: Task, _context: TaskContextBinding[]): AgentRunner {
    const ref = task.agent ?? "";
    const runner = this.#runners.get(ref) ?? this.#defaultRunner;
    if (runner === undefined) {
      throw new RunnerNotResolvableError(task.id, ref);
    }
    return runner;
  }
}

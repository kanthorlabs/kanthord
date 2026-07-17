import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runCreateTask } from "./task.ts";
import type {
  TaskRepository,
  InitiativeRepository,
  ProjectRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import type { Task } from "../../domain/task.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import type { Project } from "../../domain/project.ts";
import type { Resource } from "../../domain/resource.ts";
import { CreateTask } from "../../app/task/create-task.ts";

// --- Test fixture IDs (valid ULIDs) ---
const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ0";
const INIT_ID = "01JZZZZZZZZZZZZZZZZZZZINI0";
const PROJ_ID = "01JZZZZZZZZZZZZZZZZZZZPRJ0";
const DEP_ID1 = "01JZZZZZZZZZZZZZZZZZZZTS01";
const DEP_ID2 = "01JZZZZZZZZZZZZZZZZZZZTS02";
const RES_ID = "01JZZZZZZZZZZZZZZZZZZZRES1";

// --- Minimal fakes ---

type KindResult =
  "project" | "resource" | "initiative" | "objective" | "task" | undefined;

class FakeReferenceResolver implements ReferenceResolver {
  readonly #kinds: Map<string, Exclude<KindResult, undefined>>;
  constructor(kinds: Record<string, Exclude<KindResult, undefined>>) {
    this.#kinds = new Map(Object.entries(kinds));
  }
  resolveKind(id: string): KindResult {
    return this.#kinds.get(id);
  }
}

class FakeInitiativeRepository implements InitiativeRepository {
  readonly #initiatives: Map<string, Initiative> = new Map();
  readonly #objectives: Map<string, Objective> = new Map();
  save(i: Initiative): void {
    this.#initiatives.set(i.id, { ...i });
  }
  get(id: string): Initiative | undefined {
    return this.#initiatives.get(id);
  }
  saveObjective(o: Objective): void {
    this.#objectives.set(o.id, { ...o });
  }
  getObjective(id: string): Objective | undefined {
    return this.#objectives.get(id);
  }
  listObjectives(initiativeId: string): Objective[] {
    return [...this.#objectives.values()].filter(
      (o) => o.initiativeId === initiativeId,
    );
  }
  resolveInitiativeByName(_projectId: string, _name: string): string[] {
    return [];
  }
  resolveObjectiveByName(_initiativeId: string, _name: string): string[] {
    return [];
  }
  listInitiatives(_projectId: string) {
    return [];
  }
}

class FakeTaskRepository implements TaskRepository {
  readonly #tasks: Map<string, Task> = new Map();
  readonly #context: Map<string, Record<string, string>> = new Map();
  save(t: Task): void {
    this.#tasks.set(t.id, { ...t, dependencies: [...t.dependencies] });
  }
  saveAll(tasks: Task[]): void {
    for (const t of tasks) this.save(t);
  }
  get(id: string): Task | undefined {
    return this.#tasks.get(id);
  }
  listByInitiative(_initiativeId: string): Task[] {
    return [...this.#tasks.values()];
  }
  saveTaskContext(taskId: string, context: Record<string, string>): void {
    this.#context.set(taskId, { ...context });
  }
  getTaskContext(taskId: string): Record<string, string> {
    return this.#context.get(taskId) ?? {};
  }
  addDependency(_taskId: string, _dependsOn: string): void {}
  removeDependency(_taskId: string, _dependsOn: string): void {}
  listTasksByObjective(_objectiveId: string): Task[] {
    return [];
  }
}

class FakeProjectRepository implements ProjectRepository {
  readonly #projects: Map<string, Project> = new Map();
  readonly #resources: Map<string, { projectId: string; resource: Resource }> =
    new Map();
  save(p: Project): void {
    this.#projects.set(p.id, { ...p });
  }
  get(id: string): Project | undefined {
    return this.#projects.get(id);
  }
  addResource(projectId: string, resource: Resource): void {
    this.#resources.set(resource.id, {
      projectId,
      resource: { ...resource } as Resource,
    });
  }
  getResource(id: string): Resource | undefined {
    return this.#resources.get(id)?.resource;
  }
  listResources(projectId: string): Resource[] {
    return [...this.#resources.values()]
      .filter((e) => e.projectId === projectId)
      .map((e) => e.resource);
  }
  resolveProjectByName(_name: string): string[] {
    return [];
  }
  resolveResourceByName(_projectId: string, _name: string): string[] {
    return [];
  }
  listProjects() {
    return [];
  }
}

function buildFakes(): {
  taskRepository: FakeTaskRepository;
  initiativeRepository: FakeInitiativeRepository;
  projectRepository: FakeProjectRepository;
  referenceResolver: FakeReferenceResolver;
} {
  const referenceResolver = new FakeReferenceResolver({
    [OBJ_ID]: "objective",
    [INIT_ID]: "initiative",
    [PROJ_ID]: "project",
    [DEP_ID1]: "task",
    [DEP_ID2]: "task",
    [RES_ID]: "resource",
  });
  const initiativeRepository = new FakeInitiativeRepository();
  initiativeRepository.save({ id: INIT_ID, projectId: PROJ_ID, name: "oauth" });
  initiativeRepository.saveObjective({
    id: OBJ_ID,
    initiativeId: INIT_ID,
    name: "backend",
  });
  const taskRepository = new FakeTaskRepository();
  const projectRepository = new FakeProjectRepository();
  projectRepository.save({ id: PROJ_ID, name: "demo" });
  projectRepository.addResource(PROJ_ID, {
    id: RES_ID,
    type: "repository",
    name: "backend",
    organization: "acme",
    branch: "main",
    path: "",
  });
  return {
    taskRepository,
    initiativeRepository,
    projectRepository,
    referenceResolver,
  };
}

describe("runCreateTask", () => {
  test("runCreateTask valid flags returns exitCode 0 with ULID in stdout", async () => {
    const f = buildFakes();
    const result = await runCreateTask(
      { objective: OBJ_ID, title: "implement api" },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        f.referenceResolver,
      ),
    );
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout.length,
      1,
      "stdout has exactly one entry (the ULID)",
    );
    assert.match(result.stdout[0]!, /^[0-9A-Z]{26}$/, "stdout is a ULID");
  });

  test("runCreateTask repeatable --depends-on parses into dep id array", async () => {
    const f = buildFakes();
    const result = await runCreateTask(
      {
        objective: OBJ_ID,
        title: "deploy",
        "depends-on": [DEP_ID1, DEP_ID2],
      },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        f.referenceResolver,
      ),
    );
    assert.equal(
      result.exitCode,
      0,
      `expected exit 0, stderr: ${result.stderr.join(", ")}`,
    );
    assert.equal(result.stdout.length, 1);
  });

  test("runCreateTask repeatable --context parses into type-to-id map", async () => {
    const f = buildFakes();
    const result = await runCreateTask(
      {
        objective: OBJ_ID,
        title: "work",
        context: [`repository=${RES_ID}`],
      },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        f.referenceResolver,
      ),
    );
    assert.equal(
      result.exitCode,
      0,
      `expected exit 0, stderr: ${result.stderr.join(", ")}`,
    );
    assert.equal(result.stdout.length, 1);
  });

  test("runCreateTask --context missing = returns exit 1 with parse error", async () => {
    const f = buildFakes();
    const result = await runCreateTask(
      {
        objective: OBJ_ID,
        title: "work",
        context: ["credential"],
      },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        f.referenceResolver,
      ),
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr.length, 1, "exactly one error line");
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });

  test("runCreateTask bad reference returns exit 1 one-line error on stderr", async () => {
    const f = buildFakes();
    const badResolver = new FakeReferenceResolver({}); // unknown objective
    const result = await runCreateTask(
      { objective: "no-such-objective", title: "x" },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        badResolver,
      ),
    );
    assert.equal(result.exitCode, 1);
    assert.equal(
      result.stderr.length,
      1,
      "exactly one error line (no stack trace)",
    );
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });
});

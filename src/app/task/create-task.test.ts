import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CreateTask } from "./create-task.ts";
import type {
  TaskRepository,
  InitiativeRepository,
  ProjectRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import { UnknownReferenceError, WrongTypeReferenceError } from "../errors.ts";
import type { Task } from "../../domain/task.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import type { Resource } from "../../domain/resource.ts";
import type { Project } from "../../domain/project.ts";

// --- Fakes ---

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

  save(initiative: Initiative): void {
    this.#initiatives.set(initiative.id, { ...initiative });
  }

  get(id: string): Initiative | undefined {
    return this.#initiatives.get(id);
  }

  saveObjective(objective: Objective): void {
    this.#objectives.set(objective.id, { ...objective });
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

  setPaused(_id: string, _paused: boolean): void {}

  listAllInitiatives(): Array<{ id: string; paused: boolean }> {
    return [];
  }
}

class FakeTaskRepository implements TaskRepository {
  readonly #tasks: Map<string, Task> = new Map();
  readonly #context: Map<string, Record<string, string>> = new Map();

  save(task: Task): void {
    this.#tasks.set(task.id, { ...task, dependencies: [...task.dependencies] });
  }

  saveAll(tasks: Task[]): void {
    for (const task of tasks) this.save(task);
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

  getInitiativeId(_taskId: string): string | undefined {
    return undefined;
  }
}

class FakeProjectRepository implements ProjectRepository {
  readonly #projects: Map<string, Project> = new Map();
  readonly #resources: Map<string, { projectId: string; resource: Resource }> =
    new Map();

  save(project: Project): void {
    this.#projects.set(project.id, { ...project });
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
    const result: Resource[] = [];
    for (const entry of this.#resources.values()) {
      if (entry.projectId === projectId) result.push(entry.resource);
    }
    return result;
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

// --- Test fixture IDs (valid ULIDs) ---
const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ0";
const INIT_ID = "01JZZZZZZZZZZZZZZZZZZZINI0";
const PROJ_ID = "01JZZZZZZZZZZZZZZZZZZZPRJ0";
const TASK_ID = "01JZZZZZZZZZZZZZZZZZZZTSK0";
const RES_REPO_ID = "01JZZZZZZZZZZZZZZZZZZRPO0A";
const RES_OTHER_PROJ = "01JZZZZZZZZZZZZZZZZZZROP0B";

/** Build a wired set of deps for the happy path */
function buildDeps() {
  const resolver = new FakeReferenceResolver({
    [OBJ_ID]: "objective",
    [INIT_ID]: "initiative",
    [PROJ_ID]: "project",
  });
  const initiativeRepo = new FakeInitiativeRepository();
  initiativeRepo.save({ id: INIT_ID, projectId: PROJ_ID, name: "oauth" });
  initiativeRepo.saveObjective({
    id: OBJ_ID,
    initiativeId: INIT_ID,
    name: "backend",
  });
  const taskRepo = new FakeTaskRepository();
  const projectRepo = new FakeProjectRepository();
  projectRepo.save({ id: PROJ_ID, name: "demo" });
  return { resolver, initiativeRepo, taskRepo, projectRepo };
}

describe("CreateTask", () => {
  test("CreateTask create with no deps/context returns pending task ULID", async () => {
    const { resolver, initiativeRepo, taskRepo, projectRepo } = buildDeps();
    const uc = new CreateTask(taskRepo, initiativeRepo, projectRepo, resolver);
    const id = await uc.execute({
      objectiveId: OBJ_ID,
      title: "implement api",
    });
    assert.ok(
      typeof id === "string" && id.length > 0,
      "returns a non-empty ULID",
    );
    const saved = taskRepo.get(id);
    assert.ok(saved !== undefined, "task was persisted");
    assert.equal(saved.objectiveId, OBJ_ID);
    assert.equal(saved.title, "implement api");
    assert.equal(saved.status, "pending");
    assert.deepEqual(saved.dependencies, []);
  });

  test("CreateTask unknown objective throws UnknownReferenceError", async () => {
    const { initiativeRepo, taskRepo, projectRepo } = buildDeps();
    const resolver = new FakeReferenceResolver({}); // OBJ_ID unknown
    const uc = new CreateTask(taskRepo, initiativeRepo, projectRepo, resolver);
    await assert.rejects(
      () => uc.execute({ objectiveId: "no-such", title: "x" }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        assert.equal(err.kind, "objective");
        return true;
      },
    );
  });

  test("CreateTask task id as objective throws WrongTypeReferenceError", async () => {
    const { initiativeRepo, taskRepo, projectRepo } = buildDeps();
    const resolver = new FakeReferenceResolver({ [TASK_ID]: "task" });
    const uc = new CreateTask(taskRepo, initiativeRepo, projectRepo, resolver);
    await assert.rejects(
      () => uc.execute({ objectiveId: TASK_ID, title: "x" }),
      (err: unknown) => {
        assert.ok(err instanceof WrongTypeReferenceError);
        assert.equal(err.expected, "objective");
        assert.equal(err.actual, "task");
        return true;
      },
    );
  });

  test("CreateTask unknown depends-on id throws UnknownReferenceError kind task", async () => {
    const { resolver, initiativeRepo, taskRepo, projectRepo } = buildDeps();
    const uc = new CreateTask(taskRepo, initiativeRepo, projectRepo, resolver);
    await assert.rejects(
      () =>
        uc.execute({
          objectiveId: OBJ_ID,
          title: "x",
          dependencies: ["no-such-task"],
        }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        assert.equal(err.kind, "task");
        return true;
      },
    );
  });

  test("CreateTask context credential resource that is repository type throws WrongTypeReferenceError", async () => {
    const { initiativeRepo, taskRepo, projectRepo } = buildDeps();
    // RES_REPO_ID resolves as "resource" but its actual type is "repository"
    const resolver = new FakeReferenceResolver({
      [OBJ_ID]: "objective",
      [RES_REPO_ID]: "resource",
    });
    projectRepo.addResource(PROJ_ID, {
      id: RES_REPO_ID,
      type: "repository",
      name: "backend",
      organization: "acme",
      branch: "main",
      path: "",
    });
    const uc = new CreateTask(taskRepo, initiativeRepo, projectRepo, resolver);
    await assert.rejects(
      () =>
        uc.execute({
          objectiveId: OBJ_ID,
          title: "x",
          context: { credential: RES_REPO_ID },
        }),
      (err: unknown) => {
        assert.ok(err instanceof WrongTypeReferenceError);
        assert.equal(err.expected, "credential");
        return true;
      },
    );
  });

  test("CreateTask context resource from another project throws UnknownReferenceError", async () => {
    const { initiativeRepo, taskRepo, projectRepo } = buildDeps();
    const OTHER_PROJ = "01JZZZZZZZZZZZZZZZZZZZOP0C";
    // RES_OTHER_PROJ is a valid resource but belongs to OTHER_PROJ, not PROJ_ID
    const resolver = new FakeReferenceResolver({
      [OBJ_ID]: "objective",
      [RES_OTHER_PROJ]: "resource",
    });
    projectRepo.addResource(OTHER_PROJ, {
      id: RES_OTHER_PROJ,
      type: "credential",
      name: "other-cred",
      provider: "github",
      value: "secret",
    });
    const uc = new CreateTask(taskRepo, initiativeRepo, projectRepo, resolver);
    await assert.rejects(
      () =>
        uc.execute({
          objectiveId: OBJ_ID,
          title: "x",
          context: { credential: RES_OTHER_PROJ },
        }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        return true;
      },
    );
  });
});

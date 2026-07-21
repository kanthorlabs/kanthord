import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  runCreateTask,
  runRetryTask,
  runApproveTask,
  runRejectTask,
} from "./task.ts";
import { RetryTask, TaskNotRetryableError } from "../../app/task/retry-task.ts";
import type { JobQueue, ClaimedJob } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import type { Event } from "../../domain/event.ts";
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
import type { AgentCatalog } from "../../agent-runner/port.ts";
import { CreateTask } from "../../app/task/create-task.ts";

// --- Test fixture IDs (valid ULIDs) ---
const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ0";
const INIT_ID = "01JZZZZZZZZZZZZZZZZZZZINI0";
const PROJ_ID = "01JZZZZZZZZZZZZZZZZZZZPRJ0";
const DEP_ID1 = "01JZZZZZZZZZZZZZZZZZZZTS01";
const DEP_ID2 = "01JZZZZZZZZZZZZZZZZZZZTS02";
const RES_ID = "01JZZZZZZZZZZZZZZZZZZZRES1";

// --- Minimal fakes ---

class FakeAgentCatalog implements AgentCatalog {
  readonly #allowed: Set<string>;
  constructor(allowed: string[]) {
    this.#allowed = new Set(allowed);
  }
  has(ref: string): boolean {
    return this.#allowed.has(ref);
  }
}

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

  setPaused(_id: string, _paused: boolean): void {}

  listAllInitiatives(): Array<{ id: string; paused: boolean }> {
    return [];
  }

  getSha256(_id: string): string | undefined {
    return undefined;
  }
  conditionalRenameInitiative(
    _id: string,
    _expectedSha: string,
    _name: string,
  ) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalRenameObjective(_id: string, _expectedSha: string, _name: string) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalDeleteObjective(_id: string, _expectedSha: string) {
    return { status: "applied" as const, freshSha: "" };
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
  getInitiativeId(_taskId: string): string | undefined {
    return undefined;
  }

  getSha256(_id: string): string | undefined {
    return undefined;
  }
  compareAndApply(
    _id: string,
    _expectedSha: string,
    _spec: {
      title: string;
      instructions: string;
      ac: string[];
      agent: string;
      verification: string[] | null;
      dependencies: string[];
    },
  ) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalReparent(_id: string, _expectedSha: string, _objectiveId: string) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalDeleteTask(_id: string, _expectedSha: string) {
    return { status: "applied" as const, freshSha: "" };
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
  agentCatalog: FakeAgentCatalog;
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
    remoteUrl: "https://github.com/acme/backend.git",
    branch: "main",
    path: "",
    auth: { kind: "ambient" },
  });
  const agentCatalog = new FakeAgentCatalog(["generic@1"]);
  return {
    taskRepository,
    initiativeRepository,
    projectRepository,
    referenceResolver,
    agentCatalog,
  };
}

describe("runCreateTask", () => {
  test("runCreateTask valid flags returns exitCode 0 with ULID in stdout", async () => {
    const f = buildFakes();
    const result = await runCreateTask(
      {
        objective: OBJ_ID,
        title: "implement api",
        instructions: "do X",
        ac: ["builds"],
      },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        f.referenceResolver,
        f.agentCatalog,
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
        instructions: "deploy it",
        ac: ["deployed"],
        "depends-on": [DEP_ID1, DEP_ID2],
      },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        f.referenceResolver,
        f.agentCatalog,
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
        instructions: "do work",
        ac: ["done"],
        context: [`repository=${RES_ID}`],
      },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        f.referenceResolver,
        f.agentCatalog,
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
        instructions: "do work",
        ac: ["done"],
        context: ["credential"],
      },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        f.referenceResolver,
        f.agentCatalog,
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
      {
        objective: "no-such-objective",
        title: "x",
        instructions: "do X",
        ac: ["done"],
      },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        badResolver,
        f.agentCatalog,
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

  // --- T3 new tests ---

  test("runCreateTask with agent instructions ac returns exit 0 and ULID", async () => {
    const f = buildFakes();
    const result = await runCreateTask(
      {
        objective: OBJ_ID,
        title: "implement api",
        agent: "generic@1",
        instructions: "do X carefully",
        ac: ["builds"],
      },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        f.referenceResolver,
        f.agentCatalog,
      ),
    );
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join(", ")}`);
    assert.match(result.stdout[0]!, /^[0-9A-Z]{26}$/);
  });

  test("runCreateTask omitted agent defaults to generic@1 in persisted task", async () => {
    const f = buildFakes();
    const result = await runCreateTask(
      {
        objective: OBJ_ID,
        title: "implement api",
        // no agent → CLI default generic@1
        instructions: "do X",
        ac: ["done"],
      },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        f.referenceResolver,
        f.agentCatalog,
      ),
    );
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join(", ")}`);
    const id = result.stdout[0]!;
    const saved = f.taskRepository.get(id);
    assert.ok(saved !== undefined);
    assert.equal(saved.agent, "generic@1");
  });

  test("runCreateTask with unknown agent returns exit 1 error: unknown agent: nope@1", async () => {
    const f = buildFakes();
    const result = await runCreateTask(
      {
        objective: OBJ_ID,
        title: "x",
        agent: "nope@1",
        instructions: "do X",
        ac: ["done"],
      },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        f.referenceResolver,
        f.agentCatalog,
      ),
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr.length, 1, "exactly one error line");
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
    assert.ok(
      result.stderr[0]!.includes("nope@1"),
      `expected agent ref in message, got: ${result.stderr[0]}`,
    );
  });

  test("runCreateTask two --ac flags creates task with both ac items in order", async () => {
    const f = buildFakes();
    const result = await runCreateTask(
      {
        objective: OBJ_ID,
        title: "x",
        instructions: "do X",
        ac: ["criterion one", "criterion two"],
      },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        f.referenceResolver,
        f.agentCatalog,
      ),
    );
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join(", ")}`);
    const id = result.stdout[0]!;
    const saved = f.taskRepository.get(id);
    assert.ok(saved !== undefined);
    assert.deepEqual(saved.ac, ["criterion one", "criterion two"]);
  });

  test("runCreateTask missing --instructions returns exit 1", async () => {
    const f = buildFakes();
    const result = await runCreateTask(
      { objective: OBJ_ID, title: "x", ac: ["done"] },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        f.referenceResolver,
        f.agentCatalog,
      ),
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr.length, 1, "exactly one error line");
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });

  test("runCreateTask missing --ac returns exit 1", async () => {
    const f = buildFakes();
    const result = await runCreateTask(
      { objective: OBJ_ID, title: "x", instructions: "do X" },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        f.referenceResolver,
        f.agentCatalog,
      ),
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr.length, 1, "exactly one error line");
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });

  test("runCreateTask two --verification flags creates task with both in order", async () => {
    const f = buildFakes();
    const result = await runCreateTask(
      {
        objective: OBJ_ID,
        title: "x",
        instructions: "do X",
        ac: ["done"],
        verification: ["npm test", "npm run lint"],
      },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        f.referenceResolver,
        f.agentCatalog,
      ),
    );
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join(", ")}`);
    const id = result.stdout[0]!;
    const saved = f.taskRepository.get(id);
    assert.ok(saved !== undefined);
    assert.deepEqual(saved.verification, ["npm test", "npm run lint"]);
  });

  test("runCreateTask omitted --verification leaves verification absent", async () => {
    const f = buildFakes();
    const result = await runCreateTask(
      {
        objective: OBJ_ID,
        title: "x",
        instructions: "do X",
        ac: ["done"],
        // no verification
      },
      new CreateTask(
        f.taskRepository,
        f.initiativeRepository,
        f.projectRepository,
        f.referenceResolver,
        f.agentCatalog,
      ),
    );
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr.join(", ")}`);
    const id = result.stdout[0]!;
    const saved = f.taskRepository.get(id);
    assert.ok(saved !== undefined);
    assert.equal(
      saved.verification,
      undefined,
      "verification should be absent",
    );
  });
});

// ---------------------------------------------------------------------------
// runRetryTask handler tests — local fakes for RetryTask collaborators
// ---------------------------------------------------------------------------

// Narrow interfaces required by RetryTask
interface RetryTaskStore {
  get(id: string): Task | undefined;
  save(task: Task): void;
}

interface RetryKindResolver {
  resolveKind(id: string): string | undefined;
}

class SimpleRetryTaskStore implements RetryTaskStore {
  readonly #tasks: Map<string, Task>;

  constructor(tasks: Task[]) {
    this.#tasks = new Map(tasks.map((t) => [t.id, t]));
  }

  get(id: string): Task | undefined {
    return this.#tasks.get(id);
  }

  save(task: Task): void {
    this.#tasks.set(task.id, task);
  }
}

class NoopJobQueue implements JobQueue {
  enqueue(_taskId: string): boolean {
    return true;
  }
  claim(): ClaimedJob | undefined {
    return undefined;
  }
  finish(_jobId: string, _outcome: "completed" | "failed"): void {}
  discard(_jobId: string): void {}
  listRunningJobs(): ClaimedJob[] {
    return [];
  }
}

class NoopEventFeed implements EventFeed {
  append(_event: Event): void {}
  readAfter(_cursor: string, _limit?: number): Event[] {
    return [];
  }
}

class PassthroughUoW implements UnitOfWork {
  transaction<T>(fn: () => T): T {
    return fn();
  }
}

class FixedKindResolver implements RetryKindResolver {
  readonly #kind: string | undefined;
  constructor(kind: string | undefined) {
    this.#kind = kind;
  }
  resolveKind(_id: string): string | undefined {
    return this.#kind;
  }
}

const RETRY_TASK_ID = "01JZZZZZZZZZZZZZZZZZZZTS99";
const RETRY_OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ8";

function makeRetryHandlerTask(status: Task["status"]): Task {
  return {
    id: RETRY_TASK_ID,
    objectiveId: RETRY_OBJ_ID,
    title: "handler test task",
    status,
    dependencies: [],
  };
}

describe("runRetryTask handler", () => {
  test("runRetryTask returns exitCode 0 and stderr 'task re-queued: <id>' on success", async () => {
    const store = new SimpleRetryTaskStore([makeRetryHandlerTask("failed")]);
    const uc = new RetryTask(
      store,
      new NoopJobQueue(),
      new NoopEventFeed(),
      new PassthroughUoW(),
      new FixedKindResolver("task"),
    );
    const result = await runRetryTask({ id: RETRY_TASK_ID }, uc);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.length, 0);
    assert.ok(
      result.stderr[0]?.includes(`task re-queued: ${RETRY_TASK_ID}`),
      `expected 'task re-queued: ${RETRY_TASK_ID}', got: ${result.stderr[0]}`,
    );
  });

  test("runRetryTask returns exitCode 1 with error line for non-failed task", async () => {
    const store = new SimpleRetryTaskStore([makeRetryHandlerTask("pending")]);
    const uc = new RetryTask(
      store,
      new NoopJobQueue(),
      new NoopEventFeed(),
      new PassthroughUoW(),
      new FixedKindResolver("task"),
    );
    const result = await runRetryTask({ id: RETRY_TASK_ID }, uc);
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });

  test("runRetryTask returns exitCode 1 with error line for unknown id", async () => {
    const store = new SimpleRetryTaskStore([]);
    const uc = new RetryTask(
      store,
      new NoopJobQueue(),
      new NoopEventFeed(),
      new PassthroughUoW(),
      new FixedKindResolver(undefined),
    );
    const result = await runRetryTask({ id: "no-such" }, uc);
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });

  // S2 (007.5) — CLI: retry task on conflict-candidate awaiting_confirmation exits 0
  test("runRetryTask conflict-candidate awaiting_confirmation task exits 0 and re-queues", async () => {
    // Inline narrow fake for the conflict-candidate dependency.
    const conflictCandidateStore = {
      getCandidateByTask(_taskId: string) {
        return {
          id: "01JZZZZZZZZZZZZZZZZZZZCNFL",
          taskId: RETRY_TASK_ID,
          repoId: "01JZZZZZZZZZZZZZZZZZZZRPOX",
          baseSHA: "deadbeef",
          candidateSHA: "cafebabe",
          ref: `kanthord/${RETRY_TASK_ID}`,
          target: "main",
          state: "conflict" as const,
        };
      },
      updateCandidateState(_id: string, _state: string) {},
    };

    const store = new SimpleRetryTaskStore([
      makeRetryHandlerTask("awaiting_confirmation"),
    ]);
    const uc = new RetryTask(
      store,
      new NoopJobQueue(),
      new NoopEventFeed(),
      new PassthroughUoW(),
      new FixedKindResolver("task"),
      conflictCandidateStore,
    );
    const result = await runRetryTask({ id: RETRY_TASK_ID }, uc);
    assert.equal(
      result.exitCode,
      0,
      `expected exit 0 for conflict-candidate retry; stderr: ${result.stderr.join(", ")}`,
    );
  });

  // S3 (007.6) — retry --note passes the note through to execute
  test("(S3-cli-retry-note) runRetryTask --id <id> --note '<text>': exit 0 and note arg passed to RetryTask.execute", async () => {
    let capturedInput: Record<string, unknown> | undefined;

    // Mock RetryTask that captures what execute is called with
    const mockUc = {
      async execute(input: Record<string, unknown>): Promise<void> {
        capturedInput = input;
      },
    } as unknown as RetryTask;

    const result = await runRetryTask(
      { id: RETRY_TASK_ID, note: "keep both event handlers" },
      mockUc,
    );

    assert.equal(
      result.exitCode,
      0,
      `exit 0 expected; stderr: ${result.stderr.join(", ")}`,
    );
    assert.ok(capturedInput !== undefined, "execute must have been called");
    // RED: runRetryTask currently calls execute({ taskId: id }) without note
    assert.equal(
      capturedInput["note"],
      "keep both event handlers",
      "note must be forwarded to RetryTask.execute from the --note CLI arg",
    );
    assert.equal(
      capturedInput["taskId"],
      RETRY_TASK_ID,
      "taskId must still be forwarded correctly",
    );
  });
});

// ---------------------------------------------------------------------------
// runApproveTask — Story 07 T2 CLI (g, part 1)
// ---------------------------------------------------------------------------

describe("runApproveTask", () => {
  // Inline fake for ApproveTask duck-typed interface.
  // Uses double-cast so the inline object is accepted regardless of return type.
  function makeApproveUc(
    onExecute: (input: { taskId: string }) => Promise<unknown>,
  ): Parameters<typeof runApproveTask>[1] {
    return { execute: onExecute } as unknown as Parameters<
      typeof runApproveTask
    >[1];
  }

  test("runApproveTask --id <id>: returns exit 0 when use case succeeds", async () => {
    let calledWith: string | undefined;
    const uc = makeApproveUc(async ({ taskId }) => {
      calledWith = taskId;
      return { kind: "approved", taskId, canonicalSHA: "" };
    });

    const result = await runApproveTask(
      { id: "01JZZZZZZZZZZZZZZZZZZZTSKAP" },
      uc,
    );
    assert.equal(result.exitCode, 0, "exit 0 on success");
    assert.equal(
      result.stdout[0],
      "01JZZZZZZZZZZZZZZZZZZZTSKAP",
      "stdout must contain the task id",
    );
    assert.equal(
      calledWith,
      "01JZZZZZZZZZZZZZZZZZZZTSKAP",
      "use case called with correct taskId",
    );
  });

  test("runApproveTask missing --id: returns exit 1", async () => {
    const uc = makeApproveUc(async () => {});
    const result = await runApproveTask({}, uc);
    assert.equal(result.exitCode, 1, "exit 1 when --id is missing");
    assert.equal(result.stderr.length, 1, "exactly one error line");
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix; got: ${result.stderr[0]}`,
    );
  });
});

// ---------------------------------------------------------------------------
// runApproveTask S3 (007.4 F3) — discriminated outcome → CLI exit code mapping
// ---------------------------------------------------------------------------

describe("runApproveTask S3 — discriminated approve outcomes", () => {
  // Fake factory for discriminated-return approve use case.
  // Uses double-cast (unknown) so the inline object is accepted by runApproveTask
  // regardless of the current execute() return type.
  function makeApproveUcS3(
    outcome: unknown,
  ): Parameters<typeof runApproveTask>[1] {
    return {
      execute: async (_input: { taskId: string }) => outcome,
    } as unknown as Parameters<typeof runApproveTask>[1];
  }

  test("(S3-cli-conflict) conflict outcome → exit 0 and single actionable stderr line containing 'conflict'", async () => {
    const taskId = "01JZZZZZZZZZZZZZZZZZZZSCLIC";
    const uc = makeApproveUcS3({
      kind: "conflict",
      taskId,
      conflictFiles: ["src/todo.mjs"],
    });

    const result = await runApproveTask({ id: taskId }, uc);

    assert.equal(
      result.exitCode,
      0,
      "conflict outcome must exit 0 (recoverable)",
    );
    assert.equal(
      result.stderr.length,
      1,
      `conflict outcome must emit exactly one stderr line; got: ${JSON.stringify(result.stderr)}`,
    );
    assert.ok(
      result.stderr[0]!.toLowerCase().includes("conflict"),
      `conflict stderr line must mention 'conflict'; got: ${result.stderr[0]}`,
    );
    assert.equal(
      result.stdout.length,
      0,
      "conflict outcome must not write to stdout",
    );
  });

  // S1 (007.5) — conflict message names `retry task --id` and lists conflicting files
  test("(S1-cli-conflict-files) conflict outcome with conflictFiles names recovery command and lists files", async () => {
    const taskId = "01JZZZZZZZZZZZZZZZZZZZS1MSG1";
    const uc = makeApproveUcS3({
      kind: "conflict",
      taskId,
      conflictFiles: ["src/todo.mjs"],
    });

    const result = await runApproveTask({ id: taskId }, uc);

    assert.equal(
      result.exitCode,
      0,
      "conflict outcome must exit 0 (recoverable)",
    );
    assert.equal(
      result.stderr.length,
      1,
      `conflict outcome must emit exactly one stderr line; got: ${JSON.stringify(result.stderr)}`,
    );
    const line = result.stderr[0]!;
    assert.ok(
      line.includes(`retry task --id ${taskId}`),
      `conflict stderr must name 'retry task --id ${taskId}'; got: ${line}`,
    );
    assert.ok(
      line.includes("src/todo.mjs"),
      `conflict stderr must list conflicting file 'src/todo.mjs'; got: ${line}`,
    );
    assert.ok(
      line.toLowerCase().includes("daemon"),
      `conflict stderr must mention 'daemon' (next-step clause); got: ${line}`,
    );
    assert.ok(
      !line.includes("Error") && !line.includes("at "),
      `conflict stderr must not contain a stack trace; got: ${line}`,
    );
    assert.equal(
      result.stdout.length,
      0,
      "conflict outcome must not write to stdout",
    );
  });

  // S1 (007.5) — conflict message degrades gracefully when conflictFiles is empty
  test("(S1-cli-conflict-empty-files) conflict outcome with empty conflictFiles still names recovery command", async () => {
    const taskId = "01JZZZZZZZZZZZZZZZZZZZS1MSG2";
    const uc = makeApproveUcS3({
      kind: "conflict",
      taskId,
      conflictFiles: [],
    });

    const result = await runApproveTask({ id: taskId }, uc);

    assert.equal(result.exitCode, 0, "conflict outcome must exit 0");
    assert.equal(
      result.stderr.length,
      1,
      `conflict outcome must emit exactly one stderr line; got: ${JSON.stringify(result.stderr)}`,
    );
    const line = result.stderr[0]!;
    assert.ok(
      line.includes(`retry task --id ${taskId}`),
      `conflict stderr must name 'retry task --id ${taskId}' even with empty files; got: ${line}`,
    );
    assert.equal(
      result.stdout.length,
      0,
      "conflict outcome must not write to stdout",
    );
  });

  test("(S3-cli-landing-failed) landing_failed outcome → exit 1 and single stderr line starting with 'error:'", async () => {
    const taskId = "01JZZZZZZZZZZZZZZZZZZZSCLLF";
    const uc = makeApproveUcS3({
      kind: "landing_failed",
      taskId,
      message: "landing failed: git fetch error",
      cause: new Error("internal git error"),
    });

    const result = await runApproveTask({ id: taskId }, uc);

    assert.equal(
      result.exitCode,
      1,
      "landing_failed outcome must exit non-zero",
    );
    assert.equal(
      result.stderr.length,
      1,
      `landing_failed must emit exactly one stderr line; got: ${JSON.stringify(result.stderr)}`,
    );
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `landing_failed stderr line must start with 'error:'; got: ${result.stderr[0]}`,
    );
    assert.equal(
      result.stdout.length,
      0,
      "landing_failed must not write to stdout",
    );
  });
});

// ---------------------------------------------------------------------------
// S2 (007.6) — approve conflict outcome enrichment: must hint at get conflict + --note
// ---------------------------------------------------------------------------

describe("runApproveTask S2 — conflict outcome enrichment (007.6)", () => {
  function makeApproveUcS2(
    outcome: unknown,
  ): Parameters<typeof runApproveTask>[1] {
    return {
      execute: async (_input: { taskId: string }) => outcome,
    } as unknown as Parameters<typeof runApproveTask>[1];
  }

  test("(S2-cli-approve-conflict-get-hint) conflict outcome stderr mentions 'get conflict --id'", async () => {
    const taskId = "01JZZZZZZZZZZZZZZZZZZZS2GCH1";
    const uc = makeApproveUcS2({
      kind: "conflict",
      taskId,
      conflictFiles: ["src/todo.mjs"],
    });

    const result = await runApproveTask({ id: taskId }, uc);

    assert.equal(result.exitCode, 0, "conflict outcome must exit 0");
    assert.equal(
      result.stderr.length,
      1,
      `conflict outcome must emit exactly one stderr line; got: ${JSON.stringify(result.stderr)}`,
    );
    const line = result.stderr[0]!;
    assert.ok(
      line.includes(`get conflict --id ${taskId}`),
      `conflict stderr must mention 'get conflict --id ${taskId}' so user knows how to inspect; got: ${line}`,
    );
  });

  test("(S2-cli-approve-conflict-note-hint) conflict outcome stderr mentions '--note' for guided retry", async () => {
    const taskId = "01JZZZZZZZZZZZZZZZZZZZS2NTH2";
    const uc = makeApproveUcS2({
      kind: "conflict",
      taskId,
      conflictFiles: ["src/todo.mjs"],
    });

    const result = await runApproveTask({ id: taskId }, uc);

    assert.equal(result.exitCode, 0, "conflict outcome must exit 0");
    assert.equal(
      result.stderr.length,
      1,
      `conflict outcome must emit exactly one stderr line; got: ${JSON.stringify(result.stderr)}`,
    );
    const line = result.stderr[0]!;
    assert.ok(
      line.includes("--note"),
      `conflict stderr must include '--note' to hint at guided retry; got: ${line}`,
    );
    assert.ok(
      !line.includes("Error") && !line.includes("at "),
      `conflict stderr must not contain a stack trace; got: ${line}`,
    );
  });
});

// ---------------------------------------------------------------------------
// S4 (007.6) — approve target_moved outcome → CLI mapping
// ---------------------------------------------------------------------------

describe("runApproveTask S4 — target_moved outcome", () => {
  function makeApproveUcS4(
    outcome: unknown,
  ): Parameters<typeof runApproveTask>[1] {
    return {
      execute: async (_input: { taskId: string }) => outcome,
    } as unknown as Parameters<typeof runApproveTask>[1];
  }

  test("(S4-cli-target-moved) target_moved outcome: exit 0; single informational stderr line", async () => {
    const taskId = "01JZZZZZZZZZZZZZZZZZZZS4TM1";
    const uc = makeApproveUcS4({
      kind: "target_moved",
      taskId,
    });

    const result = await runApproveTask({ id: taskId }, uc);

    assert.equal(
      result.exitCode,
      0,
      "target_moved outcome must exit 0 (retryable — user can re-approve)",
    );
    assert.equal(
      result.stderr.length,
      1,
      `target_moved must emit exactly one stderr line; got: ${JSON.stringify(result.stderr)}`,
    );
    const line = result.stderr[0]!;
    assert.ok(
      !line.includes("Error") && !line.includes("at "),
      `target_moved stderr must not contain a stack trace; got: ${line}`,
    );
    assert.equal(
      result.stdout.length,
      0,
      "target_moved must not write to stdout",
    );
  });
});

// ---------------------------------------------------------------------------
// runRejectTask — Story 07 T2 CLI (g)
// ---------------------------------------------------------------------------

describe("runRejectTask", () => {
  type RejectInput = {
    taskId: string;
    resolution: "retry" | "discard";
    reason?: string;
  };

  // Inline fake for RejectTask duck-typed interface
  function makeRejectUc(onExecute: (input: RejectInput) => Promise<void>): {
    execute(input: RejectInput): Promise<void>;
  } {
    return { execute: onExecute };
  }

  test("runRejectTask --resolution retry: returns exit 0", async () => {
    const uc = makeRejectUc(async () => {});
    const result = await runRejectTask(
      { id: "01JZZZZZZZZZZZZZZZZZZZTSKREJECT", resolution: "retry" },
      uc as Parameters<typeof runRejectTask>[1],
    );
    assert.equal(result.exitCode, 0, "exit 0 on success");
  });

  test("runRejectTask missing --resolution: returns exit 1 with one error line (g)", async () => {
    const uc = makeRejectUc(async () => {});
    const result = await runRejectTask(
      { id: "01JZZZZZZZZZZZZZZZZZZZTSKREJECT" },
      uc as Parameters<typeof runRejectTask>[1],
    );
    assert.equal(result.exitCode, 1, "exit 1 when --resolution is missing");
    assert.equal(result.stderr.length, 1, "exactly one error line");
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix; got: ${result.stderr[0]}`,
    );
    assert.equal(result.stdout.length, 0, "no stdout on error");
  });

  test("runRejectTask invalid --resolution badval: returns exit 1 with one error line (g)", async () => {
    const uc = makeRejectUc(async () => {});
    const result = await runRejectTask(
      { id: "01JZZZZZZZZZZZZZZZZZZZTSKREJECT", resolution: "badval" },
      uc as Parameters<typeof runRejectTask>[1],
    );
    assert.equal(result.exitCode, 1, "exit 1 for invalid --resolution value");
    assert.equal(result.stderr.length, 1, "exactly one error line");
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix; got: ${result.stderr[0]}`,
    );
    assert.equal(result.stdout.length, 0, "no stdout on error");
  });
});

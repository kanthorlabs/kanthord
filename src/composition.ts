// Composition factory — extracted from main.ts so tests can instantiate deps
// without launching a process. Only this file (and main.ts) import concrete adapters.
import { dirname, join, resolve } from "node:path";
import { access } from "node:fs/promises";
import type { CliDeps } from "./apps/cli/deps.ts";
import { openDatabase } from "./storage/sqlite/open.ts";
import { SqliteStatusStore } from "./storage/sqlite/sqlite-status-store.ts";
import { SqliteMigrator } from "./storage/sqlite/sqlite-migrator.ts";
import { MIGRATIONS } from "./storage/sqlite/migrations.ts";
import { MigrateDb } from "./app/db/migrate-db.ts";
import { GetDbStatus } from "./app/db/get-db-status.ts";
import { SqliteProjectRepository } from "./storage/sqlite/sqlite-project-repository.ts";
import { SqliteInitiativeRepository } from "./storage/sqlite/sqlite-initiative-repository.ts";
import { SqliteTaskRepository } from "./storage/sqlite/sqlite-task-repository.ts";
import { SqliteReferenceResolver } from "./storage/sqlite/reference-resolver.ts";
import { SqliteTransactor } from "./storage/sqlite/sqlite-transactor.ts";
import { SqliteEventFeed } from "./events/sqlite.ts";
import { newEvent, type Event, type EventType } from "./domain/event.ts";
import { CreateProject } from "./app/project/create-project.ts";
import { RenameProject } from "./app/project/rename-project.ts";
import { GetProject } from "./app/project/get-project.ts";
import { FindProject } from "./app/project/find-project.ts";
import { CreateInitiative } from "./app/initiative/create-initiative.ts";
import { RenameInitiative } from "./app/initiative/rename-initiative.ts";
import { FindInitiative } from "./app/initiative/find-initiative.ts";
import { PauseInitiative } from "./app/initiative/pause-initiative.ts";
import { ResumeInitiative } from "./app/initiative/resume-initiative.ts";
import { CreateObjective } from "./app/objective/create-objective.ts";
import { RenameObjective } from "./app/objective/rename-objective.ts";
import { FindObjective } from "./app/objective/find-objective.ts";
import { AddResource } from "./app/resource/add-resource.ts";
import { FindResource } from "./app/resource/find-resource.ts";
import { GetResource } from "./app/resource/get-resource.ts";
import { ImportResources } from "./app/resource/import-resources.ts";
import { UpdateAiProvider } from "./app/resource/update-ai-provider.ts";
import { UpdateCredential } from "./app/resource/update-credential.ts";
import { UpdateRepository } from "./app/resource/update-repository.ts";
import { UpdateNotification } from "./app/resource/update-notification.ts";
import { UpdateFilesystem } from "./app/resource/update-filesystem.ts";
import { CreateTask } from "./app/task/create-task.ts";
import { AddDependency } from "./app/task/add-dependency.ts";
import { RemoveDependency } from "./app/task/remove-dependency.ts";
import { ListTasks } from "./app/task/list-tasks.ts";
import { RetryTask } from "./app/task/retry-task.ts";
import { SqliteJobQueue } from "./queue/sqlite.ts";
import { SqliteUnitOfWork } from "./storage/sqlite/sqlite-unit-of-work.ts";
import type { AgentRunner } from "./agent-runner/port.ts";
import { FakeRunner } from "./agent-runner/fake.ts";
import { PiAgentRunner } from "./agent-runner/pi.ts";
import {
  PiProviderSessionFactory,
  type ProviderSessionFactory,
} from "./agent-runner/pi-session.ts";
import { genericProfile } from "./agent-runner/pi-profile.ts";
import { RegistryRunnerResolver } from "./agent-runner/resolver.ts";
import { LocalWorkspaceManager } from "./workspace/local.ts";
import { RepoInstructionLoader } from "./instruction/repo.ts";
import { EnqueueReadyTasks } from "./app/task/enqueue-ready-tasks.ts";
import { RecoverInterruptedTasks } from "./app/task/recover-interrupted-tasks.ts";
import { RunNextTask } from "./app/task/run-next-task.ts";
import { RunDaemon } from "./app/task/run-daemon.ts";
import { ListEvents } from "./app/task/list-events.ts";
import { GetTask } from "./app/task/get-task.ts";
import { ApproveTask } from "./app/task/approve-task.ts";
import { RejectTask } from "./app/task/reject-task.ts";
import { ExportInitiative } from "./app/graph/export-initiative.ts";
import { CreateGraph } from "./app/graph/create-graph.ts";
import { ApplyGraph } from "./app/graph/apply-graph.ts";
import { ListInitiatives } from "./app/initiative/list-initiatives.ts";
import { ListObjectives } from "./app/objective/list-objectives.ts";
import { StoreGraph } from "./app/graph/store-graph.ts";
import { SqliteGraphImportMap } from "./storage/sqlite/sqlite-graph-import-map.ts";
import { newId } from "./domain/entity.ts";
import { promoteProposal } from "./workspace/local.ts";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createInterface } from "node:readline/promises";
import type { ModelInfo } from "./apps/cli/models.ts";
import { PiOAuthLoginProvider } from "./oauth/pi.ts";
import { LoginProvider } from "./app/auth/login-provider.ts";
import type { ModelCatalog } from "./model-catalog/port.ts";
import { PiModelCatalog } from "./model-catalog/pi.ts";
import { StdoutLogger } from "./logger/stdout.ts";
import { NullLogger } from "./logger/null.ts";
import type { Logger } from "./logger/port.ts";
import { DiagnosticsExport } from "./app/observability/diagnostics-export.ts";
import { SqliteObservabilityRefs } from "./storage/sqlite/sqlite-observability-refs.ts";
import { writeFile } from "node:fs/promises";
import { GitRepositoryLanding } from "./landing/git.ts";
import { SqliteLandingRepository } from "./storage/sqlite/landing.ts";
import { isRepository } from "./domain/resource.ts";

/**
 * Build the agent-lifecycle event emitter used by the pi runner.
 * Emits structured lines to the logger for human-visible progress while still
 * appending the raw event to the feed (the line and the feed are decoupled).
 * Exported for unit testing the accounting line (Story 02 T1).
 */
export function buildEmitCallback(
  logger: Logger,
  events: { append(event: Event): void },
): (taskId: string, type: EventType, payload: Record<string, string>) => void {
  return (taskId, type, payload) => {
    if (type === "agent.started") {
      logger.info(`task ${taskId}: agent started`);
    } else if (type === "agent.finished") {
      logger.info(
        `task ${taskId}: agent finished: turns=${payload.turns} tokensIn=${payload.tokensIn} tokensOut=${payload.tokensOut}`,
      );
    } else if (type === "task.verification") {
      const phase = (payload as Record<string, unknown>).phase;
      if (phase === "start") {
        logger.info(`task ${taskId}: verification started`);
      } else if (phase === "end") {
        logger.info(`task ${taskId}: verification ended`);
      }
    }
    return events.append(newEvent(type, { taskId, payload }));
  };
}

/**
 * Wire all concrete adapters and return the `CliDeps` bundle.
 * Called once at program start (and by integration tests).
 */
export function buildDeps(
  dbPath: string,
  opts?: { maxTurns?: number; sessionFactory?: ProviderSessionFactory },
): CliDeps {
  const db = openDatabase(dbPath);
  const migrator = new SqliteMigrator(db, MIGRATIONS);
  const store = new SqliteStatusStore(db, dbPath);
  const migrateDb = new MigrateDb(migrator);
  const getDbStatus = new GetDbStatus(store);
  const projectRepository = new SqliteProjectRepository(db);
  const initiativeRepository = new SqliteInitiativeRepository(db);
  const taskRepository = new SqliteTaskRepository(db);
  const referenceResolver = new SqliteReferenceResolver(db);
  const events = new SqliteEventFeed(db);
  const transactor = new SqliteTransactor(db);
  const jobQueue = new SqliteJobQueue(db);
  const unitOfWork = new SqliteUnitOfWork(db);

  const createProject = new CreateProject(projectRepository);
  const renameProject = new RenameProject(projectRepository);
  const getProject = new GetProject(projectRepository);
  const findProject = new FindProject(projectRepository);
  const createInitiative = new CreateInitiative(
    initiativeRepository,
    referenceResolver,
  );
  const renameInitiative = new RenameInitiative(initiativeRepository);
  const findInitiative = new FindInitiative(initiativeRepository);
  const pauseInitiative = new PauseInitiative(
    initiativeRepository,
    referenceResolver,
  );
  const resumeInitiative = new ResumeInitiative(
    initiativeRepository,
    referenceResolver,
  );
  const createObjective = new CreateObjective(
    initiativeRepository,
    referenceResolver,
  );
  const renameObjective = new RenameObjective(initiativeRepository);
  const findObjective = new FindObjective(initiativeRepository);
  const listModels = (provider?: string): ModelInfo[] =>
    builtinModels()
      .getModels(provider)
      .map((m) => ({
        provider: m.provider,
        id: m.id,
        name: m.name,
        reasoning: m.reasoning,
        contextWindow: m.contextWindow,
      }));
  const modelCatalog: ModelCatalog = new PiModelCatalog(listModels);
  const addResource = new AddResource(
    projectRepository,
    referenceResolver,
    modelCatalog,
  );
  const findResource = new FindResource(projectRepository);
  const getResource = new GetResource(projectRepository);
  const homePathExists = async (path: string): Promise<boolean> => {
    if (!path) return false;
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  };
  const updateAiProvider = new UpdateAiProvider(
    projectRepository,
    modelCatalog,
  );
  const updateCredential = new UpdateCredential(projectRepository);
  const updateRepository = new UpdateRepository(
    projectRepository,
    homePathExists,
  );
  const updateNotification = new UpdateNotification(projectRepository);
  const updateFilesystem = new UpdateFilesystem(projectRepository);
  const importResources = new ImportResources(
    projectRepository,
    referenceResolver,
    unitOfWork,
  );
  const agentCatalog = {
    has: (ref: string) => ref === "generic@1" || ref === "fake@1",
  };
  const createTask = new CreateTask(
    taskRepository,
    initiativeRepository,
    projectRepository,
    referenceResolver,
    agentCatalog,
  );
  const addDependency = new AddDependency(
    taskRepository,
    initiativeRepository,
    referenceResolver,
    events,
    transactor,
  );
  const removeDependency = new RemoveDependency(
    taskRepository,
    initiativeRepository,
    referenceResolver,
    events,
    transactor,
  );
  const listTasks = new ListTasks(taskRepository);
  const listInitiatives = new ListInitiatives(initiativeRepository);
  const listObjectives = new ListObjectives(initiativeRepository);
  const exportInitiative = new ExportInitiative({
    tasks: taskRepository,
    initiatives: initiativeRepository,
  });
  const importMap = new SqliteGraphImportMap(db);
  const storeGraph = new StoreGraph(taskRepository);
  const createGraph = new CreateGraph({
    initiatives: initiativeRepository,
    tasks: taskRepository,
    storeGraph,
    projects: projectRepository,
    importMap,
    uow: unitOfWork,
    newId,
  });
  const applyGraph = new ApplyGraph({
    initiatives: initiativeRepository,
    tasks: taskRepository,
    storeGraph,
    importMap,
    uow: unitOfWork,
    newId,
  });
  const listEvents = new ListEvents(events);
  const getTask = new GetTask(taskRepository, taskRepository, taskRepository);
  const rejectTask = new RejectTask(
    taskRepository,
    jobQueue,
    events,
    unitOfWork,
  );
  // Constructed here (above RetryTask) so it can be passed as the 6th
  // ConflictCandidateStore argument — it is also referenced later for
  // repoLanding, approveTask, and RunNextTask (all closures or sequential
  // assignments that reference it after this point).
  const landingRepository = new SqliteLandingRepository(db);
  const retryTask = new RetryTask(
    taskRepository,
    jobQueue,
    events,
    unitOfWork,
    referenceResolver,
    landingRepository,
  );

  function buildDaemon(failTaskIds: string[], logger?: Logger): RunDaemon {
    const effectiveLogger: Logger = logger ?? new NullLogger();
    const fakeRunner = new FakeRunner({ failTaskIds });

    // Save updated credential value (for OAuth refresh) directly into the resources table.
    const saveCredentialValue = (credentialId: string, value: string): void => {
      const existing = projectRepository.getResource(credentialId);
      if (!existing) return;
      const { id: _id, type: _type, name: _name, ...attrs } = existing;
      const newAttrs = JSON.stringify({ ...attrs, value });
      db.prepare("UPDATE resources SET attributes = ? WHERE id = ?").run(
        newAttrs,
        credentialId,
      );
    };

    const sessions =
      opts?.sessionFactory ??
      new PiProviderSessionFactory({ saveCredentialValue });
    const piRunner = new PiAgentRunner({
      sessions,
      workspaces,
      newInstructionLoader: (dir) => new RepoInstructionLoader(dir),
      getResource: (id) => projectRepository.getResource(id),
      profiles: new Map([["generic@1", genericProfile]]),
      maxTurns: opts?.maxTurns,
      emit: buildEmitCallback(effectiveLogger, events),
      getPriorRejection: (taskId) => {
        const result = taskRepository.getTaskResult(taskId);
        if (!result?.rejectionReason) return undefined;
        return {
          reason: result.rejectionReason,
          summary: result.summary ?? undefined,
          proposalCommit: result.proposalCommit ?? undefined,
        };
      },
    });

    const runners = new Map<string, AgentRunner>([
      ["generic@1", piRunner],
      ["fake@1", fakeRunner],
    ]);
    const resolver = new RegistryRunnerResolver({ runners });
    const enqueueReady = new EnqueueReadyTasks(
      initiativeRepository,
      taskRepository,
      jobQueue,
      events,
      unitOfWork,
    );
    const recover = new RecoverInterruptedTasks(
      jobQueue,
      taskRepository,
      events,
      unitOfWork,
    );
    const runNext = new RunNextTask(
      jobQueue,
      taskRepository,
      events,
      unitOfWork,
      resolver,
      landingRepository,
    );
    return new RunDaemon({
      recover,
      enqueueReady,
      runNext,
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      logger: effectiveLogger,
    });
  }

  const observabilityRefs = new SqliteObservabilityRefs(db);
  const diagnosticsExport = new DiagnosticsExport(
    events,
    taskRepository,
    observabilityRefs,
    async (path, data, opts) => {
      await writeFile(path, data, { mode: opts.mode });
    },
  );

  // Lock files live in the same directory as the database (always exists).
  const lockDir = dirname(dbPath);
  const repoLanding = new GitRepositoryLanding(lockDir, landingRepository, {
    name: "kanthord",
    email: "kanthord@localhost",
  });
  const resolveHomeDir = (repoId: string): string => {
    const resource = projectRepository.getResource(repoId);
    if (!resource || !isRepository(resource)) {
      throw new Error(`no repository resource found for id: ${repoId}`);
    }
    return resource.path;
  };

  // Shared workspace manager — used by both the daemon runner and the
  // approve-landing path so homeDir(repoId) resolves the same canonical mirror.
  const workspaceRoot = resolve(
    process.env["KANTHORD_WORKSPACE_ROOT"] ??
      join(dirname(dbPath), "workspaces"),
  );
  const workspaces = new LocalWorkspaceManager({
    root: workspaceRoot,
    lockDir,
  });

  // Wire the real ApproveTask WITH landing: the RepositoryLanding adapter
  // (Story 05 T3) plus the persisted candidate store + workspace manager so a
  // repository-bound approve lands onto the configured branch of the home repo.
  const approveTask = new ApproveTask(
    taskRepository,
    jobQueue,
    events,
    unitOfWork,
    promoteProposal,
    repoLanding,
    landingRepository,
    workspaces,
    resolveHomeDir,
  );

  const logger = new StdoutLogger();

  const loginProvider = new LoginProvider({
    oauth: new PiOAuthLoginProvider(),
    projects: projectRepository,
    resolver: referenceResolver,
  });
  const login = {
    loginProvider,
    io: {
      print: (message: string) => process.stdout.write(`${message}\n`),
      prompt: async (message: string) => {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        try {
          return await rl.question(`${message} `);
        } finally {
          rl.close();
        }
      },
    },
  };

  return {
    migrateDb,
    getDbStatus,
    createProject,
    renameProject,
    getProject,
    findProject,
    createInitiative,
    renameInitiative,
    findInitiative,
    pauseInitiative,
    resumeInitiative,
    createObjective,
    renameObjective,
    findObjective,
    addResource,
    findResource,
    getResource,
    updateAiProvider,
    updateCredential,
    updateRepository,
    updateNotification,
    updateFilesystem,
    createTask,
    addDependency,
    removeDependency,
    listTasks,
    retryTask,
    getTask,
    approveTask,
    rejectTask,
    buildDaemon,
    logger,
    listEvents,
    importResources,
    exportInitiative,
    createGraph,
    applyGraph,
    listInitiatives,
    listObjectives,
    login,
    listModels,
    diagnosticsExport,
    repoLanding,
    resolveHomeDir,
    workspaces,
    newId,
  };
}

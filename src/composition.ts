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
import { SqliteSequencingRepository } from "./storage/sqlite/sqlite-sequencing-repository.ts";
import { SqliteReferenceResolver } from "./storage/sqlite/reference-resolver.ts";
import { SqliteTransactor } from "./storage/sqlite/sqlite-transactor.ts";
import { SqliteEventFeed } from "./events/sqlite.ts";
import { newEvent, type Event, type EventType } from "./domain/event.ts";
import type { Task } from "./domain/task.ts";
import type { Objective } from "./domain/initiative.ts";
import type { TaskResultRow } from "./storage/port.ts";
import { CreateProject } from "./app/project/create-project.ts";
import { RenameProject } from "./app/project/rename-project.ts";
import { GetProject } from "./app/project/get-project.ts";
import { FindProject } from "./app/project/find-project.ts";
import { ListProjects } from "./app/project/list-projects.ts";
import { ProbeAiProvider } from "./app/project/probe-ai-provider.ts";
import { CheckProject } from "./app/project/check-project.ts";
import { ObserveSetupFacts } from "./app/project/observe-setup-facts.ts";
import { CreateInitiative } from "./app/initiative/create-initiative.ts";
import { AddInitiativeDependency } from "./app/initiative/add-initiative-dependency.ts";
import { RemoveInitiativeDependency } from "./app/initiative/remove-initiative-dependency.ts";
import { RenameInitiative } from "./app/initiative/rename-initiative.ts";
import { FindInitiative } from "./app/initiative/find-initiative.ts";
import { GetInitiative } from "./app/initiative/get-initiative.ts";
import { GetInitiativeGraph } from "./app/initiative/get-initiative-graph.ts";
import { PauseInitiative } from "./app/initiative/pause-initiative.ts";
import { ResumeInitiative } from "./app/initiative/resume-initiative.ts";
import { GetProjectOverview } from "./app/project/get-project-overview.ts";
import { GetDecisionQueue } from "./app/project/get-decision-queue.ts";
import { CreateObjective } from "./app/objective/create-objective.ts";
import { AddObjectiveDependency } from "./app/objective/add-objective-dependency.ts";
import { RemoveObjectiveDependency } from "./app/objective/remove-objective-dependency.ts";
import { RenameObjective } from "./app/objective/rename-objective.ts";
import { FindObjective } from "./app/objective/find-objective.ts";
import { GetObjective } from "./app/objective/get-objective.ts";
import { GetObjectiveConflict } from "./app/objective/get-objective-conflict.ts";
import { AddResource } from "./app/resource/add-resource.ts";
import { FindResource } from "./app/resource/find-resource.ts";
import { GetResource } from "./app/resource/get-resource.ts";
import { ListResources } from "./app/resource/list-resources.ts";
import { ImportResources } from "./app/resource/import-resources.ts";
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
import type { AgentRunner, ResolvedProvider } from "./agent-runner/port.ts";
import { FakeRunner } from "./agent-runner/fake.ts";
import { PiAgentRunner } from "./agent-runner/pi.ts";
import {
  PiProviderSessionFactory,
  type ProviderSessionFactory,
} from "./agent-runner/pi-session.ts";
import { PiProviderProbe } from "./agent-runner/pi-provider-probe.ts";
import { toResolvedProvider } from "./agent-runner/resolved-provider.ts";
import { genericProfile } from "./agent-runner/pi-profile.ts";
import { RegistryRunnerResolver } from "./agent-runner/resolver.ts";
import { LocalWorkspaceManager } from "./workspace/local.ts";
import { RepoInstructionLoader } from "./instruction/repo.ts";
import { EnqueueReadyTasks } from "./app/task/enqueue-ready-tasks.ts";
import { RecoverInterruptedTasks } from "./app/task/recover-interrupted-tasks.ts";
import { RunNextTask } from "./app/task/run-next-task.ts";
import { RunDaemon } from "./app/task/run-daemon.ts";
import { SettleObjectives } from "./app/objective/settle-objectives.ts";
import { ListEvents } from "./app/task/list-events.ts";
import { GetTask } from "./app/task/get-task.ts";
import { ApproveTask } from "./app/task/approve-task.ts";
import { RejectTask } from "./app/task/reject-task.ts";
import { AbandonTask } from "./app/task/abandon-task.ts";
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
import { PinoLogger } from "./logger/pino.ts";
import type { Logger } from "./logger/port.ts";
import { DiagnosticsExport } from "./app/observability/diagnostics-export.ts";
import { SqliteObservabilityRefs } from "./storage/sqlite/sqlite-observability-refs.ts";
import { writeFile } from "node:fs/promises";
import { execFile as execFileCb, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);
import { GitRepositoryLanding } from "./landing/git.ts";
import { GetConflict } from "./app/task/get-conflict.ts";
import { SqliteLandingRepository } from "./storage/sqlite/landing.ts";
import { SqlitePublicationRepository } from "./storage/sqlite/publication.ts";
import { SqliteProjectAckRepository } from "./storage/sqlite/project-ack.ts";
import { AckProject } from "./app/project/ack-project.ts";
import { SqliteAiProviderRegistry } from "./storage/sqlite/ai-provider-registry.ts";
import { SqliteDaemonHeartbeatRepository } from "./storage/sqlite/daemon-heartbeat-repository.ts";
import {
  heartbeatAgeMs,
  resolveIntervalMs,
  resolveStaleMs,
  startHeartbeat,
} from "./app/task/daemon-heartbeat.ts";
import { GitRepositoryProbe } from "./repository-probe/git.ts";
import { RegisterAiProvider } from "./app/ai-provider/register-ai-provider.ts";
import { UpdateAiProvider } from "./app/ai-provider/update-ai-provider.ts";
import { registerGlobalProvider } from "./app/ai-provider/register-global-provider.ts";
import { GetAiProvider } from "./app/ai-provider/get-ai-provider.ts";
import { ListAiProviders } from "./app/ai-provider/list-ai-providers.ts";
import { SetDefaultAiProvider } from "./app/ai-provider/set-default-ai-provider.ts";
import { LogoutAiProvider } from "./app/ai-provider/logout-ai-provider.ts";
import { RemoveAiProvider } from "./app/ai-provider/remove-ai-provider.ts";
import { AssignAiProvider } from "./app/ai-provider/assign-ai-provider.ts";
import { UnassignAiProvider } from "./app/ai-provider/unassign-ai-provider.ts";
import { ResolveProjectChain } from "./app/ai-provider/resolve-project-chain.ts";
import { TestAiProvider } from "./app/ai-provider/test-ai-provider.ts";
import { GitRepositoryPublisher } from "./publication/git.ts";
import { PublishRepository } from "./app/repository/publish-repository.ts";
import { isRepository } from "./domain/resource.ts";
import { resolveProviderChain } from "./domain/resolve-provider-chain.ts";
import { ApproveObjective } from "./app/objective/approve-objective.ts";
import { RetryObjective } from "./app/objective/retry-objective.ts";
import { RejectObjective } from "./app/objective/reject-objective.ts";
import { GitObjectiveBroker } from "./objective-broker/git.ts";
import { GitCommitPresence } from "./commit-presence/git.ts";

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
  const sequencingRepository = new SqliteSequencingRepository(db);
  const projectAckRepository = new SqliteProjectAckRepository(db);

  const createProject = new CreateProject(projectRepository);
  const renameProject = new RenameProject(projectRepository);
  const getProject = new GetProject(projectRepository);
  const findProject = new FindProject(projectRepository);
  const listProjects = new ListProjects(projectRepository);
  const ackProject = new AckProject(projectAckRepository, {
    get: (id) => projectRepository.get(id),
  });
  const createInitiative = new CreateInitiative(
    initiativeRepository,
    referenceResolver,
    sequencingRepository,
    transactor,
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
    sequencingRepository,
    transactor,
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
  const addResource = new AddResource(projectRepository, referenceResolver);
  const findResource = new FindResource(projectRepository);
  const publicationRepository = new SqlitePublicationRepository(db);
  const aiProviderRegistry = new SqliteAiProviderRegistry(db);
  // EPIC 015 Story 1 — fact collector for the guided setup wizard. Sits
  // next to the other project use cases; consumes three repos/registries
  // and synthesises the `ObservedFacts` value the pure `SetupPlan` decides
  // against. No other use case depends on it yet; it is wired here so the
  // executor in Story 4 can read it from `deps.observeSetupFacts`.
  const observeSetupFacts = new ObserveSetupFacts(
    projectRepository,
    initiativeRepository,
    aiProviderRegistry,
  );
  const registerAiProvider = new RegisterAiProvider(
    aiProviderRegistry,
    unitOfWork,
    modelCatalog,
    undefined, // warn
    registerGlobalProvider, // BLOCKER 9: route through shared helper
  );
  const updateAiProvider = new UpdateAiProvider(
    aiProviderRegistry,
    unitOfWork,
    modelCatalog,
  );
  const getAiProvider = new GetAiProvider(aiProviderRegistry);
  const listAiProviders = new ListAiProviders(aiProviderRegistry);
  const setDefaultAiProvider = new SetDefaultAiProvider(aiProviderRegistry);
  const logoutAiProvider = new LogoutAiProvider(aiProviderRegistry, unitOfWork);
  const removeAiProvider = new RemoveAiProvider(aiProviderRegistry, unitOfWork);
  const assignAiProvider = new AssignAiProvider(
    aiProviderRegistry,
    referenceResolver,
    unitOfWork,
  );
  const unassignAiProvider = new UnassignAiProvider(
    aiProviderRegistry,
    referenceResolver,
    unitOfWork,
  );
  const resolveProjectChain = new ResolveProjectChain(
    aiProviderRegistry,
    referenceResolver,
  );

  const logger = new StdoutLogger();

  const sessions: ProviderSessionFactory =
    opts?.sessionFactory ??
    new PiProviderSessionFactory({ registry: aiProviderRegistry, logger });

  const probe = new PiProviderProbe(aiProviderRegistry, sessions);
  const testAiProvider = new TestAiProvider(probe);
  const probeAiProvider = new ProbeAiProvider(
    testAiProvider,
    (id) => aiProviderRegistry.get(id)?.value ?? null,
  );
  const getResource = new GetResource(projectRepository, publicationRepository);
  const listResources = new ListResources(projectRepository);
  const homePathExists = async (path: string): Promise<boolean> => {
    if (!path) return false;
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  };
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
    events,
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
  const addInitiativeDependency = new AddInitiativeDependency(
    initiativeRepository,
    taskRepository,
    sequencingRepository,
    referenceResolver,
    transactor,
  );
  const removeInitiativeDependency = new RemoveInitiativeDependency(
    initiativeRepository,
    taskRepository,
    sequencingRepository,
    referenceResolver,
    transactor,
  );
  const addObjectiveDependency = new AddObjectiveDependency(
    initiativeRepository,
    taskRepository,
    sequencingRepository,
    referenceResolver,
    transactor,
  );
  const removeObjectiveDependency = new RemoveObjectiveDependency(
    initiativeRepository,
    taskRepository,
    sequencingRepository,
    referenceResolver,
    transactor,
  );
  const listTasks = new ListTasks(taskRepository, {
    get: (id) => initiativeRepository.get(id),
  });
  const listInitiatives = new ListInitiatives(initiativeRepository);
  const listObjectives = new ListObjectives(initiativeRepository);
  const exportInitiative = new ExportInitiative(
    {
      tasks: taskRepository,
      initiatives: initiativeRepository,
    },
    sequencingRepository,
  );
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
    sequencing: sequencingRepository,
  });
  const applyGraph = new ApplyGraph({
    initiatives: initiativeRepository,
    tasks: taskRepository,
    storeGraph,
    importMap,
    uow: unitOfWork,
    newId,
    sequencing: sequencingRepository,
  });
  const listEvents = new ListEvents(events);
  // Constructed here (above GetTask/RetryTask) so it can be passed as the 4th
  // GetTask arg and the 6th ConflictCandidateStore argument — it is also
  // referenced later for repoLanding, approveTask, and RunNextTask (all
  // closures or sequential assignments that reference it after this point).
  const landingRepository = new SqliteLandingRepository(db);
  const getTask = new GetTask(
    taskRepository,
    taskRepository,
    taskRepository,
    landingRepository,
    jobQueue,
    { getObjective: (id) => initiativeRepository.getObjective(id) },
  );
  const rejectTask = new RejectTask(
    {
      get: (id) => taskRepository.get(id),
      save: (task) => taskRepository.save(task),
      getTaskResult: (id) => taskRepository.getTaskResult(id),
      saveTaskResult: (id, row) => taskRepository.saveTaskResult(id, row),
      listByInitiative: (initiativeId) =>
        taskRepository.listByInitiative(initiativeId),
      getInitiativeId: (id) => taskRepository.getInitiativeId(id),
      getObjective: (id) => initiativeRepository.getObjective(id),
      saveObjective: (objective) =>
        initiativeRepository.saveObjective(objective),
      listObjectives: (initiativeId) =>
        initiativeRepository.listObjectives(initiativeId),
      getInitiative: (initiativeId) => initiativeRepository.get(initiativeId),
      saveInitiative: (initiative) => initiativeRepository.save(initiative),
      listInitiativesByProject: (projectId) =>
        initiativeRepository.listInitiatives(projectId),
      getProjectId: (initiativeId) =>
        initiativeRepository.get(initiativeId)?.projectId,
      listInitiativeAfter: (initiativeId) =>
        sequencingRepository.listInitiativeAfter(initiativeId),
      listObjectiveAfter: (objectiveId) =>
        sequencingRepository.listObjectiveAfter(objectiveId),
    },
    jobQueue,
    events,
    unitOfWork,
  );
  // EPIC 013 Story 6 — `abandon task` use case. Operator-driven revocation
  // of a `running` task's lease; the runner drains at its next turn
  // boundary and Story 4's requeue + `task.abandoned` event closes the loop.
  const abandonTask = new AbandonTask(
    { get: (id) => taskRepository.get(id) },
    jobQueue,
    unitOfWork,
  );
  const retryTask = new RetryTask(
    taskRepository,
    jobQueue,
    events,
    unitOfWork,
    referenceResolver,
    landingRepository,
  );

  // S3 (007.6): shared feedback hook — reads the note persisted by retryTask.execute.
  // Exposed in the returned deps so callers and tests can invoke it directly.
  const getPriorFeedback = (
    taskId: string,
  ):
    | { note?: string; conflictContext?: string; priorSummary?: string }
    | undefined => {
    const task = taskRepository.get(taskId);
    if (!task?.note) return undefined;
    return { note: task.note };
  };

  function buildDaemon(
    failTaskIds: string[],
    failTransient?: Record<string, number>,
    logger?: Logger,
  ): RunDaemon {
    const effectiveLogger: Logger = logger ?? new NullLogger();
    const fakeRunner = new FakeRunner({ failTaskIds, failTransient });
    const piRunner = new PiAgentRunner({
      sessions,
      workspaces,
      newInstructionLoader: (dir) => new RepoInstructionLoader(dir),
      getResource: (id) => projectRepository.getResource(id),
      profiles: new Map([["generic@1", genericProfile]]),
      maxTurns: opts?.maxTurns,
      emit: buildEmitCallback(effectiveLogger, events),
      getPriorFeedback,
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
      sequencingRepository,
    );
    const recover = new RecoverInterruptedTasks(
      jobQueue,
      taskRepository,
      events,
      unitOfWork,
    );
    // Story B objective-boundary squash — `taskRepository` (SqliteTaskRepository)
    // does not itself implement the objective read/write/parent-OID seam
    // `RunNextTask` needs, so wrap it with the three extra methods, delegating
    // objective persistence to `initiativeRepository` (already the Story B/C
    // persistence owner) and the rest straight through to `taskRepository`.
    const taskStoreWithObjectives = {
      get: (id: string) => taskRepository.get(id),
      save: (task: Task) => taskRepository.save(task),
      listByInitiative: (initiativeId: string) =>
        taskRepository.listByInitiative(initiativeId),
      getInitiativeId: (taskId: string) =>
        taskRepository.getInitiativeId(taskId),
      getTaskContext: (taskId: string) => taskRepository.getTaskContext(taskId),
      getRepositoryBranch: (repoId: string) =>
        taskRepository.getRepositoryBranch(repoId),
      saveTaskResult: (taskId: string, row: TaskResultRow) =>
        taskRepository.saveTaskResult(taskId, row),
      getObjective: (id: string) => initiativeRepository.getObjective(id),
      saveObjective: (objective: Objective) =>
        initiativeRepository.saveObjective(objective),
      getObjectiveParentOid,
      listObjectiveAfter: (objectiveId: string) =>
        sequencingRepository.listObjectiveAfter(objectiveId),
    };

    // 008.3 Story A/B — resolve the provider chain from initiative→project.
    const providerChainFor = (initiativeId: string): ResolvedProvider[] => {
      const initiative = initiativeRepository.get(initiativeId);
      if (initiative === undefined) return [];
      const projectId = initiative.projectId;
      const assigned = aiProviderRegistry.listAssigned(projectId);
      const defaultProvider = aiProviderRegistry.getDefault();
      const chain = resolveProviderChain(assigned, defaultProvider);
      return chain.map(toResolvedProvider);
    };

    // BLOCKER 5b: resolve projectId from initiativeId for error messages.
    const getProjectId = (initiativeId: string): string | undefined => {
      const initiative = initiativeRepository.get(initiativeId);
      return initiative?.projectId;
    };

    const runNext = new RunNextTask(
      jobQueue,
      taskStoreWithObjectives,
      events,
      unitOfWork,
      resolver,
      landingRepository,
      {
        initiativeWorkspaces: { ensure: ensureInitiativeWorkspace },
        workspaces,
        sequencing: {
          listObjectiveAfter: (id: string) =>
            sequencingRepository.listObjectiveAfter(id),
        },
        providerChainFor,
        getProjectId,
      },
    );
    // B2 — startup sweep for objectives a crashed run left mid-integration.
    const settleObjectives = new SettleObjectives(
      {
        listAllInitiatives: () => initiativeRepository.listAllInitiatives(),
        get: (id: string) => initiativeRepository.get(id),
        listObjectives: (initiativeId: string) =>
          initiativeRepository.listObjectives(initiativeId),
      },
      {
        listTasksByObjective: (objectiveId: string) =>
          taskRepository.listTasksByObjective(objectiveId),
      },
      {
        getObjective: (id: string) => initiativeRepository.getObjective(id),
        saveObjective: (objective: Objective) =>
          initiativeRepository.saveObjective(objective),
        getObjectiveParentOid,
      },
      workspaces,
      events,
    );

    return new RunDaemon({
      recover,
      enqueueReady,
      runNext,
      settleObjectives,
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      logger: effectiveLogger,
      initiatives: initiativeRepository,
      store: {
        getInitiativeId: (taskId: string) =>
          taskRepository.getInitiativeId(taskId),
        getTaskResult: (taskId: string) => taskRepository.getTaskResult(taskId),
      },
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

  const resolveTargetOID = async (
    homeDir: string,
    branch: string,
  ): Promise<string> => {
    const { stdout } = await execFile(
      "git",
      ["rev-parse", `refs/heads/${branch}`],
      { cwd: homeDir },
    );
    return stdout.trim();
  };

  const getConflict = new GetConflict(
    landingRepository,
    repoLanding,
    resolveHomeDir,
    resolveTargetOID,
  );

  // Story 007.13-A — resolves an https-token credential's stored value for
  // GitRepositoryPublisher (mirrors the credential lookup in pi.ts:397-401).
  const resolveCredential = async (credentialId: string): Promise<string> => {
    const cred = projectRepository.getResource(credentialId);
    if (!cred || cred.type !== "credential") {
      throw new Error(`no credential resource found for id: ${credentialId}`);
    }
    return cred.value;
  };

  // EPIC 014 Story 6 — `kanthord check project` wiring. The heartbeat
  // observation table (Story 3) and the read-only repository probe (Story 4)
  // already exist; this turns them into the `CheckProject` fact collector
  // the handler calls. The staleMs comes from the env override or the
  // HEARTBEAT_STALE_MS default; `instances()` reads every row (live and
  // stale) so the `daemon` check can derive `running` / `stopped` / `multiple`
  // from age against the threshold.
  //
  // The heartbeat repository is constructed LAZILY on first `instances()` call:
  // `SqliteDaemonHeartbeatRepository` prepares its statements in the
  // constructor, which would crash against a not-yet-migrated database —
  // and `buildDeps` is called by many tests BEFORE `db migrate` runs. The
  // closure defers the prepare until a real readiness report is requested,
  // at which point the migration is guaranteed to have run.
  const heartbeatStaleMs = resolveStaleMs(
    process.env["KANTHORD_HEARTBEAT_STALE_MS"],
  );
  let heartbeatRepository: SqliteDaemonHeartbeatRepository | undefined;
  const heartbeatInstances = (): Array<{
    instanceId: string;
    ageMs: number;
  }> => {
    if (heartbeatRepository === undefined) {
      heartbeatRepository = new SqliteDaemonHeartbeatRepository(db);
    }
    const now = Date.now();
    return heartbeatRepository.list().map((row) => ({
      instanceId: row.instanceId,
      ageMs: heartbeatAgeMs(now, row.lastBeatMs),
    }));
  };
  const repositoryProbe = new GitRepositoryProbe(resolveCredential);

  // EPIC 014 Story 6 — the daemon heartbeat factory. The `run daemon` leaf
  // calls `start()` before its loop and the returned function in `finally`
  // so the `daemon` check in `check project` observes a live `running` row
  // for the duration of the process. The lazy init of the repository keeps
  // `buildDeps` callable against an unmigrated database (the heartbeat row
  // is only written once the daemon actually starts). `pid` and
  // `startedAtMs` are captured by the closure so the same instance is
  // always re-beated under one `instanceId` (`pid + ":" + startedAtMs`).
  // `now` is `Date.now`; `schedule` is `setInterval` returning a cancel
  // handle. `resolveIntervalMs` (014 S3) clamps the interval into
  // `[1, HEARTBEAT_INTERVAL_MS]` so a 1ms threshold still produces a valid
  // interval — it is CALLED, not re-derived, so its hermetic "threshold stays
  // a 3x multiple of the period" test guards this production path.
  // `startedAtMs` is the real process start time, so `instanceId` means what
  // it says; `t.unref()` keeps the interval from holding the event loop open.
  const startedAtMs = Date.now() - Math.round(process.uptime() * 1000);
  const heartbeat: { start(): () => void } = {
    start: () => {
      if (heartbeatRepository === undefined) {
        heartbeatRepository = new SqliteDaemonHeartbeatRepository(db);
      }
      return startHeartbeat({
        store: heartbeatRepository,
        now: () => Date.now(),
        pid: process.pid,
        startedAtMs,
        intervalMs: resolveIntervalMs(heartbeatStaleMs),
        schedule: (fn, ms) => {
          const t = setInterval(fn, ms);
          t.unref();
          return { cancel: () => clearInterval(t) };
        },
      });
    },
  };

  const checkProject = new CheckProject({
    projects: {
      get: (id) => projectRepository.get(id),
      listResources: (projectId) => projectRepository.listResources(projectId),
      getResource: (id) => projectRepository.getResource(id),
    },
    initiatives: {
      listInitiatives: (projectId) =>
        initiativeRepository.listInitiatives(projectId),
      listAllInitiatives: () => initiativeRepository.listAllInitiatives(),
    },
    tasks: { listByInitiative: (id) => taskRepository.listByInitiative(id) },
    providers: {
      chain: (projectId) => resolveProjectChain.execute(projectId),
      assignedIds: (projectId) =>
        aiProviderRegistry.listAssigned(projectId).map((p) => p.id),
    },
    status: { schemaVersion: () => store.schemaVersion() },
    expectedSchemaVersion: MIGRATIONS[MIGRATIONS.length - 1]!.version,
    heartbeat: {
      staleMs: heartbeatStaleMs,
      instances: heartbeatInstances,
    },
    repositoryProbe,
    providerProbe: probeAiProvider,
  });

  // Story 007.13-B — publish delivers a landed branch to its remote,
  // separate from (and never automatic on) approve/land.
  const repositoryPublisher = new GitRepositoryPublisher(resolveCredential);
  const publishRepository = new PublishRepository(
    projectRepository,
    repositoryPublisher,
    publicationRepository,
    resolveHomeDir,
    resolveTargetOID,
    events,
    unitOfWork,
  );

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
  // Objective-level after edges (007.17) are gated through the sequencing param;
  // the store still carries listObjectiveAfter and getObjective for backward compat.
  const approveTaskStore = {
    get: (id: string) => taskRepository.get(id),
    save: (task: Task) => taskRepository.save(task),
    getTaskResult: (taskId: string) => taskRepository.getTaskResult(taskId),
    saveTaskResult: (taskId: string, row: TaskResultRow) =>
      taskRepository.saveTaskResult(taskId, row),
    listByInitiative: (initiativeId: string) =>
      taskRepository.listByInitiative(initiativeId),
    getInitiativeId: (taskId: string) => taskRepository.getInitiativeId(taskId),
    getTaskContext: (taskId: string) => taskRepository.getTaskContext(taskId),
    listObjectiveAfter: (objectiveId: string) =>
      sequencingRepository.listObjectiveAfter(objectiveId),
    getObjective: (id: string) => initiativeRepository.getObjective(id),
  };
  const approveTask = new ApproveTask(
    approveTaskStore,
    jobQueue,
    events,
    unitOfWork,
    promoteProposal,
    repoLanding,
    landingRepository,
    workspaces,
    resolveHomeDir,
    {
      listObjectiveAfter: (id: string) =>
        sequencingRepository.listObjectiveAfter(id),
    },
  );

  // Resolve an initiative to its bound repository's home dir by reading the
  // "repository" context binding off any of its tasks (the same binding
  // RunNextTask already forwards to the agent runner) and reusing the
  // existing repoId -> homeDir resolver above.
  const resolveInitiativeHomeDir = (initiativeId: string): string => {
    const tasks = taskRepository.listByInitiative(initiativeId);
    for (const task of tasks) {
      const repoId = taskRepository.getTaskContext(task.id)["repository"];
      if (repoId !== undefined) {
        return resolveHomeDir(repoId);
      }
    }
    throw new Error(
      `no repository binding found for initiative: ${initiativeId}`,
    );
  };

  // Same resolution strategy as resolveInitiativeHomeDir above, but returns
  // the bare repository resource id (not its resolved home dir) — GetObjective
  // needs the id itself to report as the integration's `repository` field.
  const resolveInitiativeRepository = (
    initiativeId: string,
  ): string | undefined => {
    const tasks = taskRepository.listByInitiative(initiativeId);
    for (const task of tasks) {
      const repoId = taskRepository.getTaskContext(task.id)["repository"];
      if (repoId !== undefined) return repoId;
    }
    return undefined;
  };

  // Story B objective-boundary squash — the expected parent OID for an
  // objective's squash chains onto the immediately-preceding objective's own
  // squashed `commitOid` (domain state), since sibling objectives within one
  // initiative can complete and squash back-to-back before a human ever runs
  // `approve objective` on the earlier one — home's live initiative-branch
  // ref only reflects state a human has already approved, and lags behind.
  // Only the FIRST objective of an initiative has no predecessor to chain
  // onto; for that one the initiative branch's tip *in home* (as
  // `prepareInitiative` recorded it) is the correct, and only available,
  // parent. Synchronous because `TaskStore.getObjectiveParentOid`
  // (run-next-task.ts) is declared synchronous.
  const getObjectiveParentOid = (objectiveId: string): string => {
    const objective = initiativeRepository.getObjective(objectiveId);
    if (objective === undefined) {
      throw new Error(`no objective found for id: ${objectiveId}`);
    }
    const siblings = initiativeRepository.listObjectives(
      objective.initiativeId,
    );
    const index = siblings.findIndex((o) => o.id === objectiveId);
    const predecessor = index > 0 ? siblings[index - 1] : undefined;
    if (predecessor?.commitOid !== undefined) {
      return predecessor.commitOid;
    }

    const homeDir = resolveInitiativeHomeDir(objective.initiativeId);
    const initBranch = `kanthord/init/${objective.initiativeId}`;
    const stdout = execFileSync(
      "git",
      ["rev-parse", `refs/heads/${initBranch}`],
      { cwd: homeDir, encoding: "utf8" },
    );
    return stdout.trim();
  };

  // Story A/B wiring gap — RunNextTask's `initiativeWorkspaces.ensure` seam
  // (see run-next-task.ts) needs a real collaborator that provisions the
  // initiative branch + isolated clone in home exactly once per initiative:
  // LocalWorkspaceManager.prepareInitiative always wipes and re-clones its
  // per-initiative dir, so this must short-circuit once `initiative.workspace`
  // is already persisted (otherwise every subsequent task claim would wipe
  // the clone's accumulated, not-yet-squashed objective commits).
  const ensureInitiativeWorkspace = async (
    initiativeId: string,
  ): Promise<void> => {
    const initiative = initiativeRepository.get(initiativeId);
    if (initiative?.workspace !== undefined) return;

    const repoId = resolveInitiativeRepository(initiativeId);
    if (repoId === undefined) return;

    const resource = projectRepository.getResource(repoId);
    if (!resource || !isRepository(resource)) return;

    const ws = await workspaces.prepareInitiative?.(initiativeId, resource);
    if (ws === undefined) return;

    initiativeRepository.setWorkspace?.(initiativeId, ws.dir);
  };

  const getInitiative = new GetInitiative(
    { get: (id) => initiativeRepository.get(id) },
    sequencingRepository,
  );
  // Story 3 (EPIC 016) — `get graph --initiative <id>`. Read-only assembly
  // of the initiative's full DAG. `repositoryBranch` reads the resource
  // record off `projectRepository` and returns the repository branch, or
  // `undefined` when the resource is absent or not a repository.
  const repositoryBranchFor = (repositoryId: string): string | undefined => {
    const resource = projectRepository.getResource(repositoryId);
    if (resource === undefined || !isRepository(resource)) {
      return undefined;
    }
    return resource.branch;
  };
  const getInitiativeGraph = new GetInitiativeGraph(
    taskRepository,
    {
      getTaskResult: (id) => taskRepository.getTaskResult(id),
    },
    {
      get: (id) => initiativeRepository.get(id),
      listObjectives: (initiativeId) =>
        initiativeRepository.listObjectives(initiativeId),
      listAllInitiatives: () => initiativeRepository.listAllInitiatives(),
    },
    sequencingRepository,
    {
      getCandidateByTask: (taskId) =>
        landingRepository.getCandidateByTask?.(taskId),
    },
    events,
    publicationRepository,
    repositoryBranchFor,
  );
  // Story 6 (EPIC 016) — `get overview --project <id>`. Read-only assembly
  // of a project's initiative rows, ranked decisions, lanes, and digest.
  // The five structural sources mirror Story 3's shape. `OverviewEventSource`
  // carries four readers; three live on `SqliteEventFeed` (the Story 6
  // adapter-only readers) and `latestProjectEventId` lives on the ack
  // repository. The composition combines them into a single structural
  // object, so `app/` never has to know that the readers come from two
  // adapters.
  const getProjectOverview = new GetProjectOverview(
    projectRepository,
    {
      listInitiatives: (projectId) =>
        initiativeRepository.listInitiatives(projectId),
      listObjectives: (initiativeId) =>
        initiativeRepository.listObjectives(initiativeId),
      listAllInitiatives: () => initiativeRepository.listAllInitiatives(),
    },
    taskRepository,
    projectAckRepository,
    {
      countProjectEventsAfter: (projectId, after) =>
        events.countProjectEventsAfter(projectId, after),
      readProjectEventsAfter: (projectId, after, limit) =>
        events.readProjectEventsAfter(projectId, after, limit),
      latestProjectEventId: (projectId) =>
        projectAckRepository.latestProjectEventId(projectId),
      latestActionableEventIds: (initiativeId) =>
        events.latestActionableEventIds(initiativeId),
    },
  );
  const getObjective = new GetObjective(
    { getObjective: (id) => initiativeRepository.getObjective(id) },
    { resolveInitiativeRepository },
    sequencingRepository,
  );

  // Story 7 (EPIC 017) — `get conflict --objective`. Read-only.
  const objectiveConflictBroker = new GitObjectiveBroker();
  const commitPresence = new GitCommitPresence();
  const getObjectiveConflict = new GetObjectiveConflict(
    { getObjective: (id) => initiativeRepository.getObjective(id) },
    {
      currentTip: (dir, ref) => objectiveConflictBroker.currentTip!(dir, ref),
    },
    resolveInitiativeHomeDir,
    {
      hasCommits: (homeDir, oids) => commitPresence.hasCommits(homeDir, oids),
    },
  );

  // Story 6 (EPIC 017) — the cross-project decision queue. Reuses
  // `landingRepository` (the same instance passed to `getConflict`),
  // `publicationRepository`, `resolveHomeDir`/`resolveInitiativeRepository`,
  // and `events`' array-keyed `latestActionableEventIds` overload. Read-only:
  // no `UnitOfWork`, no event append.
  const getDecisionQueue = new GetDecisionQueue(
    { listProjects: () => projectRepository.listProjects() },
    {
      listInitiatives: (projectId) =>
        initiativeRepository.listInitiatives(projectId),
      listObjectives: (initiativeId) =>
        initiativeRepository.listObjectives(initiativeId),
    },
    {
      listByInitiative: (initiativeId) =>
        taskRepository.listByInitiative(initiativeId),
    },
    {
      getLatestPublication: (repoId) =>
        publicationRepository.getLatestPublication(repoId),
    },
    {
      latestActionableEventIds: (ids) => events.latestActionableEventIds(ids),
    },
    {
      getTaskResult: (taskId) => taskRepository.getTaskResult(taskId),
      resolveHomeDir,
      resolveInitiativeRepository,
    },
    {
      getCandidateByTask: (taskId) =>
        landingRepository.getCandidateByTask?.(taskId),
    },
    {
      hasCommits: (homeDir, oids) => commitPresence.hasCommits(homeDir, oids),
    },
  );

  const approveObjective = new ApproveObjective(
    {
      getObjective: (id) => initiativeRepository.getObjective(id),
      saveObjective: (objective) =>
        initiativeRepository.saveObjective(objective),
      getInitiative: (initiativeId) => initiativeRepository.get(initiativeId),
      resolveHomeDir: resolveInitiativeHomeDir,
      listObjectives: (initiativeId) =>
        initiativeRepository.listObjectives(initiativeId),
      saveInitiative: (initiative) => initiativeRepository.save(initiative),
    },
    new GitObjectiveBroker(),
    events,
    unitOfWork,
  );

  // S5 (Story E, 007.12): the real conflict-resolution verification gate
  // (reusing per-task gate machinery) is a separate, later Task; this
  // always-pass gate unblocks CLI/composition reachability of
  // `retry objective` for the conflict-resolution path in the meantime.
  const retryObjective = new RetryObjective(
    {
      getObjective: (id) => initiativeRepository.getObjective(id),
      listObjectives: (initiativeId) =>
        initiativeRepository.listObjectives(initiativeId),
      getInitiative: (initiativeId) => initiativeRepository.get(initiativeId),
      saveObjective: (objective) =>
        initiativeRepository.saveObjective(objective),
      resolveHomeDir: resolveInitiativeHomeDir,
    },
    new GitObjectiveBroker(),
    workspaces,
    { verify: async () => ({ passed: true }) },
    events,
    unitOfWork,
  );

  const rejectObjective = new RejectObjective(
    {
      getObjective: (id) => initiativeRepository.getObjective(id),
      saveObjective: (objective) =>
        initiativeRepository.saveObjective(objective),
      listObjectives: (initiativeId) =>
        initiativeRepository.listObjectives(initiativeId),
      getInitiative: (initiativeId) => initiativeRepository.get(initiativeId),
      saveInitiative: (initiative) => initiativeRepository.save(initiative),
      listTasksByObjective: (objectiveId) =>
        taskRepository.listTasksByObjective(objectiveId),
      saveTask: (task) => taskRepository.save(task),
      listObjectiveAfter: (objectiveId) =>
        sequencingRepository.listObjectiveAfter(objectiveId),
      listInitiativeAfter: (initiativeId) =>
        sequencingRepository.listInitiativeAfter(initiativeId),
      listInitiatives: (projectId) =>
        initiativeRepository.listInitiatives(projectId),
      getProjectId: (initiativeId) =>
        initiativeRepository.get(initiativeId)?.projectId,
      listTasksByInitiative: (initiativeId) =>
        taskRepository.listByInitiative(initiativeId),
    },
    events,
    unitOfWork,
  );

  const loginProvider = new LoginProvider({
    oauth: new PiOAuthLoginProvider(),
    registry: aiProviderRegistry,
    unitOfWork,
    modelCatalog,
    listModels: (providerId: string) => listModels(providerId).map((m) => m.id),
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

  // EPIC 015 Story 5 — the interactive-prompt seam the setup wizard
  // injects. A single-method interface (`ask`) that resolves the user's
  // answer line and returns `undefined` on EOF / Ctrl-C so the wizard
  // can abort cleanly. Built over `node:readline` (the same block
  // `login` uses) so the two interactive surfaces share one transport.
  const setupPrompt = {
    ask: async (message: string): Promise<string | undefined> => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        // `rl.question(...)` never settles once the interface closes
        // without an answer (EOF / Ctrl-C) — it neither resolves nor
        // rejects. Race it against a one-shot `close` listener that
        // resolves `undefined`, so EOF reliably produces the documented
        // abort signal instead of hanging forever.
        return await new Promise<string | undefined>((resolve, reject) => {
          rl.once("close", () => resolve(undefined));
          rl.question(`${message} `).then(resolve, reject);
        });
      } catch {
        return undefined;
      } finally {
        rl.close();
      }
    },
  };

  return {
    migrateDb,
    getDbStatus,
    createProject,
    renameProject,
    getProject,
    findProject,
    listProjects,
    ackProject,
    getProjectOverview,
    createInitiative,
    renameInitiative,
    findInitiative,
    getInitiative,
    getInitiativeGraph,
    pauseInitiative,
    resumeInitiative,
    createObjective,
    renameObjective,
    findObjective,
    getObjective,
    addResource,
    findResource,
    getResource,
    listResources,
    updateCredential,
    updateRepository,
    updateNotification,
    updateFilesystem,
    createTask,
    addDependency,
    removeDependency,
    addInitiativeDependency,
    removeInitiativeDependency,
    addObjectiveDependency,
    removeObjectiveDependency,
    listTasks,
    retryTask,
    getTask,
    approveTask,
    approveObjective,
    retryObjective,
    rejectObjective,
    rejectTask,
    abandonTask,
    buildDaemon,
    logger,
    httpLogger: new PinoLogger(),
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
    publishRepository,
    registerAiProvider,
    updateAiProvider,
    getAiProvider,
    listAiProviders,
    setDefaultAiProvider,
    logoutAiProvider,
    removeAiProvider,
    assignAiProvider,
    unassignAiProvider,
    resolveProjectChain,
    testAiProvider,
    providerProbe: probeAiProvider,
    checkProject,
    observeSetupFacts,
    heartbeat,
    repositoryProbe,
    resolveHomeDir,
    workspaces,
    newId,
    getConflict,
    getObjectiveConflict,
    getDecisionQueue,
    getPriorFeedback,
    resolveCredential,
    setupPrompt,
    stdinIsTty: process.stdin.isTTY === true,
  };
}

// Composition factory — extracted from main.ts so tests can instantiate deps
// without launching a process. Only this file (and main.ts) import concrete adapters.
import type { RouterDeps } from "./apps/cli/router.ts";
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
import { CreateTask } from "./app/task/create-task.ts";
import { AddDependency } from "./app/task/add-dependency.ts";
import { RemoveDependency } from "./app/task/remove-dependency.ts";
import { ListTasks } from "./app/task/list-tasks.ts";
import { RetryTask } from "./app/task/retry-task.ts";
import { SqliteJobQueue } from "./queue/sqlite.ts";
import { SqliteUnitOfWork } from "./storage/sqlite/sqlite-unit-of-work.ts";
import { FakeRunner } from "./agent-runner/fake.ts";
import { RegistryRunnerResolver } from "./agent-runner/resolver.ts";
import { EnqueueReadyTasks } from "./app/task/enqueue-ready-tasks.ts";
import { RecoverInterruptedTasks } from "./app/task/recover-interrupted-tasks.ts";
import { RunNextTask } from "./app/task/run-next-task.ts";
import { RunDaemon } from "./app/task/run-daemon.ts";
import { ListEvents } from "./app/task/list-events.ts";

/**
 * Wire all concrete adapters and return the `RouterDeps` bundle.
 * Called once at program start (and by integration tests).
 */
export function buildDeps(dbPath: string): RouterDeps {
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
  const addResource = new AddResource(projectRepository, referenceResolver);
  const findResource = new FindResource(projectRepository);
  const createTask = new CreateTask(
    taskRepository,
    initiativeRepository,
    projectRepository,
    referenceResolver,
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
  const listEvents = new ListEvents(events);
  const retryTask = new RetryTask(
    taskRepository,
    jobQueue,
    events,
    unitOfWork,
    referenceResolver,
  );

  function buildDaemon(failTaskIds: string[]): RunDaemon {
    const fakeRunner = new FakeRunner({ failTaskIds });
    const resolver = new RegistryRunnerResolver({ defaultRunner: fakeRunner });
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
    );
    return new RunDaemon({
      recover,
      enqueueReady,
      runNext,
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
  }

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
    createTask,
    addDependency,
    removeDependency,
    listTasks,
    retryTask,
    buildDaemon,
    listEvents,
  };
}

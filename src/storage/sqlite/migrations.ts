import type { Migration } from "./migrate.ts";

/**
 * The ordered migration registry. Later epics append their migrations here —
 * the runner (`migrate.ts`) is not touched again. Plain `CREATE TABLE` (not
 * `IF NOT EXISTS`): the `user_version` guard is the idempotency mechanism, so a
 * create on unexpected state must fail loud.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "create tasks table",
    up: (db) => db.exec("CREATE TABLE tasks(id TEXT PRIMARY KEY)"),
  },
  {
    version: 2,
    name: "core-schema",
    up: (db) =>
      db.exec(`
DROP TABLE tasks;
CREATE TABLE projects (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE resources (
  id         TEXT PRIMARY KEY,
  projectId  TEXT NOT NULL REFERENCES projects(id),
  type       TEXT NOT NULL CHECK (type IN
              ('repository','credential','notification','ai_provider','filesystem')),
  name       TEXT NOT NULL,
  attributes TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE initiatives (
  id        TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  name      TEXT NOT NULL
);
CREATE TABLE objectives (
  id           TEXT PRIMARY KEY,
  initiativeId TEXT NOT NULL REFERENCES initiatives(id),
  name         TEXT NOT NULL
);
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  objectiveId TEXT NOT NULL REFERENCES objectives(id),
  title       TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN
               ('pending','running','completed','failed'))
);
CREATE TABLE task_dependencies (
  taskId     TEXT NOT NULL REFERENCES tasks(id),
  dependency TEXT NOT NULL REFERENCES tasks(id),
  position   INTEGER NOT NULL,
  PRIMARY KEY (taskId, dependency)
);
CREATE TABLE jobs (
  id     TEXT PRIMARY KEY,
  taskId TEXT NOT NULL REFERENCES tasks(id),
  status TEXT NOT NULL CHECK (status IN
          ('queued','running','completed','failed'))
);
CREATE UNIQUE INDEX jobs_queued_taskId ON jobs(taskId) WHERE status = 'queued';
CREATE TABLE events (
  id     TEXT PRIMARY KEY,
  type   TEXT NOT NULL CHECK (type IN
          ('task.created','task.ready','task.started','task.completed','task.failed',
           'task.dependencies_changed')),
  taskId TEXT NOT NULL REFERENCES tasks(id)
);
`),
  },
];

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
  {
    version: 3,
    name: "task-context",
    up: (db) =>
      db.exec(`
CREATE TABLE task_context (
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  type        TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  PRIMARY KEY (task_id, type)
)
`),
  },
  {
    version: 4,
    name: "execution-loop",
    up: (db) =>
      db.exec(`
ALTER TABLE events ADD COLUMN payload TEXT;
ALTER TABLE initiatives ADD COLUMN paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1))
`),
  },
  {
    version: 5,
    name: "epic-006-task-spec-and-results",
    up: (db) =>
      db.exec(`
CREATE TABLE tasks_new (
  id           TEXT PRIMARY KEY,
  objectiveId  TEXT NOT NULL REFERENCES objectives(id),
  title        TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN (
                 'pending','running','completed','failed',
                 'awaiting_confirmation','discarded')),
  agent        TEXT NOT NULL DEFAULT 'generic@1',
  instructions TEXT NOT NULL DEFAULT '',
  ac           TEXT NOT NULL DEFAULT '[]',
  verification TEXT
);
INSERT INTO tasks_new (id, objectiveId, title, status)
  SELECT id, objectiveId, title, status FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;
CREATE TABLE events_new (
  id      TEXT PRIMARY KEY,
  type    TEXT NOT NULL CHECK (type IN (
            'task.created','task.ready','task.started','task.completed',
            'task.failed','task.dependencies_changed',
            'task.escalated','task.approved','task.rejected','task.discarded',
            'task.blocked','agent.started','agent.progress','agent.finished'
          )),
  taskId  TEXT NOT NULL REFERENCES tasks(id),
  payload TEXT
);
INSERT INTO events_new SELECT * FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE TABLE task_results (
  task_id              TEXT PRIMARY KEY REFERENCES tasks(id),
  workspace            TEXT,
  branch               TEXT,
  base_commit          TEXT,
  proposal_commit      TEXT,
  commit_sha           TEXT,
  summary              TEXT,
  reason               TEXT,
  rejection_resolution TEXT,
  rejection_reason     TEXT,
  evidence             TEXT
);
`),
  },
  {
    version: 6,
    name: "epic-007-sha256-and-idempotency",
    up: (db) =>
      db.exec(`
ALTER TABLE initiatives ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE objectives  ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks       ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';
CREATE TABLE graph_import_map (
  package_id   TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('objective','task')),
  ref          TEXT NOT NULL,
  objective_id TEXT REFERENCES objectives(id) ON DELETE CASCADE,
  task_id      TEXT REFERENCES tasks(id)      ON DELETE CASCADE,
  creation_sha TEXT NOT NULL,
  UNIQUE(package_id, kind, ref),
  CHECK ((objective_id IS NOT NULL) <> (task_id IS NOT NULL))
);
`),
  },
];

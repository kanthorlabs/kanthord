import { createHash } from "node:crypto";

import type { Migration } from "./migrate.ts";

/**
 * FROZEN snapshot of `canonicalTask` as it stood at schema version 20 — status
 * still part of the content hash. Used by migration 21 to recompute what a
 * stored `creation_sha` would have been, so status-only drift can be told apart
 * from genuine content drift. Never edit: it describes the past, not the present.
 */
export function canonicalTaskV20(t: {
  title: string;
  instructions: string;
  ac: string[];
  agent: string;
  verification: string[] | undefined;
  dependencies: string[];
  objectiveId: string;
  status: string;
}): string {
  return JSON.stringify({
    title: t.title,
    instructions: t.instructions,
    ac: t.ac,
    agent: t.agent,
    verification: t.verification ?? null,
    dependencies: [...t.dependencies].sort(),
    objectiveId: t.objectiveId,
    status: t.status,
  });
}

/**
 * FROZEN snapshot of `canonicalTask` as of migration 21 (EPIC 007.18: `status`
 * removed). Migrations must be immutable, so this must never be edited to track
 * later changes to `src/domain/sha.ts` — a future change to the canonical form
 * gets its own migration with its own snapshot. Deliberately not imported from
 * domain/, which no migration does.
 */
export function canonicalTaskV21(t: {
  title: string;
  instructions: string;
  ac: string[];
  agent: string;
  verification: string[] | undefined;
  dependencies: string[];
  objectiveId: string;
}): string {
  return JSON.stringify({
    title: t.title,
    instructions: t.instructions,
    ac: t.ac,
    agent: t.agent,
    verification: t.verification ?? null,
    dependencies: [...t.dependencies].sort(),
    objectiveId: t.objectiveId,
  });
}

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
  {
    version: 7,
    name: "epic-007.1-e2e-hardening",
    up: (db) =>
      db.exec(`
ALTER TABLE resources ADD COLUMN remoteUrl TEXT;
ALTER TABLE resources ADD COLUMN authKind TEXT DEFAULT 'ambient';
ALTER TABLE resources ADD COLUMN authCredentialId TEXT;
UPDATE resources
  SET remoteUrl = 'https://github.com/' ||
                  json_extract(attributes, '$.organization') ||
                  '/' || name || '.git',
      authKind  = 'ambient'
  WHERE type = 'repository';
CREATE TABLE events_new2 (
  id      TEXT PRIMARY KEY,
  type    TEXT NOT NULL CHECK (type IN (
            'task.created','task.ready','task.started','task.completed',
            'task.failed','task.dependencies_changed',
            'task.escalated','task.approved','task.rejected','task.discarded',
            'task.blocked','agent.started','agent.progress','agent.finished',
            'task.verification'
          )),
  taskId  TEXT NOT NULL REFERENCES tasks(id),
  payload TEXT
);
INSERT INTO events_new2 SELECT * FROM events;
DROP TABLE events;
ALTER TABLE events_new2 RENAME TO events;
CREATE TABLE observability_refs (
  kind      TEXT NOT NULL CHECK (kind IN ('task','initiative','session')),
  entity_id TEXT NOT NULL,
  ref       TEXT NOT NULL,
  PRIMARY KEY (kind, entity_id)
);
CREATE TABLE landing_candidates (
  id            TEXT PRIMARY KEY,
  task_id       TEXT REFERENCES tasks(id),
  repo_id       TEXT NOT NULL,
  base_sha      TEXT NOT NULL,
  candidate_sha TEXT NOT NULL,
  ref           TEXT NOT NULL,
  target        TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'pending'
                CHECK (state IN ('pending','landed','conflict'))
);
CREATE TABLE landing_integrations (
  candidate_id   TEXT PRIMARY KEY REFERENCES landing_candidates(id),
  outcome        TEXT NOT NULL CHECK (outcome IN ('fast-forward','merge','conflict')),
  canonical_sha  TEXT NOT NULL,
  merge_commit   TEXT,
  conflict_files TEXT
);
CREATE TABLE repo_locks (
  repo_id   TEXT NOT NULL,
  branch    TEXT NOT NULL,
  pid       INTEGER NOT NULL,
  locked_at TEXT NOT NULL,
  PRIMARY KEY (repo_id, branch)
);
CREATE TABLE workspace_cached_policies (
  repo_id                TEXT PRIMARY KEY,
  last_fetched_origin_sha TEXT NOT NULL,
  fetch_time             TEXT NOT NULL,
  base_sha               TEXT NOT NULL
);
`),
  },
  {
    version: 8,
    name: "007.4-s2-task-conflict-schema",
    up: (db) =>
      db.exec(`
CREATE TABLE events_new3 (
  id      TEXT PRIMARY KEY,
  type    TEXT NOT NULL CHECK (type IN (
            'task.created','task.ready','task.started','task.completed',
            'task.failed','task.dependencies_changed',
            'task.escalated','task.approved','task.rejected','task.discarded',
            'task.blocked','task.conflict','agent.started','agent.progress',
            'agent.finished','task.verification'
          )),
  taskId  TEXT NOT NULL REFERENCES tasks(id),
  payload TEXT
);
INSERT INTO events_new3 (id, type, taskId, payload) SELECT id, type, taskId, payload FROM events;
DROP TABLE events;
ALTER TABLE events_new3 RENAME TO events;
`),
  },
  {
    version: 9,
    name: "007.6-s3-task-note",
    up: (db) =>
      db.exec(`
ALTER TABLE tasks ADD COLUMN note TEXT;
`),
  },
  {
    version: 10,
    name: "007.9-s2-provider-retry-event",
    up: (db) =>
      db.exec(`
CREATE TABLE events_new4 (
  id      TEXT PRIMARY KEY,
  type    TEXT NOT NULL CHECK (type IN (
            'task.created','task.ready','task.started','task.completed',
            'task.failed','task.dependencies_changed',
            'task.escalated','task.approved','task.rejected','task.discarded',
            'task.blocked','task.conflict','agent.started','agent.progress',
            'agent.finished','task.verification','provider.retry'
          )),
  taskId  TEXT NOT NULL REFERENCES tasks(id),
  payload TEXT
);
INSERT INTO events_new4 (id, type, taskId, payload) SELECT id, type, taskId, payload FROM events;
DROP TABLE events;
ALTER TABLE events_new4 RENAME TO events;
`),
  },
  {
    version: 11,
    name: "007.12-s4-initiative-objective-status",
    up: (db) =>
      db.exec(`
ALTER TABLE initiatives ADD COLUMN status TEXT NOT NULL DEFAULT 'building'
  CHECK (status IN ('building','awaiting_pr','delivered'));
ALTER TABLE objectives ADD COLUMN status TEXT NOT NULL DEFAULT 'building'
  CHECK (status IN ('building','awaiting_confirmation','conflict','integrated'));
`),
  },
  {
    version: 12,
    name: "007.12-s4-objective-initiative-scoped-events",
    up: (db) =>
      db.exec(`
CREATE TABLE events_new5 (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN (
                 'task.created','task.ready','task.started','task.completed',
                 'task.failed','task.dependencies_changed',
                 'task.escalated','task.approved','task.rejected','task.discarded',
                 'task.blocked','task.conflict','agent.started','agent.progress',
                 'agent.finished','task.verification','provider.retry',
                 'objective.building','objective.awaiting_confirmation',
                 'objective.integrated','objective.conflict',
                 'initiative.awaiting_pr','initiative.delivered'
               )),
  taskId       TEXT REFERENCES tasks(id),
  payload      TEXT,
  objectiveId  TEXT REFERENCES objectives(id),
  initiativeId TEXT REFERENCES initiatives(id)
);
INSERT INTO events_new5 (id, type, taskId, payload) SELECT id, type, taskId, payload FROM events;
DROP TABLE events;
ALTER TABLE events_new5 RENAME TO events;
`),
  },
  {
    version: 13,
    name: "007.12-s1-initiative-workspace",
    up: (db) =>
      db.exec(`
ALTER TABLE initiatives ADD COLUMN workspace TEXT;
`),
  },
  {
    version: 14,
    name: "007.12-s2-objective-commit-oid",
    up: (db) =>
      db.exec(`
ALTER TABLE objectives ADD COLUMN commitOid TEXT;
ALTER TABLE objectives ADD COLUMN parentOid TEXT;
`),
  },
  {
    version: 15,
    name: "007.13-s3-publications",
    up: (db) =>
      db.exec(`
CREATE TABLE publications (
  repo_id    TEXT NOT NULL,
  branch     TEXT NOT NULL,
  state      TEXT NOT NULL CHECK (state IN ('unpublished','published','diverged')),
  remote_oid TEXT,
  PRIMARY KEY (repo_id, branch)
);
`),
  },
  {
    version: 16,
    name: "007.14-s4-candidate-transplanted-event",
    up: (db) =>
      db.exec(`
CREATE TABLE events_new6 (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN (
                 'task.created','task.ready','task.started','task.completed',
                 'task.failed','task.dependencies_changed',
                 'task.escalated','task.approved','task.rejected','task.discarded',
                 'task.blocked','task.conflict','agent.started','agent.progress',
                 'agent.finished','task.verification','provider.retry',
                 'objective.building','objective.awaiting_confirmation',
                 'objective.integrated','objective.conflict',
                 'initiative.awaiting_pr','initiative.delivered',
                 'candidate.transplanted'
               )),
  taskId       TEXT REFERENCES tasks(id),
  payload      TEXT,
  objectiveId  TEXT REFERENCES objectives(id),
  initiativeId TEXT REFERENCES initiatives(id)
);
INSERT INTO events_new6 (id, type, taskId, payload, objectiveId, initiativeId)
  SELECT id, type, taskId, payload, objectiveId, initiativeId FROM events;
DROP TABLE events;
ALTER TABLE events_new6 RENAME TO events;
`),
  },
  {
    version: 17,
    name: "007.15-s2-initiative-landed-status",
    // `initiatives` is an FK parent (objectives.initiativeId REFERENCES
    // initiatives(id)); the DROP+RENAME rebuild trips FK enforcement even
    // though the final state is consistent — disable it around this migration.
    disableForeignKeys: true,
    up: (db) =>
      db.exec(`
CREATE TABLE initiatives_new (
  id        TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  name      TEXT NOT NULL,
  paused    INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  sha256    TEXT NOT NULL DEFAULT '',
  status    TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building','landed')),
  workspace TEXT
);
INSERT INTO initiatives_new (id, projectId, name, paused, sha256, status, workspace)
  SELECT id, projectId, name, paused, sha256,
    CASE WHEN status = 'awaiting_pr' THEN 'landed' ELSE status END,
    workspace
  FROM initiatives;
DROP TABLE initiatives;
ALTER TABLE initiatives_new RENAME TO initiatives;
CREATE TABLE events_new7 (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN (
                 'task.created','task.ready','task.started','task.completed',
                 'task.failed','task.dependencies_changed',
                 'task.escalated','task.approved','task.rejected','task.discarded',
                 'task.blocked','task.conflict','agent.started','agent.progress',
                 'agent.finished','task.verification','provider.retry',
                 'objective.building','objective.awaiting_confirmation',
                 'objective.integrated','objective.conflict',
                 'initiative.landed','candidate.transplanted','repository.published'
               )),
  taskId       TEXT REFERENCES tasks(id),
  payload      TEXT,
  objectiveId  TEXT REFERENCES objectives(id),
  initiativeId TEXT REFERENCES initiatives(id)
);
INSERT INTO events_new7 (id, type, taskId, payload, objectiveId, initiativeId)
  SELECT id, type, taskId, payload, objectiveId, initiativeId FROM events;
DROP TABLE events;
ALTER TABLE events_new7 RENAME TO events;
`),
  },
  {
    version: 18,
    name: "007.16-s4-event-repository-subject",
    // `events` is not an FK parent (nothing references it), so no need to
    // disable FK enforcement for this rebuild.
    up: (db) =>
      db.exec(`
CREATE TABLE events_new8 (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN (
                 'task.created','task.ready','task.started','task.completed',
                 'task.failed','task.dependencies_changed',
                 'task.escalated','task.approved','task.rejected','task.discarded',
                 'task.blocked','task.conflict','agent.started','agent.progress',
                 'agent.finished','task.verification','provider.retry',
                 'objective.building','objective.awaiting_confirmation',
                 'objective.integrated','objective.conflict',
                 'initiative.landed','candidate.transplanted','repository.published'
               )),
  taskId       TEXT REFERENCES tasks(id),
  payload      TEXT,
  objectiveId  TEXT REFERENCES objectives(id),
  initiativeId TEXT REFERENCES initiatives(id),
  repositoryId TEXT
);
INSERT INTO events_new8 (id, type, taskId, payload, objectiveId, initiativeId)
  SELECT id, type, taskId, payload, objectiveId, initiativeId FROM events;
DROP TABLE events;
ALTER TABLE events_new8 RENAME TO events;
`),
  },
  {
    version: 19,
    name: "007.16-s5-discarded-status",
    // `initiatives` is an FK parent (objectives.initiativeId REFERENCES
    // initiatives(id)); the DROP+RENAME rebuild trips FK enforcement even
    // though the final state is consistent — disable it around this migration
    // (same reasoning as the version-17 migration).
    disableForeignKeys: true,
    up: (db) =>
      db.exec(`
CREATE TABLE objectives_new (
  id           TEXT PRIMARY KEY,
  initiativeId TEXT NOT NULL REFERENCES initiatives(id),
  name         TEXT NOT NULL,
  sha256       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'building'
               CHECK (status IN ('building','awaiting_confirmation','conflict','integrated','discarded')),
  commitOid    TEXT,
  parentOid    TEXT
);
INSERT INTO objectives_new (id, initiativeId, name, sha256, status, commitOid, parentOid)
  SELECT id, initiativeId, name, sha256, status, commitOid, parentOid FROM objectives;
DROP TABLE objectives;
ALTER TABLE objectives_new RENAME TO objectives;
CREATE TABLE initiatives_new2 (
  id        TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  name      TEXT NOT NULL,
  paused    INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  sha256    TEXT NOT NULL DEFAULT '',
  status    TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building','landed','discarded')),
  workspace TEXT
);
INSERT INTO initiatives_new2 (id, projectId, name, paused, sha256, status, workspace)
  SELECT id, projectId, name, paused, sha256, status, workspace FROM initiatives;
DROP TABLE initiatives;
ALTER TABLE initiatives_new2 RENAME TO initiatives;
CREATE TABLE events_new9 (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN (
                 'task.created','task.ready','task.started','task.completed',
                 'task.failed','task.dependencies_changed',
                 'task.escalated','task.approved','task.rejected','task.discarded',
                 'task.blocked','task.conflict','agent.started','agent.progress',
                 'agent.finished','task.verification','provider.retry',
                 'objective.building','objective.awaiting_confirmation',
                 'objective.integrated','objective.conflict',
                 'initiative.landed','candidate.transplanted','repository.published',
                 'objective.discarded','initiative.discarded'
               )),
  taskId       TEXT REFERENCES tasks(id),
  payload      TEXT,
  objectiveId  TEXT REFERENCES objectives(id),
  initiativeId TEXT REFERENCES initiatives(id),
  repositoryId TEXT
);
INSERT INTO events_new9 (id, type, taskId, payload, objectiveId, initiativeId, repositoryId)
  SELECT id, type, taskId, payload, objectiveId, initiativeId, repositoryId FROM events;
DROP TABLE events;
ALTER TABLE events_new9 RENAME TO events;
`),
  },
  {
    version: 20,
    name: "007.17-s2-initiative-objective-dependencies",
    up: (db) =>
      db.exec(`
CREATE TABLE initiative_dependencies (
  initiativeId TEXT NOT NULL REFERENCES initiatives(id),
  dependency   TEXT NOT NULL REFERENCES initiatives(id),
  PRIMARY KEY (initiativeId, dependency)
);
CREATE TABLE objective_dependencies (
  objectiveId TEXT NOT NULL REFERENCES objectives(id),
  dependency  TEXT NOT NULL REFERENCES objectives(id),
  PRIMARY KEY (objectiveId, dependency)
);
`),
  },
  {
    version: 21,
    name: "007.18-s2-content-sha-restamp",
    // First JS-looping migration in this registry: the task content digest is a
    // sha256 over canonical JSON and cannot be computed in SQL.
    //
    // `tasks.sha256` is always rewritten to the new status-less digest — it is
    // derived from live content by definition.
    //
    // `graph_import_map.creation_sha` is rewritten ONLY when the row's content
    // has not drifted since the baseline was minted, tested by recomputing the
    // old status-bearing digest at status "pending" (the status every baseline
    // was created with). Rewriting unconditionally would erase real drift;
    // rewriting nothing would leave every progressed task permanently drifted.
    // Each package's row is judged on its own stored baseline.
    //
    // Objective and initiative shas are untouched: their canonical forms never
    // included status.
    up: (db) => {
      type TaskRow = {
        id: string;
        objectiveId: string;
        title: string;
        agent: string;
        instructions: string;
        ac: string;
        verification: string | null;
      };
      const sha = (canonical: string): string =>
        createHash("sha256").update(canonical, "utf8").digest("hex");

      const rows = db
        .prepare(
          "SELECT id, objectiveId, title, agent, instructions, ac, verification FROM tasks",
        )
        .all() as TaskRow[];
      const depsStmt = db.prepare(
        "SELECT dependency FROM task_dependencies WHERE taskId = ? ORDER BY position ASC",
      );
      const mapStmt = db.prepare(
        "SELECT rowid AS rid, creation_sha FROM graph_import_map WHERE task_id = ?",
      );
      const updTask = db.prepare("UPDATE tasks SET sha256 = ? WHERE id = ?");
      const updMap = db.prepare(
        "UPDATE graph_import_map SET creation_sha = ? WHERE rowid = ?",
      );

      for (const row of rows) {
        const deps = (
          depsStmt.all(row.id) as Array<{ dependency: string }>
        ).map((d) => d.dependency);
        const fields = {
          title: row.title,
          instructions: row.instructions,
          ac: JSON.parse(row.ac) as string[],
          agent: row.agent,
          verification:
            row.verification != null
              ? (JSON.parse(row.verification) as string[])
              : undefined,
          dependencies: deps,
          objectiveId: row.objectiveId,
        };
        const newSha = sha(canonicalTaskV21(fields));
        // What `creation_sha` would hold if content never changed since import.
        const undriftedBaseline = sha(
          canonicalTaskV20({ ...fields, status: "pending" }),
        );

        updTask.run(newSha, row.id);

        const mapRows = mapStmt.all(row.id) as Array<{
          rid: number;
          creation_sha: string;
        }>;
        for (const m of mapRows) {
          if (m.creation_sha === undriftedBaseline) updMap.run(newSha, m.rid);
          // else: genuine content drift — leave the baseline so it still
          // classifies `drifted` on the next apply.
        }
      }
    },
  },
  {
    version: 22,
    name: "008.1-s-ai-provider-registry",
    up: (db) =>
      db.exec(`
CREATE TABLE ai_providers (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  baseUrl           TEXT,
  effort            TEXT,
  value             TEXT,
  state             TEXT NOT NULL DEFAULT 'active'
                    CHECK (state IN ('active','logged_out')),
  credentialVersion INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE ai_provider_default (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  providerId TEXT NOT NULL REFERENCES ai_providers(id)
);
`),
  },
  {
    version: 23,
    name: "008.2-s-project-ai-providers",
    up: (db) =>
      db.exec(`
CREATE TABLE project_ai_providers (
  projectId  TEXT NOT NULL REFERENCES projects(id),
  providerId TEXT NOT NULL REFERENCES ai_providers(id),
  rank       INTEGER NOT NULL,
  PRIMARY KEY (projectId, providerId),
  UNIQUE (projectId, rank)
);
`),
  },
  {
    version: 24,
    name: "008.1-custom-openai-compatible",
    up: (db) => {
      db.exec(`
ALTER TABLE ai_providers ADD COLUMN api TEXT CHECK (api IN ('openai-completions','openai-responses'));
ALTER TABLE ai_providers ADD COLUMN contextWindow INTEGER;
ALTER TABLE ai_providers ADD COLUMN maxTokens INTEGER;
`);
    },
  },
  {
    version: 25,
    name: "008.3-s-retire-ai-provider-type",
    // Rebuilds resources table without the 'ai_provider' CHECK option; deletes
    // stale ai_provider rows from resources and stale ai_provider/credential
    // rows from task_context (the credential context binding is retired because
    // the daemon now resolves provider+credential from the chain, not per-task
    // bindings).
    //
    // Disable FK enforcement during the DROP+RENAME of resources (it's an FK
    // parent from task_context; the final state is consistent but the
    // intermediate DROP+ALTER+RENAME trips FK enforcement).
    disableForeignKeys: true,
    up: (db) => {
      db.exec(`
DELETE FROM task_context WHERE type IN ('ai_provider', 'credential');
CREATE TABLE resources_new (
  id               TEXT PRIMARY KEY,
  projectId        TEXT NOT NULL REFERENCES projects(id),
  type             TEXT NOT NULL CHECK (type IN ('repository','credential','notification','filesystem')),
  name             TEXT NOT NULL,
  attributes       TEXT NOT NULL DEFAULT '{}',
  remoteUrl        TEXT,
  authKind         TEXT DEFAULT 'ambient',
  authCredentialId TEXT
);
INSERT INTO resources_new (id, projectId, type, name, attributes, remoteUrl, authKind, authCredentialId)
  SELECT id, projectId, type, name, attributes, remoteUrl, authKind, authCredentialId
  FROM resources WHERE type != 'ai_provider';
DROP TABLE resources;
ALTER TABLE resources_new RENAME TO resources;
`);
    },
  },
  {
    version: 26,
    name: "008.4-s-provider-failover-event",
    // EPIC 008.4 Story D — admit 'provider.failover' in the events.type
    // CHECK list (SQLite can't ALTER a CHECK constraint; rebuild the table).
    // Mirrors the events_new* pattern (e.g. migration 19's events_new9): all
    // 7 columns preserved verbatim, only the CHECK list grows by one literal.
    //
    // EPIC 011 Story 3 also lands here: `projectId` denormalises the owning
    // project onto every event row so scoped reads survive entity deletion
    // and cursor paging stays cheap. It is folded into this rebuild rather
    // than added by a later migration because there is no database to
    // preserve (AGENTS.md: local development only), so a nullable ALTER plus
    // a hierarchy-join backfill would be machinery with nothing to migrate.
    // Nullable, and no REFERENCES projects(id): `repositoryId` beside it
    // already carries no FK, and an unresolvable owner must leave NULL rather
    // than fail the insert. `SqliteEventFeed.append` resolves and writes it.
    // `events` is not an FK parent, so no disableForeignKeys (precedent
    // comment at migrations.ts:488-492).
    //
    // ANY future rebuild of this table MUST carry `projectId` and re-create
    // `events_project_cursor`; dropping either silently empties every
    // project-scoped feed. Two tests in migrations.test.ts assert the
    // post-migration column set and the index, and will fail if it is missed.
    up: (db) =>
      db.exec(`
CREATE TABLE events_new10 (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN (
                 'task.created','task.ready','task.started','task.completed',
                 'task.failed','task.dependencies_changed',
                 'task.escalated','task.approved','task.rejected','task.discarded',
                 'task.blocked','task.conflict','agent.started','agent.progress',
                 'agent.finished','task.verification','provider.retry',
                 'provider.failover',
                 'objective.building','objective.awaiting_confirmation',
                 'objective.integrated','objective.conflict',
                 'initiative.landed','candidate.transplanted','repository.published',
                 'objective.discarded','initiative.discarded'
               )),
  taskId       TEXT REFERENCES tasks(id),
  payload      TEXT,
  objectiveId  TEXT REFERENCES objectives(id),
  initiativeId TEXT REFERENCES initiatives(id),
  repositoryId TEXT,
  projectId    TEXT
);
INSERT INTO events_new10 (id, type, taskId, payload, objectiveId, initiativeId, repositoryId)
  SELECT id, type, taskId, payload, objectiveId, initiativeId, repositoryId FROM events;
DROP TABLE events;
ALTER TABLE events_new10 RENAME TO events;
CREATE INDEX events_project_cursor ON events(projectId, id);
`),
  },
  {
    version: 27,
    name: "013-s1-job-lease-revocation",
    // EPIC 013 Story 1 — revocation state on the existing jobs row. The row id
    // is the lease token; these two columns make a revoked lease observable.
    // ALTER ADD COLUMN (mirrors migration 6's `tasks.sha256`) — no rebuild, so
    // the partial unique index `jobs_queued_taskId` is untouched.
    up: (db) =>
      db.exec(`
ALTER TABLE jobs ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN revokeReason TEXT;
`),
  },
  {
    version: 28,
    name: "013-s5-task-abandoned-event",
    // EPIC 013 Story 5 — admit 'task.abandoned' in the events.type CHECK list
    // (SQLite can't ALTER a CHECK constraint; rebuild the table). Mirrors the
    // events_newN pattern used by migration 26: all 8 columns preserved verbatim,
    // only the CHECK list grows by one literal. The CHECK literal list MUST be
    // exactly the 28 EVENT_TYPES members — no more, no fewer.
    //
    // EPIC 011 S3 added `projectId` denormalised onto every event row, and the
    // `events_project_cursor` index on `(projectId, id)`. The CREATE TABLE
    // column list and the INSERT…SELECT column list both carry `projectId`
    // explicitly; the migration recreates the index after RENAME. `events` is
    // not an FK parent (precedent comment at migrations.ts:488-492), so no
    // disableForeignKeys is needed.
    up: (db) =>
      db.exec(`
CREATE TABLE events_new11 (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN (
                 'task.created','task.ready','task.started','task.completed',
                 'task.failed','task.dependencies_changed',
                 'task.escalated','task.approved','task.rejected','task.discarded',
                 'task.abandoned','task.blocked','task.conflict',
                 'agent.started','agent.progress','agent.finished',
                 'task.verification','provider.retry','provider.failover',
                 'objective.building','objective.awaiting_confirmation',
                 'objective.integrated','objective.conflict',
                 'initiative.landed','candidate.transplanted','repository.published',
                 'objective.discarded','initiative.discarded'
               )),
  taskId       TEXT REFERENCES tasks(id),
  payload      TEXT,
  objectiveId  TEXT REFERENCES objectives(id),
  initiativeId TEXT REFERENCES initiatives(id),
  repositoryId TEXT,
  projectId    TEXT
);
INSERT INTO events_new11 (id, type, taskId, payload, objectiveId, initiativeId, repositoryId, projectId)
  SELECT id, type, taskId, payload, objectiveId, initiativeId, repositoryId, projectId FROM events;
DROP TABLE events;
ALTER TABLE events_new11 RENAME TO events;
CREATE INDEX events_project_cursor ON events(projectId, id);
`),
  },
  {
    version: 29,
    name: "014-s3-daemon-heartbeats",
    // EPIC 014 Story 3 — daemon heartbeat observation table. One row per
    // daemon instance, keyed by `instanceId` (`pid + ":" + startedAtMs`).
    // A re-beat upserts `lastBeatMs`; two distinct instanceIds are a
    // reportable "multiple" state, not an error. The table is observation
    // only — no lease, no FK to projects (a stopped daemon's project may
    // have been deleted). Read by the `daemon` check in
    // `buildProjectReadiness` (src/app/project/project-readiness.ts).
    up: (db) =>
      db.exec(`
CREATE TABLE daemon_heartbeats (
  instanceId  TEXT PRIMARY KEY,
  pid         INTEGER NOT NULL,
  startedAtMs INTEGER NOT NULL,
  lastBeatMs  INTEGER NOT NULL
);
`),
  },
  {
    version: 30,
    name: "016-s5-project-acks",
    // EPIC 016 Story 5 — per-project last-acknowledged event cursor. The
    // cursor is a ULID; the `ack project --cursor <ulid>` CLI command is
    // the only writer. The "not ahead of the feed" guard reads the project's
    // latest event id from `events.projectId` (EPIC 011 Story 3's column).
    // One row per project, so a re-ack of the same projectId overwrites the
    // stored cursor; this is the PK invariant that backs the monotonic
    // cursor (AckProject refuses a backwards ack at the use-case layer).
    // Plain `CREATE TABLE`, not `IF NOT EXISTS` — mirrors migration 15
    // (publications). Additive: it does not rebuild `events`, so it cannot
    // drop another epic's column.
    up: (db) =>
      db.exec(`
CREATE TABLE project_acks (
  projectId TEXT PRIMARY KEY REFERENCES projects(id),
  cursor    TEXT NOT NULL
);
`),
  },
];

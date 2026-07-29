import type { DatabaseSync } from "node:sqlite";

import type { InitiativeRepository, CasResult } from "../port.ts";
import type {
  Initiative,
  Objective,
  InitiativeStatus,
  ObjectiveStatus,
} from "../../domain/initiative.ts";
import {
  sha256Hex,
  canonicalInitiative,
  canonicalObjective,
} from "./node-sha.ts";

type SqliteObjectiveRow = {
  id: string;
  initiativeId: string;
  name: string;
  status: ObjectiveStatus;
  commitOid: string | null;
  parentOid: string | null;
  note: string | null;
  conflictCause: string | null;
  observedTipOid: string | null;
  conflictReason: string | null;
};

function hydrateObjective(row: SqliteObjectiveRow): Objective {
  const objective: Objective = {
    id: row.id,
    initiativeId: row.initiativeId,
    name: row.name,
    status: row.status,
  };
  if (row.commitOid !== null) objective.commitOid = row.commitOid;
  if (row.parentOid !== null) objective.parentOid = row.parentOid;
  if (row.note !== null) objective.note = row.note;
  if (
    row.conflictCause === "non-single-commit" ||
    row.conflictCause === "cas-mismatch"
  ) {
    objective.conflictCause = row.conflictCause;
  }
  if (row.observedTipOid !== null)
    objective.observedTipOid = row.observedTipOid;
  if (row.conflictReason !== null)
    objective.conflictReason = row.conflictReason;
  return objective;
}

/** `node:sqlite` adapter for the `InitiativeRepository` port. */
export class SqliteInitiativeRepository implements InitiativeRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  save(initiative: Initiative): void {
    const after = this.#db
      .prepare(
        "SELECT dependency FROM initiative_dependencies WHERE initiativeId = ? ORDER BY dependency",
      )
      .all(initiative.id) as Array<{ dependency: string }>;
    const afterList = after.map((r) => r.dependency);
    const sha256 = sha256Hex(
      canonicalInitiative({
        name: initiative.name,
        projectId: initiative.projectId,
        after: afterList,
      }),
    );
    const status = initiative.status ?? "building";
    this.#db
      .prepare(
        "INSERT INTO initiatives (id, projectId, name, paused, sha256, status) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, sha256 = excluded.sha256, status = excluded.status",
      )
      .run(
        initiative.id,
        initiative.projectId,
        initiative.name,
        initiative.paused ? 1 : 0,
        sha256,
        status,
      );
  }

  get(id: string): Initiative | undefined {
    const row = this.#db
      .prepare(
        "SELECT id, projectId, name, paused, status, workspace FROM initiatives WHERE id = ?",
      )
      .get(id) as
      | {
          id: string;
          projectId: string;
          name: string;
          paused: number;
          status: InitiativeStatus;
          workspace: string | null;
        }
      | undefined;
    if (row === undefined) return undefined;
    const initiative: Initiative = {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      paused: row.paused === 1,
      status: row.status,
    };
    if (row.workspace !== null) initiative.workspace = row.workspace;
    return initiative;
  }

  saveObjective(objective: Objective): void {
    const after = this.#db
      .prepare(
        "SELECT dependency FROM objective_dependencies WHERE objectiveId = ? ORDER BY dependency",
      )
      .all(objective.id) as Array<{ dependency: string }>;
    const afterList = after.map((r) => r.dependency);
    const sha256 = sha256Hex(
      canonicalObjective({
        name: objective.name,
        initiativeId: objective.initiativeId,
        after: afterList,
      }),
    );
    const status = objective.status ?? "building";
    const commitOid = objective.commitOid ?? null;
    const parentOid = objective.parentOid ?? null;
    const note = objective.note ?? null;
    const conflictCause = objective.conflictCause ?? null;
    const observedTipOid = objective.observedTipOid ?? null;
    const conflictReason = objective.conflictReason ?? null;
    this.#db
      .prepare(
        "INSERT INTO objectives (id, initiativeId, name, sha256, status, commitOid, parentOid, note, conflictCause, observedTipOid, conflictReason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, sha256 = excluded.sha256, status = excluded.status, commitOid = excluded.commitOid, parentOid = excluded.parentOid, note = excluded.note, conflictCause = excluded.conflictCause, observedTipOid = excluded.observedTipOid, conflictReason = excluded.conflictReason",
      )
      .run(
        objective.id,
        objective.initiativeId,
        objective.name,
        sha256,
        status,
        commitOid,
        parentOid,
        note,
        conflictCause,
        observedTipOid,
        conflictReason,
      );
  }

  getObjective(id: string): Objective | undefined {
    const row = this.#db
      .prepare(
        "SELECT id, initiativeId, name, status, commitOid, parentOid, note, conflictCause, observedTipOid, conflictReason FROM objectives WHERE id = ?",
      )
      .get(id) as SqliteObjectiveRow | undefined;
    if (row === undefined) return undefined;
    return hydrateObjective(row);
  }

  listObjectives(initiativeId: string): Objective[] {
    const rows = this.#db
      .prepare(
        "SELECT id, initiativeId, name, status, commitOid, parentOid, note, conflictCause, observedTipOid, conflictReason FROM objectives WHERE initiativeId = ? ORDER BY id ASC",
      )
      .all(initiativeId) as SqliteObjectiveRow[];
    return rows.map(hydrateObjective);
  }

  listInitiatives(projectId: string): Initiative[] {
    const rows = this.#db
      .prepare(
        "SELECT id, projectId, name, paused, status, workspace FROM initiatives WHERE projectId = ? ORDER BY id ASC",
      )
      .all(projectId) as Array<{
      id: string;
      projectId: string;
      name: string;
      paused: number;
      status: InitiativeStatus;
      workspace: string | null;
    }>;
    return rows.map((r) => {
      const initiative: Initiative = {
        id: r.id,
        projectId: r.projectId,
        name: r.name,
        paused: r.paused === 1,
        status: r.status,
      };
      if (r.workspace !== null) initiative.workspace = r.workspace;
      return initiative;
    });
  }

  resolveInitiativeByName(projectId: string, name: string): string[] {
    const rows = this.#db
      .prepare("SELECT id FROM initiatives WHERE projectId = ? AND name = ?")
      .all(projectId, name) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  resolveObjectiveByName(initiativeId: string, name: string): string[] {
    const rows = this.#db
      .prepare("SELECT id FROM objectives WHERE initiativeId = ? AND name = ?")
      .all(initiativeId, name) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  setPaused(id: string, paused: boolean): void {
    this.#db
      .prepare("UPDATE initiatives SET paused = ? WHERE id = ?")
      .run(paused ? 1 : 0, id);
  }

  setWorkspace(id: string, dir: string): void {
    this.#db
      .prepare("UPDATE initiatives SET workspace = ? WHERE id = ?")
      .run(dir, id);
  }

  listAllInitiatives(): Array<{ id: string; paused: boolean }> {
    const rows = this.#db
      .prepare("SELECT id, paused FROM initiatives")
      .all() as Array<{ id: string; paused: number }>;
    return rows.map((r) => ({ id: r.id, paused: r.paused === 1 }));
  }

  getSha256(id: string): string | undefined {
    type Row = { sha256: string };
    // Check initiatives first, then objectives
    const initRow = this.#db
      .prepare("SELECT sha256 FROM initiatives WHERE id = ?")
      .get(id) as Row | undefined;
    if (initRow !== undefined) return initRow.sha256;
    const objRow = this.#db
      .prepare("SELECT sha256 FROM objectives WHERE id = ?")
      .get(id) as Row | undefined;
    return objRow?.sha256;
  }

  /**
   * Conditionally rename an initiative.
   * Returns `applied` with a fresh sha on success, or `conflict` with the
   * current stored sha when `expectedSha` does not match.
   */
  conditionalRenameInitiative(
    id: string,
    expectedSha: string,
    name: string,
  ): CasResult {
    type ShaRow = { sha256: string; projectId: string };
    const row = this.#db
      .prepare("SELECT sha256, projectId FROM initiatives WHERE id = ?")
      .get(id) as ShaRow | undefined;
    const currentSha = row?.sha256 ?? "";
    if (currentSha !== expectedSha) {
      return { status: "conflict", currentSha };
    }
    const after = this.#db
      .prepare(
        "SELECT dependency FROM initiative_dependencies WHERE initiativeId = ? ORDER BY dependency",
      )
      .all(id) as Array<{ dependency: string }>;
    const afterList = after.map((r) => r.dependency);
    const freshSha = sha256Hex(
      canonicalInitiative({
        name,
        projectId: row!.projectId,
        after: afterList,
      }),
    );
    this.#db
      .prepare("UPDATE initiatives SET name = ?, sha256 = ? WHERE id = ?")
      .run(name, freshSha, id);
    return { status: "applied", freshSha };
  }

  /**
   * Conditionally rename an objective.
   * Returns `applied` with a fresh sha on success, or `conflict` with the
   * current stored sha when `expectedSha` does not match.
   */
  conditionalRenameObjective(
    id: string,
    expectedSha: string,
    name: string,
  ): CasResult {
    type ShaRow = { sha256: string; initiativeId: string };
    const row = this.#db
      .prepare("SELECT sha256, initiativeId FROM objectives WHERE id = ?")
      .get(id) as ShaRow | undefined;
    const currentSha = row?.sha256 ?? "";
    if (currentSha !== expectedSha) {
      return { status: "conflict", currentSha };
    }
    const after = this.#db
      .prepare(
        "SELECT dependency FROM objective_dependencies WHERE objectiveId = ? ORDER BY dependency",
      )
      .all(id) as Array<{ dependency: string }>;
    const afterList = after.map((r) => r.dependency);
    const freshSha = sha256Hex(
      canonicalObjective({
        name,
        initiativeId: row!.initiativeId,
        after: afterList,
      }),
    );
    this.#db
      .prepare("UPDATE objectives SET name = ?, sha256 = ? WHERE id = ?")
      .run(name, freshSha, id);
    return { status: "applied", freshSha };
  }

  /**
   * Conditionally delete an empty objective.
   * Returns `applied` on success (empty + sha match), or a non-applied result
   * when the objective is non-empty or the sha is stale.
   */
  conditionalDeleteObjective(id: string, expectedSha: string): CasResult {
    type ShaRow = { sha256: string };
    type CountRow = { count: number };
    const shaRow = this.#db
      .prepare("SELECT sha256 FROM objectives WHERE id = ?")
      .get(id) as ShaRow | undefined;
    const currentSha = shaRow?.sha256 ?? "";
    if (currentSha !== expectedSha) {
      return { status: "conflict", currentSha };
    }
    const countRow = this.#db
      .prepare("SELECT COUNT(*) AS count FROM tasks WHERE objectiveId = ?")
      .get(id) as CountRow | undefined;
    const taskCount = countRow?.count ?? 0;
    if (taskCount > 0) {
      // Non-empty: cannot delete — return a non-applied signal
      return { status: "conflict", currentSha: "" };
    }
    this.#db.prepare("DELETE FROM objectives WHERE id = ?").run(id);
    return { status: "applied", freshSha: "" };
  }
}

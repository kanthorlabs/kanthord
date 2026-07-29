// src/app/objective/get-objective-conflict.ts — query use case: read the
// objective-level conflict record (epic 017 Decision 2). An objective
// conflict is a ref-update failure (stale anchor / CAS mismatch), not a
// file-level merge conflict — there is no `files` key. Read-only: no
// UnitOfWork, no event append, no `save*`.

import type { Objective } from "../../domain/initiative.ts";
import type { CommitPresence } from "../../commit-presence/port.ts";
import { UnknownReferenceError } from "../errors.ts";

// ---------------------------------------------------------------------------
// Port types (narrow — owned by this consumer per AGENTS.md)
// ---------------------------------------------------------------------------

interface ObjectiveSource {
  getObjective(id: string): Objective | undefined;
}

interface TipBroker {
  currentTip?(homeDir: string, ref: string): Promise<string>;
}

type CommitPresenceSource = CommitPresence;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface ObjectiveConflictOutput {
  objectiveId: string;
  initiativeId: string;
  status: "conflict";
  /** Why `approve objective` recorded the conflict. `null` on pre-migration rows. */
  conflictCause: "non-single-commit" | "cas-mismatch" | null;
  /** The stale anchor the squash was built on. */
  parentOid: string | null;
  /** The candidate commit. */
  commitOid: string | null;
  /** The ref's OID observed at CAS-failure time; `null` unless `cas-mismatch`. */
  observedTipOid: string | null;
  /** The initiative branch's live tip, read now. */
  currentTip: string | null;
  /** `currentTip !== parentOid`. Live evidence, NOT the cause. */
  tipMovedSinceAnchor: boolean;
  /** Set when a conflict-resolution gate run failed. */
  conflictReason: string | null;
  /** The consolidated guidance note stored by `retry objective --note`. */
  note: string | null;
  evidence: {
    basis: "verification-and-summary";
    diffAvailable: false;
    inspect: { executable: "git"; args: string[] } | null;
  };
}

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

export class ObjectiveNotInConflictError extends Error {
  readonly objectiveId: string;
  readonly status: string;
  constructor(objectiveId: string, status: string) {
    super(`objective ${objectiveId} is not in conflict (status: ${status})`);
    this.name = "ObjectiveNotInConflictError";
    this.objectiveId = objectiveId;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Use case
// ---------------------------------------------------------------------------

const HEX_OID = /^[0-9a-f]{7,64}$/;

export class GetObjectiveConflict {
  readonly #objectives: ObjectiveSource;
  readonly #broker: TipBroker;
  readonly #resolveHomeDir: (initiativeId: string) => string;
  readonly #commitPresence: CommitPresenceSource;

  constructor(
    objectives: ObjectiveSource,
    broker: TipBroker,
    resolveHomeDir: (initiativeId: string) => string,
    commitPresence: CommitPresenceSource,
  ) {
    this.#objectives = objectives;
    this.#broker = broker;
    this.#resolveHomeDir = resolveHomeDir;
    this.#commitPresence = commitPresence;
  }

  async execute(input: {
    objectiveId: string;
  }): Promise<ObjectiveConflictOutput> {
    const { objectiveId } = input;

    const objective = this.#objectives.getObjective(objectiveId);
    if (!objective) {
      throw new UnknownReferenceError("objective", objectiveId);
    }

    const status = objective.status ?? "building";
    if (status !== "conflict") {
      throw new ObjectiveNotInConflictError(objectiveId, status);
    }

    const homeDir = this.#resolveHomeDir(objective.initiativeId);
    const ref = `refs/heads/kanthord/init/${objective.initiativeId}`;

    let currentTip: string | null = null;
    if (this.#broker.currentTip) {
      try {
        currentTip = await this.#broker.currentTip(homeDir, ref);
      } catch {
        currentTip = null;
      }
    }

    const parentOid = objective.parentOid ?? null;
    const commitOid = objective.commitOid ?? null;
    const tipMovedSinceAnchor =
      currentTip !== null && parentOid !== null && currentTip !== parentOid;

    let inspect: { executable: "git"; args: string[] } | null = null;
    if (
      homeDir.length > 0 &&
      parentOid !== null &&
      commitOid !== null &&
      HEX_OID.test(parentOid) &&
      HEX_OID.test(commitOid)
    ) {
      const results = await this.#commitPresence.hasCommits(homeDir, [
        parentOid,
        commitOid,
      ]);
      const present = results[0] === true && results[1] === true;
      if (present) {
        inspect = {
          executable: "git",
          args: ["-C", homeDir, "diff", `${parentOid}..${commitOid}`],
        };
      }
    }

    return {
      objectiveId,
      initiativeId: objective.initiativeId,
      status: "conflict",
      conflictCause: objective.conflictCause ?? null,
      parentOid,
      commitOid,
      observedTipOid: objective.observedTipOid ?? null,
      currentTip,
      tipMovedSinceAnchor,
      conflictReason: objective.conflictReason ?? null,
      note: objective.note ?? null,
      evidence: {
        basis: "verification-and-summary",
        diffAvailable: false,
        inspect,
      },
    };
  }
}

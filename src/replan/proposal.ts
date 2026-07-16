import type { Store } from "../foundations/sqlite-store.ts";

export type ReplanProposal = {
  proposalId: string;
  featureId: string;
  baseGeneration: number;
  baseCompileHash: string;
  createdAt: number;
  edits: Array<{ path: string; newContent: string }>;
  displayFiles: Array<{
    path: string;
    lines: Array<{ kind: string; content: string }>;
  }>;
};

type ReplanProposalRow = {
  proposal_id: string;
  feature_id: string;
  base_generation: number;
  base_compile_hash: string;
  created_at: number;
  edits_json: string;
  display_files_json: string;
};

export function initReplanProposalSchema(store: Store): void {
  store.run(
    `CREATE TABLE IF NOT EXISTS replan_proposal (
      proposal_id        TEXT    NOT NULL PRIMARY KEY,
      feature_id         TEXT    NOT NULL,
      base_generation    INTEGER NOT NULL,
      base_compile_hash  TEXT    NOT NULL,
      created_at         INTEGER NOT NULL,
      edits_json         TEXT    NOT NULL,
      display_files_json TEXT    NOT NULL,
      approved_at        INTEGER
    )`,
  );
  store.run(
    `CREATE INDEX IF NOT EXISTS replan_proposal_pending_feature
     ON replan_proposal (feature_id, created_at DESC)
     WHERE approved_at IS NULL`,
  );
}

export function recordReplanProposal(store: Store, proposal: ReplanProposal): void {
  const existing = store.get<ReplanProposalRow>(
    `SELECT proposal_id, feature_id, base_generation, base_compile_hash, created_at,
            edits_json, display_files_json
     FROM replan_proposal WHERE proposal_id = ?`,
    proposal.proposalId,
  );
  if (existing !== undefined) {
    if (!sameProposal(fromRow(existing), proposal)) {
      throw new Error(`replan proposal ${proposal.proposalId} duplicates different content`);
    }
    return;
  }

  store.run(
    `INSERT INTO replan_proposal (
      proposal_id, feature_id, base_generation, base_compile_hash, created_at, edits_json, display_files_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    proposal.proposalId,
    proposal.featureId,
    proposal.baseGeneration,
    proposal.baseCompileHash,
    proposal.createdAt,
    JSON.stringify(proposal.edits),
    JSON.stringify(proposal.displayFiles),
  );
}

export function getPendingReplanProposal(
  store: Store,
  featureId: string,
): ReplanProposal | undefined {
  const row = store.get<ReplanProposalRow>(
    `SELECT proposal_id, feature_id, base_generation, base_compile_hash, created_at,
            edits_json, display_files_json
     FROM replan_proposal
     WHERE feature_id = ? AND approved_at IS NULL
     ORDER BY created_at DESC, rowid DESC
     LIMIT 1`,
    featureId,
  );
  return row === undefined ? undefined : fromRow(row);
}

export function getPendingReplanProposalById(
  store: Store,
  proposalId: string,
): ReplanProposal | undefined {
  const row = store.get<ReplanProposalRow>(
    `SELECT proposal_id, feature_id, base_generation, base_compile_hash, created_at,
            edits_json, display_files_json
     FROM replan_proposal
     WHERE proposal_id = ? AND approved_at IS NULL`,
    proposalId,
  );
  return row === undefined ? undefined : fromRow(row);
}

export function markReplanProposalApproved(
  store: Store,
  proposalId: string,
  approvedAt: number,
): void {
  store.run(
    "UPDATE replan_proposal SET approved_at = ? WHERE proposal_id = ? AND approved_at IS NULL",
    approvedAt,
    proposalId,
  );
}

function fromRow(row: ReplanProposalRow): ReplanProposal {
  return {
    proposalId: row.proposal_id,
    featureId: row.feature_id,
    baseGeneration: row.base_generation,
    baseCompileHash: row.base_compile_hash,
    createdAt: row.created_at,
    edits: JSON.parse(row.edits_json) as ReplanProposal["edits"],
    displayFiles: JSON.parse(row.display_files_json) as ReplanProposal["displayFiles"],
  };
}

function sameProposal(left: ReplanProposal, right: ReplanProposal): boolean {
  return (
    left.proposalId === right.proposalId &&
    left.featureId === right.featureId &&
    left.baseGeneration === right.baseGeneration &&
    left.baseCompileHash === right.baseCompileHash &&
    left.createdAt === right.createdAt &&
    JSON.stringify(left.edits) === JSON.stringify(right.edits) &&
    JSON.stringify(left.displayFiles) === JSON.stringify(right.displayFiles)
  );
}

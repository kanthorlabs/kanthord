import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import { initSchema } from "../store/schema.ts";
import {
  getPendingReplanProposal,
  markReplanProposalApproved,
  recordReplanProposal,
} from "./proposal.ts";
import type { Store } from "../foundations/sqlite-store.ts";

type ReplanProposal = {
  proposalId: string;
  featureId: string;
  baseGeneration: number;
  baseCompileHash: string;
  createdAt: number;
  edits: Array<{ path: string; newContent: string }>;
  displayFiles: Array<{
    path: string;
    lines: Array<{ kind: "ctx" | "add" | "del"; content: string }>;
  }>;
};

function proposal(overrides: Partial<ReplanProposal> = {}): ReplanProposal {
  return {
    proposalId: "replan-proposal-001",
    featureId: "feature-replan-001",
    baseGeneration: 7,
    baseCompileHash: "compile-hash-7",
    createdAt: 1_721_000_000_000,
    edits: [
      { path: "001-plan/001-task.md", newContent: "revised task content" },
      { path: "001-plan/002-task.md", newContent: "new task content" },
    ],
    displayFiles: [
      {
        path: "001-plan/001-task.md",
        lines: [
          { kind: "ctx", content: "# Task" },
          { kind: "del", content: "old task content" },
          { kind: "add", content: "revised task content" },
        ],
      },
      {
        path: "001-plan/002-task.md",
        lines: [{ kind: "add", content: "new task content" }],
      },
    ],
    ...overrides,
  };
}

describe("src/replan/proposal.ts", () => {
  let tempDir: string | undefined;
  let store: Store | undefined;

  afterEach(async () => {
    store?.close();
    store = undefined;
    if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  function openProposalStore(): Store {
    if (tempDir === undefined) throw new Error("test store directory has not been created");
    store = openStore(join(tempDir, "replan.db"), { busyTimeout: 1_000 });
    initSchema(store);
    return store;
  }

  async function createProposalStore(): Promise<Store> {
    tempDir = await mkdtemp(join(tmpdir(), "kanthord-replan-proposal-"));
    return openProposalStore();
  }

  test("persists an immutable, ordered pending proposal and rejects a changed duplicate id", async () => {
    const proposalStore = await createProposalStore();
    const pending = proposal();

    recordReplanProposal(proposalStore, pending);
    pending.edits[0]!.newContent = "mutated after record";
    pending.displayFiles[0]!.lines[2]!.content = "mutated display after record";

    assert.deepEqual(getPendingReplanProposal(proposalStore, pending.featureId), proposal());
    assert.throws(
      () => recordReplanProposal(proposalStore, proposal({ edits: [{ path: "epic.md", newContent: "different" }] })),
      /proposal|duplicate|content/i,
      "a proposal id cannot be reused for different authored content",
    );
  });

  test("returns the newest pending proposal for a feature after the store reopens", async () => {
    const proposalStore = await createProposalStore();
    const earlier = proposal({ proposalId: "replan-proposal-earlier", createdAt: 1_721_000_000_001 });
    const newest = proposal({ proposalId: "replan-proposal-newest", createdAt: 1_721_000_000_002 });
    recordReplanProposal(proposalStore, earlier);
    recordReplanProposal(proposalStore, newest);

    proposalStore.close();
    store = undefined;
    const reopenedStore = openProposalStore();

    assert.deepEqual(getPendingReplanProposal(reopenedStore, newest.featureId), newest);
  });

  test("marks a proposal approved without making its durable identity reusable", async () => {
    const proposalStore = await createProposalStore();
    const pending = proposal();
    recordReplanProposal(proposalStore, pending);

    markReplanProposalApproved(proposalStore, pending.proposalId, 1_721_000_000_100);

    assert.equal(getPendingReplanProposal(proposalStore, pending.featureId), undefined);
    assert.throws(
      () => recordReplanProposal(proposalStore, proposal({ baseCompileHash: "changed-after-approval" })),
      /proposal|duplicate|content/i,
      "approval must retain the durable proposal row and its immutable identity",
    );
  });
});

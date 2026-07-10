/**
 * 2A security scenario — daemon killed between submit and completion;
 * restart reconciles via head-branch lookup on the double with no second
 * create request; op reaches a terminal state.
 * Story 001 T2 (Epic 019). Exercises Epics 009+014 composed.
 *
 * The github.create_pr adapter (Epic 014) submitted a PR before the simulated
 * daemon kill. On restart the adapter's in-memory state is gone but the
 * broker's durable submit record and the double's PR state remain. Calling
 * reconcile on a fresh adapter instance must call listByHead (head-branch
 * lookup) to discover the existing PR — not issue a second createPr — and
 * must return a terminal outcome.
 */

// MUST be the first import — installs the no-network + credential guard.
import "../no-network-guard.ts";

import { test } from "node:test";
import assert from "node:assert/strict";

import { run2aKillMidCreatePrScenario } from "./2a-kill-mid-create-pr.ts";
import type { KillMidCreatePrResult } from "./2a-kill-mid-create-pr.ts";
import { harness } from "../harness.ts";
import { initSchema } from "../../store/schema.ts";

// ---------------------------------------------------------------------------
// Suite: src/harness/scenarios/2a-kill-mid-create-pr
// ---------------------------------------------------------------------------

test(
  "2A kill mid create_pr: restart reconciles via head-branch lookup with no second create call",
  async () => {
    const h = await harness();
    initSchema(h.store);
    try {
      const result = await run2aKillMidCreatePrScenario({
        clock: h.clock,
        store: h.store,
      });

      assert.equal(
        result.createCallCountBeforeKill,
        1,
        "exactly one PR create request must have been made before the simulated kill",
      );
      assert.equal(
        result.createCallCountAfterRestart,
        0,
        "no second PR create request after restart — reconcile must use listByHead, not createPr",
      );
      assert.ok(
        result.listByHeadCallCount >= 1,
        "reconcile must call listByHead at least once to look up the PR by head branch",
      );
      assert.equal(
        result.outcomeIsTerminal,
        true,
        "op must reach a terminal state (done or failed) after reconciliation — not resubmit",
      );
    } finally {
      await h[Symbol.asyncDispose]();
    }
  },
);

test(
  "2A kill mid create_pr: reconcile resolves to done when existing open PR is found in double",
  async () => {
    const h = await harness();
    initSchema(h.store);
    try {
      const result = await run2aKillMidCreatePrScenario({
        clock: h.clock,
        store: h.store,
      });

      assert.equal(
        result.reconcileOutcome,
        "done",
        "reconcile must return done when the double reports an open PR for the head branch",
      );
    } finally {
      await h[Symbol.asyncDispose]();
    }
  },
);

test(
  "2A kill mid create_pr: durable broker_completion row for the op reaches terminal done after reconcile",
  async () => {
    const h = await harness();
    initSchema(h.store);
    try {
      const result = await run2aKillMidCreatePrScenario({
        clock: h.clock,
        store: h.store,
      });

      // The scenario must return the submitted op_id so the durable
      // broker_completion row can be verified by op identity.  This field is
      // absent until the scenario routes reconcile through reconcileOp (not
      // adapter directly) and exposes the op_id in its result.
      const opId = (result as KillMidCreatePrResult & { opId?: string }).opId;
      assert.ok(
        typeof opId === "string" && opId.length > 0,
        "scenario must expose the submitted op_id — reconcile must flow through reconcileOp so the durable row is written",
      );

      // After reconcileOp writes the completion row, the broker_completion
      // table must have a terminal 'done' record for this specific op.
      const row = h.store.get<{ status: string }>(
        "SELECT status FROM broker_completion WHERE op_id = ?",
        opId,
      );
      assert.ok(
        row !== undefined && row.status === "done",
        `broker_completion must have a terminal 'done' row for op_id ${opId} — got ${JSON.stringify(row)}`,
      );
    } finally {
      await h[Symbol.asyncDispose]();
    }
  },
);

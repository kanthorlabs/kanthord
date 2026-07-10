/**
 * 2A security scenario — budget breach halts before the breaching call,
 * escalation captured with cost attribution, respawn does not reset.
 * Story 001 T2 (Epic 019). Exercises Epics 013+016+017 composed.
 *
 * The budget circuit-breaker (Epic 013) fires when a scripted session's
 * projected spend would exceed the hard ceiling.  The halt occurs before any
 * adapter/model call is made.  The escalation flows into the inbox (Epic 017)
 * with cost attribution (task_id).  After a simulated daemon restart
 * (re-creating the breaker on the same persistent storage), the next reserve
 * call is still halted — spend state is durable, not in-memory-only.
 */

// MUST be the first import — installs the no-network + credential guard.
import "../no-network-guard.ts";

import { test } from "node:test";
import assert from "node:assert/strict";

import { run2aBudgetBreachScenario } from "./2a-budget-breach.ts";
import { harness } from "../harness.ts";
import { initSchema } from "../../store/schema.ts";

// ---------------------------------------------------------------------------
// Suite: src/harness/scenarios/2a-budget-breach
// ---------------------------------------------------------------------------

test(
  "2A budget breach halts the call before the adapter is invoked and escalation reaches inbox",
  async () => {
    const h = await harness();
    initSchema(h.store);
    try {
      const result = await run2aBudgetBreachScenario({
        clock: h.clock,
        store: h.store,
      });

      assert.equal(
        result.reserveDecision,
        "halted",
        "budget breaker must return 'halted' when projected spend would exceed the ceiling",
      );
      assert.equal(
        result.escalationTag,
        "budget-breach",
        "escalation event must carry the budget-breach tag (Epic 013 circuit-breaker)",
      );
      assert.equal(
        result.inboxItem.kind,
        "escalation",
        "inbox item created by budget breach must be kind 'escalation' (Epic 017)",
      );
      assert.equal(
        result.inboxItem.taskId,
        "task-budget-breach",
        "inbox item evidence must carry task_id for cost attribution",
      );
      assert.equal(
        result.adapterCallCount,
        0,
        "halt must prevent the adapter call — no provider charge after the reservation is blocked",
      );
    } finally {
      await h[Symbol.asyncDispose]();
    }
  },
);

test(
  "2A budget breach respawn does not reset — budget persists across daemon restart",
  async () => {
    const h = await harness();
    initSchema(h.store);
    try {
      const result = await run2aBudgetBreachScenario({
        clock: h.clock,
        store: h.store,
      });

      assert.equal(
        result.respawnHalted,
        true,
        "after simulated restart (new breaker on same storage), a reserve call is still halted",
      );
    } finally {
      await h[Symbol.asyncDispose]();
    }
  },
);

/**
 * 2A security scenario — budget breach halts before the breaching call,
 * escalation captured with cost attribution, respawn does not reset.
 * Story 001 T2 (Epic 019). Exercises Epics 013+016+017 composed.
 *
 * Wire order:
 *   1. Build an in-memory BudgetStorage that persists across "restarts"
 *      (shared Map object simulates durable storage).
 *   2. Create a BudgetBreaker with a ceiling that allows one call (3.0)
 *      but not two (ceiling = 5.0 < 6.0).
 *   3. First reserve → "proceed" (legitimate call below ceiling).
 *   4. Second reserve → "halted" (would breach); capture escalation tag.
 *      Track adapterCallCount: only incremented if the reserve returns "proceed",
 *      so it stays 0 when the halt fires correctly.
 *   5. Create inbox escalation item with task_id for cost attribution.
 *   6. Simulate respawn: new breaker on the same storage → must still halt
 *      (spend state is durable, not in-memory-only).
 */

import type { FakeClock } from "../../foundations/clock.ts";
import type { Store } from "../../foundations/sqlite-store.ts";
import {
  makeBudgetBreaker,
  type BudgetOptions,
  type BudgetStorage,
  type BudgetEscalationEvent,
} from "../../ring1/budget.ts";
import { createEscalationItem } from "../../inbox/inbox.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BudgetBreachFixture = {
  clock: FakeClock;
  store: Store;
};

export type BudgetBreachResult = {
  reserveDecision: "proceed" | "halted";
  escalationTag: string;
  inboxItem: { kind: string; taskId: string };
  adapterCallCount: number;
  respawnHalted: boolean;
};

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const TASK_ID = "task-budget-breach";

/** Per-call cost that is below the ceiling for a single call but breaches on two. */
const CALL_COST = 3.0;

/**
 * Ceiling: 5.0 allows a first call (0 + 3.0 = 3.0 ≤ 5.0 → proceed) but
 * blocks the second (3.0 + 3.0 = 6.0 > 5.0 → halted).
 */
const BREAKER_OPTS: BudgetOptions = {
  ceiling: 5.0,
  conservativeCost: CALL_COST,
};

// ---------------------------------------------------------------------------
// run2aBudgetBreachScenario — public entry point
// ---------------------------------------------------------------------------

/**
 * Run the budget breach scenario with the supplied harness fixture.
 *
 * Returns the observable facts used by the two assertions in
 * 2a-budget-breach.test.ts (reserve decision, escalation tag, inbox item,
 * adapter call count after halt, respawn-halted flag).
 */
export async function run2aBudgetBreachScenario(
  fixture: BudgetBreachFixture,
): Promise<BudgetBreachResult> {
  const { clock, store } = fixture;

  // -------------------------------------------------------------------------
  // 1. In-memory BudgetStorage that survives "daemon restart" within the test
  //    (shared Map object passed to both the initial and the respawn breaker).
  // -------------------------------------------------------------------------
  const spendMap = new Map<string, number>();
  const budgetStorage: BudgetStorage = {
    async load(taskId: string): Promise<number> {
      return spendMap.get(taskId) ?? 0;
    },
    async save(taskId: string, spent: number): Promise<void> {
      spendMap.set(taskId, spent);
    },
  };

  let capturedEscalation: BudgetEscalationEvent | undefined;

  /** Factory: re-using the same storage models durable state across restarts. */
  function makeBreaker() {
    return makeBudgetBreaker(
      BREAKER_OPTS,
      budgetStorage,
      (e) => {
        capturedEscalation = e;
      },
      (_l) => {
        // finer-budget log entries are not relevant to this scenario
      },
    );
  }

  // -------------------------------------------------------------------------
  // 2–3. First reserve: legitimate call, ceiling not yet breached.
  // -------------------------------------------------------------------------
  const breaker = makeBreaker();
  await breaker.reserve(TASK_ID, CALL_COST); // → "proceed"; spend saved

  // -------------------------------------------------------------------------
  // 4. Second reserve: projected spend exceeds ceiling → "halted".
  //    adapterCallCount is only incremented inside the "proceed" branch —
  //    it stays 0 when halt fires correctly, proving no provider call occurred.
  // -------------------------------------------------------------------------
  let adapterCallCount = 0;
  const reserveDecision = await breaker.reserve(TASK_ID, CALL_COST);
  if (reserveDecision === "proceed") {
    adapterCallCount++;
  }

  const escalationTag = capturedEscalation?.tag ?? "";

  // -------------------------------------------------------------------------
  // 5. Persist inbox escalation item with task_id for cost attribution.
  // -------------------------------------------------------------------------
  const inboxItem = createEscalationItem({
    source_id: `${TASK_ID}:budget-breach`,
    task_id: TASK_ID,
    reason: "budget ceiling exceeded before breaching model call",
    payload_summary: `projected spend (${3.0 + CALL_COST}) exceeds ceiling of ${BREAKER_OPTS.ceiling}`,
    store,
    clock,
  });

  const taskIdVal = inboxItem.evidence["task_id"];
  const taskId = typeof taskIdVal === "string" ? taskIdVal : "";

  // -------------------------------------------------------------------------
  // 6. Simulate respawn: new breaker on the same storage.
  //    The first call's spend (3.0) persists → next reserve (0+3+3=6 > 5) halts.
  // -------------------------------------------------------------------------
  const respawnBreaker = makeBreaker();
  const respawnDecision = await respawnBreaker.reserve(TASK_ID, CALL_COST);
  const respawnHalted = respawnDecision === "halted";

  return {
    reserveDecision,
    escalationTag,
    inboxItem: { kind: inboxItem.kind, taskId },
    adapterCallCount,
    respawnHalted,
  };
}

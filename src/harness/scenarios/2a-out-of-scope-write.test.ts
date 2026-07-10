/**
 * 2A security scenario — out-of-scope write blocked, escalated, inbox item,
 * task waits, resume continues.
 * Story 001 T2 (Epic 019). Exercises Epics 015+017 composed.
 *
 * The ring-1 hook (Epic 015) fires when a scripted session tries to write
 * outside its declared write_scope. The escalation flows into the inbox
 * (Epic 017), the task is held waiting, and a "resume" response (Epic 017)
 * sets it back to pending so the scheduler can re-dispatch.
 */

// MUST be the first import — installs the no-network + credential guard.
import "../no-network-guard.ts";

import { test } from "node:test";
import assert from "node:assert/strict";

import { run2aOutOfScopeWriteScenario } from "./2a-out-of-scope-write.ts";
import { harness } from "../harness.ts";

// ---------------------------------------------------------------------------
// Suite: src/harness/scenarios/2a-out-of-scope-write
// ---------------------------------------------------------------------------

test(
  "2A out-of-scope write is blocked by ring-1 hook and escalation reaches inbox",
  async () => {
    const h = await harness();
    try {
      const result = await run2aOutOfScopeWriteScenario({
        clock: h.clock,
        store: h.store,
      });

      assert.ok(
        result.hookDecision.block === true,
        "ring-1 hook must return block:true for an out-of-scope write path",
      );
      assert.equal(
        result.escalationTag,
        "re-planning-signal",
        "escalation event must carry the re-planning-signal tag (Epic 015 / ring-1)",
      );
      assert.equal(
        result.inboxItem.kind,
        "escalation",
        "inbox item created by the escalation event must be kind 'escalation' (Epic 017)",
      );
      assert.equal(
        result.inboxItem.status,
        "open",
        "inbox item must be open while the task is waiting (before resume response)",
      );
      assert.equal(
        result.taskStatusBeforeResume,
        "running",
        "task must remain in 'running' state after the block — waiting for human response",
      );
    } finally {
      await h[Symbol.asyncDispose]();
    }
  },
);

test(
  "2A out-of-scope write: resume response sets task to pending and resolves inbox item",
  async () => {
    const h = await harness();
    try {
      const result = await run2aOutOfScopeWriteScenario({
        clock: h.clock,
        store: h.store,
      });

      assert.equal(
        result.taskStatusAfterResume,
        "pending",
        "resume response must set the task back to 'pending' so the scheduler can re-dispatch",
      );
      assert.equal(
        result.inboxItemStatusAfterResume,
        "resolved",
        "resume response must resolve the inbox item (Epic 017 respond surface)",
      );
    } finally {
      await h[Symbol.asyncDispose]();
    }
  },
);

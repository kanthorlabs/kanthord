/**
 * 2A security scenario — out-of-scope write blocked, escalated, inbox item,
 * task waits, resume continues.
 * Story 001 T2 (Epic 019). Exercises Epics 015+017 composed.
 *
 * Wire order:
 *   1. Bootstrap a minimal scheduler task row (status=running).
 *   2. Invoke makeRing1HookAdapter with a restrictive writeScope.
 *   3. Call the hook with a path outside the scope — captures escalation.
 *   4. Persist the escalation as an inbox item via createEscalationItem.
 *   5. Capture task/inbox state before resume.
 *   6. Call resumeEscalationItem — sets task to pending, resolves item.
 *   7. Capture state after resume and return all observable facts.
 */

import type { FakeClock } from "../../foundations/clock.ts";
import type { Store } from "../../foundations/sqlite-store.ts";
import type { EscalationEvent } from "../../ring1/write-scope.ts";
import type { RolePathRegistry } from "../../ring1/role-path-policy.ts";
import { makeRing1HookAdapter } from "../../ring1/hook-binding.ts";
import type { BeforeToolCallContext } from "../../ring1/hook-binding.ts";
import { createEscalationItem } from "../../inbox/inbox.ts";
import { resumeEscalationItem } from "../../rpc/inbox-respond.ts";
import { initSchema } from "../../store/schema.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type OutOfScopeWriteFixture = {
  clock: FakeClock;
  store: Store;
};

export type OutOfScopeWriteResult = {
  hookDecision: { block: boolean; reason?: string };
  escalationTag: string;
  inboxItem: { kind: string; status: string; id: string };
  taskStatusBeforeResume: string;
  taskStatusAfterResume: string;
  inboxItemStatusAfterResume: string;
};

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const TASK_ID = "task-oos-write";
const FEATURE_ID = "test-feature-oos";

/** A permissive role registry so only the write-scope check blocks. */
const PERMISSIVE_REGISTRY: RolePathRegistry = {
  roles: {
    coder: {
      read: { allow: ["**"], deny: [] },
      write: { allow: ["**"], deny: [] },
    },
  },
};

/** A fake tool call whose path falls outside src/allowed. */
const OOS_TOOL_CALL: BeforeToolCallContext = {
  assistantMessage: { role: "assistant", content: [] },
  toolCall: {
    id: "call-oos-001",
    name: "write_file",
    input: { path: "src/forbidden/secret.ts" },
  },
  args: { path: "src/forbidden/secret.ts" },
  context: { systemPrompt: "", messages: [], tools: [] },
};

// ---------------------------------------------------------------------------
// run2aOutOfScopeWriteScenario — public entry point
// ---------------------------------------------------------------------------

/**
 * Run the out-of-scope write scenario with the supplied harness fixture.
 *
 * Returns the observable facts used by the two assertions in
 * 2a-out-of-scope-write.test.ts (hook decision, escalation tag, inbox item
 * state before/after resume, task status before/after resume).
 */
export async function run2aOutOfScopeWriteScenario(
  fixture: OutOfScopeWriteFixture,
): Promise<OutOfScopeWriteResult> {
  const { clock, store } = fixture;

  // -------------------------------------------------------------------------
  // 1. Bootstrap all subsystem schemas, then insert the task as running.
  // -------------------------------------------------------------------------
  initSchema(store);
  store.run(
    "INSERT INTO scheduler_task (node_id, feature_id, status) VALUES (?, ?, 'running')",
    TASK_ID,
    FEATURE_ID,
  );

  // -------------------------------------------------------------------------
  // 2. Wire ring-1 hook adapter with writeScope: ["src/allowed"]
  //    A permissive role ensures the write-scope check is the gate that blocks.
  // -------------------------------------------------------------------------
  let capturedEscalation: (EscalationEvent & Record<string, unknown>) | undefined;

  const hook = makeRing1HookAdapter({
    registry: PERMISSIVE_REGISTRY,
    role: "coder",
    writeScope: ["src/allowed"],
    onEscalate: (e) => {
      capturedEscalation = e;
    },
    unknownEffectfulToolNames: new Set(),
  });

  // -------------------------------------------------------------------------
  // 3. Invoke hook with the out-of-scope path — expect block + escalation
  // -------------------------------------------------------------------------
  const hookResult = await hook(OOS_TOOL_CALL);
  const hookDecision: { block: boolean; reason?: string } = hookResult ?? { block: false };

  // -------------------------------------------------------------------------
  // 4. Create inbox escalation item (Epic 017) from the captured escalation
  // -------------------------------------------------------------------------
  const escalationPath = typeof capturedEscalation?.["path"] === "string"
    ? capturedEscalation["path"]
    : "unknown";
  const escalationTag = typeof capturedEscalation?.tag === "string"
    ? capturedEscalation.tag
    : "";

  const inboxItem = createEscalationItem({
    source_id: `${TASK_ID}:out-of-scope:${escalationPath}`,
    task_id: TASK_ID,
    reason: "out-of-scope write attempt blocked by ring-1 hook",
    payload_summary: `write to ${escalationPath} outside writeScope ["src/allowed"]`,
    store,
    clock,
  });

  // -------------------------------------------------------------------------
  // 5. Read task status before resume (must be "running" — task is held)
  // -------------------------------------------------------------------------
  const taskRowBefore = store.get<{ status: string }>(
    "SELECT status FROM scheduler_task WHERE node_id = ?",
    TASK_ID,
  );
  const taskStatusBeforeResume = taskRowBefore?.status ?? "";

  // -------------------------------------------------------------------------
  // 6. Resume escalation item (Epic 017 respond surface)
  //    Sets task to "pending", resolves inbox item.
  // -------------------------------------------------------------------------
  resumeEscalationItem({
    item_id: inboxItem.id,
    task_id: TASK_ID,
    actor: "harness",
    store,
    clock,
  });

  // -------------------------------------------------------------------------
  // 7. Read task and inbox state after resume
  // -------------------------------------------------------------------------
  const taskRowAfter = store.get<{ status: string }>(
    "SELECT status FROM scheduler_task WHERE node_id = ?",
    TASK_ID,
  );
  const inboxRowAfter = store.get<{ status: string }>(
    "SELECT status FROM inbox_items WHERE id = ?",
    inboxItem.id,
  );

  return {
    hookDecision,
    escalationTag,
    inboxItem: {
      kind: inboxItem.kind,
      status: inboxItem.status,
      id: inboxItem.id,
    },
    taskStatusBeforeResume,
    taskStatusAfterResume: taskRowAfter?.status ?? "",
    inboxItemStatusAfterResume: inboxRowAfter?.status ?? "",
  };
}

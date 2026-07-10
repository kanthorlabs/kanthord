import { createHash } from "node:crypto";
import type { Store } from "../foundations/sqlite-store.ts";
import type { Clock } from "../foundations/clock.ts";

/**
 * A durable inbox item representing a human-actionable event:
 * either an escalation that needs review or an approval-required op
 * that needs explicit sign-off before dispatch.
 *
 * Ids are deterministic (derived from source_id/op_id) so that a daemon
 * restart rebuild is idempotent — same source produces same id (debate
 * finding: resolved items must stay resolved, never recomputed away).
 */
export interface InboxItem {
  id: string;
  kind: "escalation" | "approval";
  status: "open" | "resolved";
  created_at: number;
  evidence: Record<string, unknown>;
}

/**
 * Derive a short deterministic id from a prefix and a source string.
 * Uses SHA-256 so the id is stable across restarts (no randomness).
 */
function deterministicId(prefix: string, sourceId: string): string {
  const digest = createHash("sha256").update(sourceId).digest("hex").slice(0, 32);
  return `${prefix}:${digest}`;
}

/**
 * Persist the item to the store, silently skipping if the same id already
 * exists (INSERT OR IGNORE — required for idempotent rebuild after restart).
 */
function persistItem(store: Store, item: InboxItem): void {
  store.run(
    `INSERT OR IGNORE INTO inbox_items (id, kind, status, created_at, evidence)
     VALUES (?, ?, ?, ?, ?)`,
    item.id,
    item.kind,
    item.status,
    item.created_at,
    JSON.stringify(item.evidence),
  );
}

// ---------------------------------------------------------------------------
// Public creation functions
// ---------------------------------------------------------------------------

export interface CreateEscalationItemOpts {
  source_id: string;
  task_id: string;
  reason: string;
  /** Human-readable description of the blocked payload; must NOT contain the
   *  raw secret value (Epic 013 rule — callers strip secrets before calling). */
  payload_summary: string;
  store: Store;
  clock: Clock;
}

/**
 * Create an open escalation item from a ring-1 escalation event (out-of-scope
 * write, budget breach, secret-scan block).  Evidence carries task_id, reason,
 * and payload_summary — never the raw secret.
 */
export function createEscalationItem(opts: CreateEscalationItemOpts): InboxItem {
  const { source_id, task_id, reason, payload_summary, store, clock } = opts;
  const id = deterministicId("esc", source_id);
  const item: InboxItem = {
    id,
    kind: "escalation",
    status: "open",
    created_at: clock.now(),
    evidence: { task_id, reason, payload_summary },
  };

  persistItem(store, item);
  return item;
}

export interface CreateBrokerEscalationItemOpts {
  op_id: string;
  store: Store;
  clock: Clock;
}

/**
 * Create an open escalation item from a broker escalation-needed state
 * (timeout, reconcile-escalate).  Evidence references the op_id so the human
 * can look up the full op record (Epic 005 boundary — broker emits, inbox routes).
 */
export function createBrokerEscalationItem(
  opts: CreateBrokerEscalationItemOpts,
): InboxItem {
  const { op_id, store, clock } = opts;
  const id = deterministicId("besc", op_id);
  const item: InboxItem = {
    id,
    kind: "escalation",
    status: "open",
    created_at: clock.now(),
    evidence: { op_id },
  };

  persistItem(store, item);
  return item;
}

export interface CreateApprovalItemOpts {
  op_id: string;
  verb: string;
  tier: string;
  desired_effect: string;
  store: Store;
  clock: Clock;
}

/**
 * Create an open approval item for an approval_required op.  The op stays
 * `pending` in broker_pending (Epic 005 state model) — this function does NOT
 * alter the op's status; dispatch waits for an explicit human approval.
 *
 * Evidence names verb, tier, and desired_effect so the human has context for
 * the approve/deny decision.
 */
export function createApprovalItem(opts: CreateApprovalItemOpts): InboxItem {
  const { op_id, verb, tier, desired_effect, store, clock } = opts;
  const id = deterministicId("apv", op_id);
  const item: InboxItem = {
    id,
    kind: "approval",
    status: "open",
    created_at: clock.now(),
    evidence: { op_id, verb, tier, desired_effect },
  };

  persistItem(store, item);
  return item;
}

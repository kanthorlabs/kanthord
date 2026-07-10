import type { Store } from "../foundations/sqlite-store.ts";
import type { Clock } from "../foundations/clock.ts";
import type { VerbRegistryEntry, AsyncVerbAdapter } from "../broker/registry.ts";
import { releasePendingOp } from "../broker/expiry.ts";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class ItemExpiredError extends Error {
  constructor(opId: string) {
    super(`op "${opId}" has expired and cannot be approved`);
    this.name = "ItemExpiredError";
  }
}

export class KindMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`inbox item kind must be "${expected}", got "${actual}"`);
    this.name = "KindMismatchError";
  }
}

export class AlreadyResolvedError extends Error {
  constructor(itemId: string) {
    super(`inbox item "${itemId}" is already resolved`);
    this.name = "AlreadyResolvedError";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ItemRow {
  kind: string;
  status: string;
}

/** Fetch an inbox item and validate it against the expected kind. */
function fetchAndValidate(store: Store, itemId: string, expectedKind: string): ItemRow {
  const item = store.get<ItemRow>(
    "SELECT kind, status FROM inbox_items WHERE id = ?",
    itemId,
  );
  if (item === undefined) {
    throw new Error(`inbox item "${itemId}" not found`);
  }
  if (item.kind !== expectedKind) {
    throw new KindMismatchError(expectedKind, item.kind);
  }
  if (item.status === "resolved") {
    throw new AlreadyResolvedError(itemId);
  }
  return item;
}

/** Mark an inbox item as resolved. */
function resolveItem(store: Store, itemId: string): void {
  store.run("UPDATE inbox_items SET status = 'resolved' WHERE id = ?", itemId);
}

/** Check if a named table exists in the SQLite schema. */
function tableExists(store: Store, tableName: string): boolean {
  const rows = store.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    tableName,
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// approveItem
// ---------------------------------------------------------------------------

export interface ApproveItemOpts {
  item_id: string;
  actor: string;
  op_id: string;
  entry: VerbRegistryEntry;
  adapter: AsyncVerbAdapter;
  payload: unknown;
  store: Store;
  clock: Clock;
}

/**
 * Approve an open approval-kind inbox item.
 *
 * Protocol (crash-safe):
 * 1. Validate item kind ("approval") and open status.
 * 2. Record a durable "approve" decision in `approval_decisions` BEFORE
 *    dispatching — so a crash between decision and submit is recoverable by
 *    `recoverPendingApprovals` (debate finding).
 * 3. Call `releasePendingOp`; if the op has expired, update the journal,
 *    auto-resolve the item, and throw `ItemExpiredError` (PRD §5 — stale ops
 *    must never fire).
 * 4. On success ("in_flight"), resolve the item.
 */
export async function approveItem(opts: ApproveItemOpts): Promise<void> {
  const { item_id, actor, op_id, entry, adapter, payload, store, clock } = opts;

  fetchAndValidate(store, item_id, "approval");

  // Crash-safe durable decision FIRST — recovery can complete dispatch.
  store.run(
    `INSERT OR IGNORE INTO approval_decisions
      (item_id, op_id, actor, action, decided_at)
     VALUES (?, ?, ?, ?, ?)`,
    item_id,
    op_id,
    actor,
    "approve",
    clock.now(),
  );

  const result = await releasePendingOp(op_id, entry, adapter, payload, store, clock);

  if (result === "expired") {
    // Update the journal to record the expiry outcome (must contain "expir").
    store.run(
      "UPDATE approval_decisions SET action = 'approve-expired' WHERE item_id = ?",
      item_id,
    );
    resolveItem(store, item_id);
    throw new ItemExpiredError(op_id);
  }

  // "in_flight": dispatch succeeded — resolve the item.
  resolveItem(store, item_id);
}

// ---------------------------------------------------------------------------
// denyItem
// ---------------------------------------------------------------------------

export interface DenyItemOpts {
  item_id: string;
  actor: string;
  op_id: string;
  store: Store;
  clock: Clock;
}

/**
 * Deny an open approval-kind inbox item.
 *
 * Marks the broker op as "failed" (no adapter call), resolves the item, and
 * journals the denial in `approval_decisions`.
 */
export async function denyItem(opts: DenyItemOpts): Promise<void> {
  const { item_id, actor, op_id, store, clock } = opts;

  fetchAndValidate(store, item_id, "approval");

  // Crash-safe durable decision FIRST — mirrors approveItem ordering so the
  // audit record survives a crash between journal write and resolve.
  store.run(
    `INSERT OR IGNORE INTO approval_decisions
      (item_id, op_id, actor, action, decided_at)
     VALUES (?, ?, ?, ?, ?)`,
    item_id,
    op_id,
    actor,
    "deny",
    clock.now(),
  );

  // Mark op failed in the pending table (no adapter call).
  store.run("UPDATE broker_pending SET status = 'failed' WHERE op_id = ?", op_id);

  // Resolve the item.
  resolveItem(store, item_id);
}

// ---------------------------------------------------------------------------
// recoverPendingApprovals
// ---------------------------------------------------------------------------

export interface RecoverPendingApprovalsOpts {
  store: Store;
  clock: Clock;
  getContext: (
    op_id: string,
  ) => { entry: VerbRegistryEntry; adapter: AsyncVerbAdapter; payload: unknown } | undefined;
}

/**
 * Recover from a crash that happened between recording a durable approval
 * decision and completing the adapter submit.
 *
 * Queries `approval_decisions JOIN inbox_items` for items whose decision is
 * "approve" but whose item is still open (i.e., dispatch didn't complete).
 * For each such item, re-runs `releasePendingOp` — the `broker_in_flight`
 * idempotency key dedup prevents a second adapter.submit if submit already
 * succeeded before the crash.  After dispatch, the item is resolved so a
 * second recovery pass is a no-op.
 */
export async function recoverPendingApprovals(
  opts: RecoverPendingApprovalsOpts,
): Promise<void> {
  const { store, clock, getContext } = opts;

  // Guard: nothing to do if either table is absent.
  if (!tableExists(store, "approval_decisions") || !tableExists(store, "inbox_items")) {
    return;
  }

  interface PendingApproval {
    item_id: string;
    op_id: string;
  }

  const rows = store.all<PendingApproval>(
    `SELECT d.item_id, d.op_id
     FROM approval_decisions d
     JOIN inbox_items i ON d.item_id = i.id
     WHERE d.action = 'approve' AND i.status = 'open'`,
  );

  for (const row of rows) {
    const context = getContext(row.op_id);
    if (context === undefined) continue;

    const { entry, adapter, payload } = context;
    const result = await releasePendingOp(row.op_id, entry, adapter, payload, store, clock);

    if (result === "expired") {
      store.run(
        "UPDATE approval_decisions SET action = 'approve-expired' WHERE item_id = ?",
        row.item_id,
      );
    }
    // Resolve item regardless (expired or in_flight — either way, not open).
    resolveItem(store, row.item_id);
  }
}

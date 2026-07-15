/**
 * approval-vm — Story 004 T1 view-model adapter.
 *
 * toApprovalItemVM maps the real proto InboxItem (kind=="approval") to
 * ApprovalItemVM. The hand-rolled RawApprovalItem superset has been removed;
 * the input is now the generated InboxItem directly (N1–N5 after Epic 026).
 *
 * Mapping:
 *   id       → item.id
 *   verb     → item.type   (approval verb, e.g. "github.merge")
 *   target   → item.summary
 *   state    → item.expired === true ? "expired" : "parked"
 *   expiresAt → item.expiresAt === 0n ? undefined : item.expiresAt
 */
import type { InboxItem } from "@/gen/kanthord/v1/daemon_pb";

export type ApprovalState = "parked" | "expired";

export interface ApprovalItemVM {
  id: string;
  verb: string;
  target: string;
  state: ApprovalState;
  expiresAt?: bigint;
}

export function toApprovalItemVM(item: InboxItem): ApprovalItemVM {
  return {
    id: item.id,
    verb: item.type,
    target: item.summary,
    state: item.expired === true ? "expired" : "parked",
    expiresAt: item.expiresAt === 0n ? undefined : item.expiresAt,
  };
}

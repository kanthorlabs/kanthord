/**
 * approval-vm — Story 004 T1 view-model adapter.
 *
 * Maps a raw approval item (superset of the current InboxItem proto carrying
 * optional N3 fields per api-needs-for-026.md) to the ApprovalItemVM that all
 * Story 004 surfaces are driven from.
 *
 * N3 gap defaults (fields not yet on the proto):
 *   verb      → ""
 *   target    → ""
 *   state     → "parked" (unless expired === true → "expired")
 *   expiresAt → undefined
 */

export type ApprovalState = "parked" | "expired";

export interface ApprovalItemVM {
  id: string;
  verb: string;
  target: string;
  state: ApprovalState;
  expiresAt?: string;
}

/**
 * Superset input type — the current proto InboxItem fields plus the optional
 * N3 fields the adapter defaults when absent.
 */
interface RawApprovalItem {
  id: string;
  verb?: string;
  target?: string;
  expiresAt?: string;
  expired?: boolean;
}

export function toApprovalItemVM(raw: RawApprovalItem): ApprovalItemVM {
  return {
    id: raw.id,
    verb: raw.verb ?? "",
    target: raw.target ?? "",
    state: raw.expired === true ? "expired" : "parked",
    expiresAt: raw.expiresAt,
  };
}

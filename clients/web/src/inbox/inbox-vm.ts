/**
 * inbox-vm — InboxItemVM view-model + adapter (Story 003 T1).
 *
 * The adapter toInboxItemVM maps the generated proto InboxItem (which currently
 * carries only {id, kind, featureId, summary}) to the richer InboxItemVM that
 * all Story 003 surfaces are driven from.  Its input type is a SUPERSET of
 * InboxItem: when the proto eventually carries the extended fields (N2 in
 * api-needs-for-026.md) they pass through directly; when absent, deterministic
 * defaults are applied.
 *
 * This lets the adapter test (bare proto → defaults) and the Inbox component
 * test (pre-built VMs → passthrough) both pass against a single implementation.
 */
import type { InboxItem } from "@/gen/kanthord/v1/daemon_pb";
import type { DiffFile } from "@/components/DiffPane";

// ---------------------------------------------------------------------------
// Evidence union
// ---------------------------------------------------------------------------

export type InboxEvidence =
  | { kind: "text"; text: string }
  | { kind: "diff"; files: DiffFile[] };

// ---------------------------------------------------------------------------
// View-model (the shape every Story 003 surface consumes)
// ---------------------------------------------------------------------------

export interface InboxItemVM {
  id: string;
  kind: "escalation" | "approval";
  featureId: string;
  summary: string;
  /** Escalation / approval type string (e.g. "write-access-request"). Empty when not yet provided by the proto. */
  type: string;
  /** Severity string (e.g. "high" | "medium" | "low"). Empty when not yet provided. */
  severity: string;
  /** Daemon-suggested interaction category for the respond control. */
  suggestedCategory: string;
  /** Attached evidence content (diff or text). */
  evidence: InboxEvidence;
  /** Item lifecycle status ("open" | "resolved" | "expired"). */
  status: string;
}

// ---------------------------------------------------------------------------
// Extended input type — superset of the current proto InboxItem.
// The optional fields are the N2 fields that the UI expects but the current
// proto does not carry.  When 026 adds them the adapter passes them through;
// until then the defaults below apply.
// ---------------------------------------------------------------------------

type RichInboxItem = InboxItem & {
  type?: string;
  severity?: string;
  suggestedCategory?: string;
  evidence?: InboxEvidence;
  status?: string;
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function toInboxItemVM(item: RichInboxItem): InboxItemVM {
  const kind: "escalation" | "approval" =
    item.kind === "escalation" || item.kind === "approval"
      ? item.kind
      : "escalation";

  return {
    id: item.id,
    kind,
    featureId: item.featureId,
    summary: item.summary,
    type: item.type ?? "",
    severity: item.severity ?? "",
    suggestedCategory: item.suggestedCategory ?? "",
    evidence: item.evidence ?? { kind: "text", text: item.summary },
    status: item.status ?? "open",
  };
}

// ---------------------------------------------------------------------------
// Deterministic sort — escalation before approval, then by id alphabetically.
// Shared by Inbox list and Respond next-item computation.
// ---------------------------------------------------------------------------

export function sortInboxItems(items: InboxItemVM[]): InboxItemVM[] {
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "escalation" ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

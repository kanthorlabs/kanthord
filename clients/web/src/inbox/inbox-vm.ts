/**
 * inbox-vm — InboxItemVM view-model + adapter.
 *
 * toInboxItemVM maps the generated proto InboxItem (N1–N5 real fields after
 * Epic 026) to InboxItemVM. The input is now the real proto type directly —
 * the hand-rolled RichInboxItem superset has been removed.
 *
 * Evidence mapping:
 *   evidence undefined        → { kind:"text", text: summary }
 *   evidence.type == ""       → { kind:"text", text: summary }
 *   evidence.type == "text"   → { kind:"text", text: evidence.text }
 *   evidence.type == "diff"   → { kind:"diff", files: [...] }
 *     DiffLine.kind ("add"|"del"|"ctx") → DiffLine.type ("add"|"del"|"ctx")
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
  /** Escalation / approval type string (e.g. "write-access-request"). */
  type: string;
  /** Severity string (e.g. "high" | "medium" | "low"). */
  severity: string;
  /** Daemon-suggested interaction category for the respond control. */
  suggestedCategory: string;
  /** Attached evidence content (diff or text). */
  evidence: InboxEvidence;
  /** Item lifecycle status ("open" | "resolved" | "expired"). */
  status: string;
  /** Approval/lease expiry (epoch ms). 0n when not set. */
  expiresAt?: bigint;
  /** Whether the item has expired. */
  expired?: boolean;
}

// ---------------------------------------------------------------------------
// Evidence helper
// ---------------------------------------------------------------------------

function mapEvidence(item: InboxItem): InboxEvidence {
  const ev = item.evidence;
  if (!ev || ev.type === "") {
    return { kind: "text", text: item.summary };
  }
  if (ev.type === "text") {
    return { kind: "text", text: ev.text };
  }
  // type === "diff"
  const files: DiffFile[] = (ev.diff?.files ?? []).map((f) => ({
    path: f.path,
    lines: f.lines.map((l) => ({
      type: l.kind as "add" | "del" | "ctx",
      content: l.content,
    })),
  }));
  return { kind: "diff", files };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function toInboxItemVM(item: InboxItem): InboxItemVM {
  const kind: "escalation" | "approval" =
    item.kind === "escalation" || item.kind === "approval"
      ? item.kind
      : "escalation";

  return {
    id: item.id,
    kind,
    featureId: item.featureId,
    summary: item.summary,
    type: item.type,
    severity: item.severity,
    suggestedCategory: item.suggestedCategory,
    evidence: mapEvidence(item),
    status: item.status,
    expiresAt: item.expiresAt,
    expired: item.expired,
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

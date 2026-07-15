/**
 * Story 003 T1 — inbox-vm adapter unit tests.
 *
 * The adapter `toInboxItemVM` maps the generated proto InboxItem
 * (which only carries {id, kind, featureId, summary}) to the richer
 * InboxItemVM view-model that all Story 003 surfaces are driven from.
 *
 * Adapter contract — available proto fields map directly; each missing
 * proto field gets an explicit, deterministic default:
 *   type             → ""  (no type field in current proto)
 *   severity         → ""  (no severity field in current proto)
 *   suggestedCategory → "" (no suggestedCategory field in current proto)
 *   evidence         → { kind: "text", text: <proto summary> }
 *   status           → "open" (listInboxItems returns open items only)
 *   kind             → passthrough if "escalation"|"approval", else "escalation"
 *
 * RED: fails because @/inbox/inbox-vm does not exist yet.
 */
import { describe, it, expect } from "vitest";
import { toInboxItemVM } from "@/inbox/inbox-vm";
import type { InboxItemVM } from "@/inbox/inbox-vm";
import type { InboxItem } from "@/gen/kanthord/v1/daemon_pb";

// ---------------------------------------------------------------------------
// Proto fixtures (plain object cast — the generated InboxItem has only these 4
// fields; the branding type is elided for test fixtures per project convention)
// ---------------------------------------------------------------------------

function makeProtoItem(overrides: Partial<{
  id: string;
  kind: string;
  featureId: string;
  summary: string;
}> = {}): InboxItem {
  return {
    id: "item-001",
    kind: "escalation",
    featureId: "feat-001",
    summary: "Unexpected artifact change in output",
    ...overrides,
  } as unknown as InboxItem;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("toInboxItemVM — proto InboxItem → InboxItemVM adapter", () => {
  describe("available proto fields map directly", () => {
    it("maps proto id to vm id", () => {
      const vm: InboxItemVM = toInboxItemVM(makeProtoItem({ id: "item-xyz" }));
      expect(vm.id).toBe("item-xyz");
    });

    it("maps proto featureId to vm featureId", () => {
      const vm = toInboxItemVM(makeProtoItem({ featureId: "feat-999" }));
      expect(vm.featureId).toBe("feat-999");
    });

    it("maps proto summary to vm summary", () => {
      const vm = toInboxItemVM(makeProtoItem({ summary: "The diff is unexpected" }));
      expect(vm.summary).toBe("The diff is unexpected");
    });

    it("maps proto kind 'escalation' to vm kind 'escalation'", () => {
      const vm = toInboxItemVM(makeProtoItem({ kind: "escalation" }));
      expect(vm.kind).toBe("escalation");
    });

    it("maps proto kind 'approval' to vm kind 'approval'", () => {
      const vm = toInboxItemVM(makeProtoItem({ kind: "approval" }));
      expect(vm.kind).toBe("approval");
    });

    it("unrecognised proto kind falls back to 'escalation'", () => {
      const vm = toInboxItemVM(makeProtoItem({ kind: "unknown-kind" }));
      expect(vm.kind).toBe("escalation");
    });
  });

  describe("missing proto fields get explicit defaults", () => {
    it("type defaults to empty string", () => {
      const vm = toInboxItemVM(makeProtoItem());
      expect(vm.type).toBe("");
    });

    it("severity defaults to empty string", () => {
      const vm = toInboxItemVM(makeProtoItem());
      expect(vm.severity).toBe("");
    });

    it("suggestedCategory defaults to empty string", () => {
      const vm = toInboxItemVM(makeProtoItem());
      expect(vm.suggestedCategory).toBe("");
    });

    it("status defaults to 'open'", () => {
      const vm = toInboxItemVM(makeProtoItem());
      expect(vm.status).toBe("open");
    });

    it("evidence defaults to text evidence using proto summary as text", () => {
      const vm = toInboxItemVM(makeProtoItem({ summary: "Some summary text" }));
      expect(vm.evidence).toEqual({ kind: "text", text: "Some summary text" });
    });
  });

  describe("returned value satisfies InboxItemVM shape", () => {
    it("all required vm fields are present", () => {
      const vm = toInboxItemVM(makeProtoItem());
      const requiredFields: Array<keyof InboxItemVM> = [
        "id", "kind", "featureId", "summary",
        "type", "severity", "suggestedCategory", "evidence", "status",
      ];
      for (const field of requiredFields) {
        expect(Object.prototype.hasOwnProperty.call(vm, field)).toBe(true);
      }
    });
  });
});

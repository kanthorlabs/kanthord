/**
 * approval-vm adapter unit tests — updated for real proto InboxItem input.
 *
 * After Epic 026 N1–N5, `toApprovalItemVM` now takes the real proto `InboxItem`
 * (kind=="approval") instead of the hand-rolled `RawApprovalItem` superset.
 *
 * Updated adapter contract:
 *   id       → item.id (passthrough)
 *   verb     → item.type   (approval verb, e.g. "github.merge")
 *   target   → item.summary (human-readable target reference)
 *   state    → item.expired === true → "expired", else → "parked"
 *   expiresAt → item.expiresAt === 0n → undefined, else → item.expiresAt (bigint)
 *
 * RED: fails because:
 *   - toApprovalItemVM currently takes RawApprovalItem, not InboxItem
 *   - ApprovalItemVM.expiresAt is currently `string|undefined`, not `bigint|undefined`
 *   - verb/target are derived from item.verb/item.target (hand-rolled fields),
 *     not from item.type/item.summary (real proto fields)
 */
import { describe, it, expect } from "vitest";
import { toApprovalItemVM } from "@/approvals/approval-vm";
import type { ApprovalItemVM } from "@/approvals/approval-vm";
import type { InboxItem } from "@/gen/kanthord/v1/daemon_pb";

// ---------------------------------------------------------------------------
// Proto fixtures (plain objects cast to InboxItem — test-only pattern)
// ---------------------------------------------------------------------------

function makeInboxItem(
  overrides: Partial<{
    id: string;
    kind: string;
    featureId: string;
    summary: string;
    type: string;
    severity: string;
    suggestedCategory: string;
    status: string;
    expiresAt: bigint;
    expired: boolean;
    brokerOpId: string;
  }> = {},
): InboxItem {
  return {
    id: "item-approval-001",
    kind: "approval",
    featureId: "feat-001",
    summary: "acme/repo#42",       // → vm.target
    type: "github.merge",          // → vm.verb
    severity: "medium",
    suggestedCategory: "approval",
    status: "open",
    expiresAt: 0n,
    expired: false,
    evidence: undefined,
    brokerOpId: "",
    ...overrides,
  } as unknown as InboxItem;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("toApprovalItemVM — proto InboxItem → ApprovalItemVM adapter", () => {
  // -----------------------------------------------------------------------
  // Field derivation from real proto fields
  // -----------------------------------------------------------------------

  describe("id — passthrough", () => {
    it("maps id directly from item.id", () => {
      const vm: ApprovalItemVM = toApprovalItemVM(makeInboxItem({ id: "item-xyz" }));
      expect(vm.id).toBe("item-xyz");
    });
  });

  describe("verb — derived from item.type", () => {
    it("verb is item.type when type is 'github.merge'", () => {
      const vm = toApprovalItemVM(makeInboxItem({ type: "github.merge" }));
      expect(vm.verb).toBe("github.merge");
    });

    it("verb is item.type when type is 'github.create_pr'", () => {
      const vm = toApprovalItemVM(makeInboxItem({ type: "github.create_pr" }));
      expect(vm.verb).toBe("github.create_pr");
    });

    it("verb is empty string when item.type is empty", () => {
      const vm = toApprovalItemVM(makeInboxItem({ type: "" }));
      expect(vm.verb).toBe("");
    });
  });

  describe("target — derived from item.summary", () => {
    it("target is item.summary when summary carries the target reference", () => {
      const vm = toApprovalItemVM(makeInboxItem({ summary: "acme/repo#42" }));
      expect(vm.target).toBe("acme/repo#42");
    });

    it("target is empty string when item.summary is empty", () => {
      const vm = toApprovalItemVM(makeInboxItem({ summary: "" }));
      expect(vm.target).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // State derivation from proto expired field
  // -----------------------------------------------------------------------

  describe("state derivation from proto expired field", () => {
    it("expired=true yields state 'expired'", () => {
      const vm = toApprovalItemVM(makeInboxItem({ expired: true }));
      expect(vm.state).toBe("expired");
    });

    it("expired=false yields state 'parked'", () => {
      const vm = toApprovalItemVM(makeInboxItem({ expired: false }));
      expect(vm.state).toBe("parked");
    });
  });

  // -----------------------------------------------------------------------
  // expiresAt — bigint passthrough, 0n → undefined
  // -----------------------------------------------------------------------

  describe("expiresAt — proto bigint passthrough", () => {
    it("expiresAt=0n (proto default / not set) maps to undefined in the VM", () => {
      const vm = toApprovalItemVM(makeInboxItem({ expiresAt: 0n }));
      expect(vm.expiresAt).toBeUndefined();
    });

    it("non-zero expiresAt passes through as bigint", () => {
      const vm = toApprovalItemVM(makeInboxItem({ expiresAt: 1752537600000n }));
      expect(vm.expiresAt).toBe(1752537600000n);
    });
  });

  // -----------------------------------------------------------------------
  // Shape completeness
  // -----------------------------------------------------------------------

  describe("returned value satisfies ApprovalItemVM shape", () => {
    it("all required vm fields are present", () => {
      const vm = toApprovalItemVM(makeInboxItem());
      const requiredFields: Array<keyof ApprovalItemVM> = [
        "id", "verb", "target", "state",
      ];
      for (const field of requiredFields) {
        expect(Object.prototype.hasOwnProperty.call(vm, field)).toBe(true);
      }
    });
  });
});

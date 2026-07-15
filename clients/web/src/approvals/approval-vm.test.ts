/**
 * Story 004 T1 — approval-vm adapter unit tests.
 *
 * The adapter toApprovalItemVM maps a raw approval item (which may come from
 * a future InboxItem extension per N3 in api-needs-for-026.md) to the
 * ApprovalItemVM that all Story 004 surfaces are driven from.
 *
 * N3 gap: the current proto InboxItem does not carry verb, target, expiresAt,
 * or expired. The adapter accepts a RawApprovalItem superset; until N3 lands
 * those optional fields default to safe values:
 *   verb      → ""
 *   target    → ""
 *   state     → "parked" (unless expired === true → "expired")
 *   expiresAt → undefined
 *
 * RED: fails because @/approvals/approval-vm does not exist yet.
 */
import { describe, it, expect } from "vitest";
import { toApprovalItemVM } from "@/approvals/approval-vm";
import type { ApprovalItemVM } from "@/approvals/approval-vm";

// ---------------------------------------------------------------------------
// Raw fixtures (the superset input type; optional N3 fields)
// ---------------------------------------------------------------------------

function makeRaw(
  overrides: Partial<{
    id: string;
    verb: string;
    target: string;
    expiresAt: string;
    expired: boolean;
  }> = {},
) {
  return {
    id: "item-approval-001",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("toApprovalItemVM — raw approval item → ApprovalItemVM adapter", () => {
  describe("available fields map directly", () => {
    it("maps id directly", () => {
      const vm: ApprovalItemVM = toApprovalItemVM(makeRaw({ id: "item-xyz" }));
      expect(vm.id).toBe("item-xyz");
    });

    it("maps verb when present", () => {
      const vm = toApprovalItemVM(makeRaw({ verb: "github.merge" }));
      expect(vm.verb).toBe("github.merge");
    });

    it("maps target when present", () => {
      const vm = toApprovalItemVM(makeRaw({ target: "acme/repo#42" }));
      expect(vm.target).toBe("acme/repo#42");
    });

    it("maps expiresAt when present", () => {
      const vm = toApprovalItemVM(makeRaw({ expiresAt: "2026-07-15T12:00:00Z" }));
      expect(vm.expiresAt).toBe("2026-07-15T12:00:00Z");
    });
  });

  describe("missing proto fields get explicit defaults (N3 gap)", () => {
    it("verb defaults to empty string", () => {
      const vm = toApprovalItemVM(makeRaw());
      expect(vm.verb).toBe("");
    });

    it("target defaults to empty string", () => {
      const vm = toApprovalItemVM(makeRaw());
      expect(vm.target).toBe("");
    });

    it("expiresAt defaults to undefined", () => {
      const vm = toApprovalItemVM(makeRaw());
      expect(vm.expiresAt).toBeUndefined();
    });
  });

  describe("state derivation from expired flag", () => {
    it("expired=true yields state 'expired'", () => {
      const vm = toApprovalItemVM(makeRaw({ expired: true }));
      expect(vm.state).toBe("expired");
    });

    it("expired=false yields state 'parked'", () => {
      const vm = toApprovalItemVM(makeRaw({ expired: false }));
      expect(vm.state).toBe("parked");
    });

    it("expired absent yields state 'parked'", () => {
      const vm = toApprovalItemVM(makeRaw());
      expect(vm.state).toBe("parked");
    });
  });

  describe("returned value satisfies ApprovalItemVM shape", () => {
    it("all required vm fields are present", () => {
      const vm = toApprovalItemVM(makeRaw());
      const requiredFields: Array<keyof ApprovalItemVM> = [
        "id",
        "verb",
        "target",
        "state",
      ];
      for (const field of requiredFields) {
        expect(Object.prototype.hasOwnProperty.call(vm, field)).toBe(true);
      }
    });
  });
});

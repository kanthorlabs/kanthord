/**
 * inbox-vm adapter unit tests — updated for N1–N5 real proto fields.
 *
 * After Epic 026 N1–N5 landed in the generated client, `InboxItem` now carries
 * all the fields the adapter previously defaulted (type, severity,
 * suggestedCategory, status, expiresAt, expired, evidence, brokerOpId).
 * The adapter input type changes from the hand-rolled `RichInboxItem`
 * superset to the real proto `InboxItem`.
 *
 * Adapter contract (updated):
 *   id / kind / featureId / summary  → passthrough (unchanged)
 *   kind                             → "escalation"|"approval"; unknown → "escalation"
 *   type / severity / suggestedCategory / status → passthrough from proto field
 *   expiresAt (bigint)               → passthrough
 *   expired (bool)                   → passthrough
 *   evidence (Evidence | undefined):
 *     undefined                      → { kind:"text", text: summary }
 *     type == ""  (none)             → { kind:"text", text: summary }
 *     type == "text"                 → { kind:"text", text: evidence.text }
 *     type == "diff"                 → { kind:"diff", files: [...] }
 *       DiffLine.kind ("add"|"del"|"ctx") → DiffLine.type ("add"|"del"|"ctx")
 *
 * RED: fails because toInboxItemVM currently takes RichInboxItem (evidence field
 * type conflict with proto Evidence), and InboxItemVM lacks expiresAt/expired.
 */
import { describe, it, expect } from "vitest";
import { toInboxItemVM } from "@/inbox/inbox-vm";
import type { InboxItemVM } from "@/inbox/inbox-vm";
import type { InboxItem, Evidence, DiffEvidence } from "@/gen/kanthord/v1/daemon_pb";

// ---------------------------------------------------------------------------
// Proto fixtures (plain objects cast to the branded type — test-only pattern)
// ---------------------------------------------------------------------------

function makeProtoItem(
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
    evidence: Evidence | undefined;
    brokerOpId: string;
  }> = {},
): InboxItem {
  return {
    id: "item-001",
    kind: "escalation",
    featureId: "feat-001",
    summary: "Unexpected artifact change in output",
    type: "write-access-request",
    severity: "medium",
    suggestedCategory: "correction",
    status: "open",
    expiresAt: 0n,
    expired: false,
    evidence: undefined,
    brokerOpId: "",
    ...overrides,
  } as unknown as InboxItem;
}

function makeEvidence(
  overrides: Partial<{
    type: string;
    text: string;
    diff: DiffEvidence | undefined;
  }> = {},
): Evidence {
  return {
    type: "",
    text: "",
    diff: undefined,
    ...overrides,
  } as unknown as Evidence;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("toInboxItemVM — proto InboxItem → InboxItemVM adapter", () => {
  // -----------------------------------------------------------------------
  // Passthrough fields (always present on the real proto)
  // -----------------------------------------------------------------------

  describe("passthrough proto fields map directly", () => {
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

    it("maps proto type straight through", () => {
      const vm = toInboxItemVM(makeProtoItem({ type: "unclassified-artifact-change" }));
      expect(vm.type).toBe("unclassified-artifact-change");
    });

    it("maps proto severity straight through", () => {
      const vm = toInboxItemVM(makeProtoItem({ severity: "high" }));
      expect(vm.severity).toBe("high");
    });

    it("maps proto suggestedCategory straight through", () => {
      const vm = toInboxItemVM(makeProtoItem({ suggestedCategory: "takeover" }));
      expect(vm.suggestedCategory).toBe("takeover");
    });

    it("maps proto status 'resolved' straight through", () => {
      const vm = toInboxItemVM(makeProtoItem({ status: "resolved" }));
      expect(vm.status).toBe("resolved");
    });

    it("maps proto status 'expired' straight through", () => {
      const vm = toInboxItemVM(makeProtoItem({ status: "expired" }));
      expect(vm.status).toBe("expired");
    });

    it("maps proto status 'missing' straight through", () => {
      const vm = toInboxItemVM(makeProtoItem({ status: "missing" }));
      expect(vm.status).toBe("missing");
    });

    it("maps proto expiresAt (bigint) straight through", () => {
      const vm = toInboxItemVM(makeProtoItem({ expiresAt: 1752451200000n }));
      expect(vm.expiresAt).toBe(1752451200000n);
    });

    it("maps proto expired=true straight through", () => {
      const vm = toInboxItemVM(makeProtoItem({ expired: true }));
      expect(vm.expired).toBe(true);
    });

    it("maps proto expired=false straight through", () => {
      const vm = toInboxItemVM(makeProtoItem({ expired: false }));
      expect(vm.expired).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Evidence mapping — proto Evidence → VM InboxEvidence
  // -----------------------------------------------------------------------

  describe("evidence mapping — proto Evidence → InboxEvidence", () => {
    it("absent evidence (undefined) defaults to text evidence using the proto summary", () => {
      const vm = toInboxItemVM(makeProtoItem({ summary: "Some summary text", evidence: undefined }));
      expect(vm.evidence).toEqual({ kind: "text", text: "Some summary text" });
    });

    it("evidence.type='' (none) defaults to text evidence using the proto summary", () => {
      const vm = toInboxItemVM(
        makeProtoItem({
          summary: "fallback summary",
          evidence: makeEvidence({ type: "", text: "" }),
        }),
      );
      expect(vm.evidence).toEqual({ kind: "text", text: "fallback summary" });
    });

    it("evidence.type='text' maps to vm text evidence carrying evidence.text", () => {
      const vm = toInboxItemVM(
        makeProtoItem({
          evidence: makeEvidence({ type: "text", text: "Agent needs clarification on X" }),
        }),
      );
      expect(vm.evidence).toEqual({ kind: "text", text: "Agent needs clarification on X" });
    });

    it("evidence.type='diff' maps to vm diff evidence with DiffFile list", () => {
      const diffEvidence = {
        files: [
          {
            path: "src/main.ts",
            lines: [
              { kind: "ctx", content: "existing line" },
              { kind: "del", content: "old line" },
              { kind: "add", content: "new line" },
            ],
          },
        ],
      } as unknown as DiffEvidence;

      const vm = toInboxItemVM(
        makeProtoItem({
          evidence: makeEvidence({ type: "diff", diff: diffEvidence }),
        }),
      );

      expect(vm.evidence).toEqual({
        kind: "diff",
        files: [
          {
            path: "src/main.ts",
            lines: [
              { type: "ctx", content: "existing line" },
              { type: "del", content: "old line" },
              { type: "add", content: "new line" },
            ],
          },
        ],
      });
    });

    it("proto DiffLine.kind 'add' maps to vm DiffLine.type 'add'", () => {
      const vm = toInboxItemVM(
        makeProtoItem({
          evidence: makeEvidence({
            type: "diff",
            diff: {
              files: [{ path: "f.ts", lines: [{ kind: "add", content: "x" }] }],
            } as unknown as DiffEvidence,
          }),
        }),
      );
      const ev = vm.evidence;
      expect(ev.kind).toBe("diff");
      if (ev.kind === "diff") {
        expect(ev.files).toEqual([{ path: "f.ts", lines: [{ type: "add", content: "x" }] }]);
      }
    });

    it("proto DiffLine.kind 'del' maps to vm DiffLine.type 'del'", () => {
      const vm = toInboxItemVM(
        makeProtoItem({
          evidence: makeEvidence({
            type: "diff",
            diff: {
              files: [{ path: "f.ts", lines: [{ kind: "del", content: "y" }] }],
            } as unknown as DiffEvidence,
          }),
        }),
      );
      const ev = vm.evidence;
      if (ev.kind === "diff") {
        expect(ev.files).toEqual([{ path: "f.ts", lines: [{ type: "del", content: "y" }] }]);
      }
    });

    it("proto DiffLine.kind 'ctx' maps to vm DiffLine.type 'ctx'", () => {
      const vm = toInboxItemVM(
        makeProtoItem({
          evidence: makeEvidence({
            type: "diff",
            diff: {
              files: [{ path: "f.ts", lines: [{ kind: "ctx", content: "z" }] }],
            } as unknown as DiffEvidence,
          }),
        }),
      );
      const ev = vm.evidence;
      if (ev.kind === "diff") {
        expect(ev.files).toEqual([{ path: "f.ts", lines: [{ type: "ctx", content: "z" }] }]);
      }
    });

    it("diff evidence preserves file path and multiple files", () => {
      const diffEvidence = {
        files: [
          { path: "a.ts", lines: [{ kind: "add", content: "a" }] },
          { path: "b.ts", lines: [{ kind: "del", content: "b" }] },
        ],
      } as unknown as DiffEvidence;

      const vm = toInboxItemVM(
        makeProtoItem({ evidence: makeEvidence({ type: "diff", diff: diffEvidence }) }),
      );
      const ev = vm.evidence;
      if (ev.kind === "diff") {
        expect(ev.files).toHaveLength(2);
        expect(ev.files).toEqual([
          { path: "a.ts", lines: [{ type: "add", content: "a" }] },
          { path: "b.ts", lines: [{ type: "del", content: "b" }] },
        ]);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Shape completeness
  // -----------------------------------------------------------------------

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

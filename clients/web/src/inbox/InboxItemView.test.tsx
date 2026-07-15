/**
 * Story 003 T1 — InboxItemView component tests (deep-link item view).
 *
 * InboxItemView is rendered at `/inbox/:id`.  It receives the full list of
 * known InboxItemVM objects and reads the `:id` route param to select the
 * matching item.  Tests use MemoryRouter + Routes to exercise the routing.
 *
 * Asserts:
 *   - An open item with diff evidence: DiffPane visible with file boundaries
 *     and add/del semantic lines (daily-usage Input 3 / DESIGN §5)
 *   - An open item with text evidence: evidence text is displayed
 *   - A resolved item renders the explicit resolved state (not a redirect)
 *   - An expired item renders the explicit expired state (not a redirect)
 *   - An id that does not match any item renders the explicit missing state
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because:
 *   - clients/web/src/inbox/InboxItemView.tsx does not exist
 *   - locators.inbox.item.{root,evidence,resolvedState,expiredState,missingState}
 *     are not in the registry
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { InboxItemView } from "@/inbox/InboxItemView";
import { locators } from "@/locators";
import type { InboxItemVM } from "@/inbox/inbox-vm";
import type { DiffFile } from "@/components/DiffPane";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DIFF_FILES: DiffFile[] = [
  {
    path: "src/utils/helper.ts",
    lines: [
      { type: "ctx", content: "// existing line" },
      { type: "del", content: "const old = 1;" },
      { type: "add", content: "const newer = 2;" },
    ],
  },
  {
    path: "src/utils/other.ts",
    lines: [
      { type: "add", content: "// newly added file" },
    ],
  },
];

const DIFF_ITEM: InboxItemVM = {
  id: "item-diff",
  kind: "escalation",
  featureId: "feat-001",
  summary: "Unexpected diff in output",
  type: "unclassified-artifact-change",
  severity: "high",
  suggestedCategory: "correction",
  evidence: { kind: "diff", files: DIFF_FILES },
  status: "open",
};

const TEXT_ITEM: InboxItemVM = {
  id: "item-text",
  kind: "escalation",
  featureId: "feat-002",
  summary: "Clarification needed from operator",
  type: "write-access-request",
  severity: "medium",
  suggestedCategory: "clarification",
  evidence: { kind: "text", text: "The agent requires operator input to proceed with X" },
  status: "open",
};

const RESOLVED_ITEM: InboxItemVM = {
  id: "item-resolved",
  kind: "escalation",
  featureId: "feat-003",
  summary: "Previously resolved escalation",
  type: "write-access-request",
  severity: "low",
  suggestedCategory: "correction",
  evidence: { kind: "text", text: "resolved evidence" },
  status: "resolved",
};

const EXPIRED_ITEM: InboxItemVM = {
  id: "item-expired",
  kind: "approval",
  featureId: "feat-004",
  summary: "Expired approval request",
  type: "github.merge",
  severity: "medium",
  suggestedCategory: "approval",
  evidence: { kind: "text", text: "expired evidence" },
  status: "expired",
};

const ALL_ITEMS: InboxItemVM[] = [
  DIFF_ITEM,
  TEXT_ITEM,
  RESOLVED_ITEM,
  EXPIRED_ITEM,
];

// ---------------------------------------------------------------------------
// Helper: render InboxItemView at a specific route
// ---------------------------------------------------------------------------

function renderAtRoute(id: string, items: InboxItemVM[] = ALL_ITEMS) {
  return render(
    <MemoryRouter initialEntries={[`/inbox/${id}`]}>
      <Routes>
        <Route
          path="/inbox/:id"
          element={<InboxItemView items={items} />}
        />
      </Routes>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InboxItemView — item detail view (Story 003 T1)", () => {
  describe("open item with diff evidence (daily-usage Input 3 / DESIGN §5)", () => {
    it("item root is rendered for the matching id", () => {
      renderAtRoute("item-diff");
      expect(
        screen.getByTestId(locators.inbox.item.root)
      ).toBeInTheDocument();
    });

    it("evidence section is rendered for the diff item", () => {
      renderAtRoute("item-diff");
      expect(
        screen.getByTestId(locators.inbox.item.evidence)
      ).toBeInTheDocument();
    });

    it("diff evidence renders the DiffPane composite (DESIGN §5)", () => {
      renderAtRoute("item-diff");
      expect(
        screen.getByTestId(locators.diffPane.root)
      ).toBeInTheDocument();
    });

    it("diff evidence preserves file boundaries — both files visible", () => {
      renderAtRoute("item-diff");
      const fileHeaders = screen.getAllByTestId(locators.diffPane.file);
      expect(fileHeaders).toHaveLength(2);
    });

    it("diff evidence renders add lines via semantic token", () => {
      renderAtRoute("item-diff");
      const addLines = screen.getAllByTestId(locators.diffPane.addLine);
      expect(addLines.length).toBeGreaterThanOrEqual(1);
    });

    it("diff evidence renders del lines via semantic token", () => {
      renderAtRoute("item-diff");
      const delLines = screen.getAllByTestId(locators.diffPane.delLine);
      expect(delLines.length).toBeGreaterThanOrEqual(1);
    });

    it("item summary is visible for the diff item", () => {
      renderAtRoute("item-diff");
      expect(screen.getByText("Unexpected diff in output")).toBeInTheDocument();
    });
  });

  describe("open item with text evidence", () => {
    it("item root is rendered for the text evidence item", () => {
      renderAtRoute("item-text");
      expect(
        screen.getByTestId(locators.inbox.item.root)
      ).toBeInTheDocument();
    });

    it("text evidence is displayed as readable text (not a raw pre dump)", () => {
      renderAtRoute("item-text");
      expect(
        screen.getByText("The agent requires operator input to proceed with X")
      ).toBeInTheDocument();
    });

    it("DiffPane is NOT rendered for text evidence", () => {
      renderAtRoute("item-text");
      expect(
        screen.queryByTestId(locators.diffPane.root)
      ).not.toBeInTheDocument();
    });
  });

  describe("resolved item — explicit state (daily-usage Input 5)", () => {
    it("renders the resolved state element for a resolved item", () => {
      renderAtRoute("item-resolved");
      expect(
        screen.getByTestId(locators.inbox.item.resolvedState)
      ).toBeInTheDocument();
    });

    it("does NOT redirect or show the list for a resolved item", () => {
      renderAtRoute("item-resolved");
      // The item root is still rendered (it's an explicit state, not a redirect)
      expect(
        screen.getByTestId(locators.inbox.item.resolvedState)
      ).toBeInTheDocument();
      // The list table is NOT rendered (we're in item view, not the list)
      expect(
        screen.queryByTestId(locators.inbox.list.table)
      ).not.toBeInTheDocument();
    });
  });

  describe("expired item — explicit state (daily-usage Input 5)", () => {
    it("renders the expired state element for an expired item", () => {
      renderAtRoute("item-expired");
      expect(
        screen.getByTestId(locators.inbox.item.expiredState)
      ).toBeInTheDocument();
    });
  });

  describe("missing item id — explicit state (daily-usage Input 5)", () => {
    it("renders the missing state when the id does not match any item", () => {
      renderAtRoute("item-does-not-exist");
      expect(
        screen.getByTestId(locators.inbox.item.missingState)
      ).toBeInTheDocument();
    });

    it("does NOT render the item root for a missing id", () => {
      renderAtRoute("item-does-not-exist");
      expect(
        screen.queryByTestId(locators.inbox.item.root)
      ).not.toBeInTheDocument();
    });
  });
});

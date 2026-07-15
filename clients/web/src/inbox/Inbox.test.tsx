import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Inbox } from "@/inbox/Inbox";
import type { InboxItemVM } from "@/inbox/inbox-vm";
import { locators } from "@/locators";

function makeOpenVM(overrides: Partial<InboxItemVM> = {}): InboxItemVM {
  return {
    id: "item-001",
    kind: "escalation",
    featureId: "feat-001",
    summary: "Some escalation",
    type: "write-access-request",
    severity: "medium",
    suggestedCategory: "correction",
    evidence: { kind: "text", text: "some evidence" },
    status: "open",
    ...overrides,
  };
}

const SORT_FIXTURE: InboxItemVM[] = [
  makeOpenVM({ id: "item-z-app", kind: "approval", type: "github.merge", severity: "high" }),
  makeOpenVM({ id: "item-a-esc", kind: "escalation", type: "write-access-request", severity: "low" }),
  makeOpenVM({ id: "item-b-esc", kind: "escalation", type: "write-access-request", severity: "medium" }),
];

const FILTER_FIXTURE: InboxItemVM[] = [
  makeOpenVM({ id: "item-f1", type: "unclassified-artifact-change", severity: "medium" }),
  makeOpenVM({ id: "item-f2", type: "write-access-request", severity: "high" }),
  makeOpenVM({ id: "item-f3", type: "unclassified-artifact-change", severity: "low" }),
];

const BADGE_FIXTURE: InboxItemVM[] = [
  makeOpenVM({ id: "item-unc", type: "unclassified-artifact-change", severity: "high" }),
  makeOpenVM({ id: "item-nor", type: "write-access-request", severity: "medium" }),
];

describe("Inbox — inbox list surface (Story 003 T1)", () => {
  describe("loading state", () => {
    it("renders the loading state while data is fetching", () => {
      render(<Inbox loading />);
      expect(screen.getByTestId(locators.dataStates.loading)).toBeInTheDocument();
    });
  });

  describe("3-item sort fixture — rows and badges", () => {
    it("renders exactly three rows", () => {
      render(<Inbox items={SORT_FIXTURE} />);
      expect(screen.getAllByTestId(locators.inbox.list.row)).toHaveLength(3);
    });

    it("table root carries the inbox list table testid (DESIGN §8)", () => {
      render(<Inbox items={SORT_FIXTURE} />);
      expect(screen.getByTestId(locators.inbox.list.table)).toBeInTheDocument();
    });

    it("each inbox item exposes a registry-selected deep link to its item route", () => {
      render(
        <MemoryRouter>
          <Inbox items={SORT_FIXTURE} />
        </MemoryRouter>,
      );

      expect(
        screen.getByTestId(locators.inbox.list.itemLink("item-a-esc")),
      ).toHaveAttribute("href", "/inbox/item-a-esc");
    });
  });

  describe("scannable badges (daily-usage Input 2)", () => {
    it("unclassified-artifact-change row renders the distinct unclassified badge", () => {
      render(<Inbox items={BADGE_FIXTURE} />);
      expect(screen.getAllByTestId(locators.status.unclassifiedBadge).length).toBeGreaterThanOrEqual(1);
    });

    it("non-unclassified row renders the standard severity badge", () => {
      render(<Inbox items={BADGE_FIXTURE} />);
      expect(screen.getAllByTestId(locators.status.severityBadge).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("deterministic default sort", () => {
    it("escalation items appear before approval items in the rendered list", () => {
      render(<Inbox items={SORT_FIXTURE} />);
      const rows = screen.getAllByTestId(locators.inbox.list.row);
      expect(rows[0]).toHaveTextContent("item-a-esc");
      expect(rows[1]).toHaveTextContent("item-b-esc");
    });

    it("approval items appear after all escalation items", () => {
      render(<Inbox items={SORT_FIXTURE} />);
      expect(screen.getAllByTestId(locators.inbox.list.row)[2]).toHaveTextContent("item-z-app");
    });

    it("within the same kind, rows are sorted by id alphabetically", () => {
      render(<Inbox items={SORT_FIXTURE} />);
      const rows = screen.getAllByTestId(locators.inbox.list.row);
      expect(rows[0]).toHaveTextContent("item-a-esc");
      expect(rows[1]).toHaveTextContent("item-b-esc");
    });
  });

  describe("type filter (daily-usage Input 2)", () => {
    it("type filter control is present in the toolbar", () => {
      render(<Inbox items={FILTER_FIXTURE} />);
      expect(screen.getByTestId(locators.inbox.list.typeFilter)).toBeInTheDocument();
    });

    it("filtering to 'unclassified-artifact-change' shows only those 2 rows", async () => {
      const user = userEvent.setup();
      render(<Inbox items={FILTER_FIXTURE} />);
      await user.click(screen.getByTestId(locators.inbox.list.typeFilter));
      await user.click(await screen.findByTestId(locators.inbox.list.typeFilterItem("unclassified-artifact-change")));
      expect(screen.getAllByTestId(locators.inbox.list.row)).toHaveLength(2);
    });

    it("filtering to 'write-access-request' shows only that 1 row", async () => {
      const user = userEvent.setup();
      render(<Inbox items={FILTER_FIXTURE} />);
      await user.click(screen.getByTestId(locators.inbox.list.typeFilter));
      await user.click(await screen.findByTestId(locators.inbox.list.typeFilterItem("write-access-request")));
      expect(screen.getAllByTestId(locators.inbox.list.row)).toHaveLength(1);
    });
  });

  describe("empty inbox state", () => {
    it("renders the explicit empty state when the API returns no items", () => {
      render(<Inbox items={[]} />);
      expect(screen.getByTestId(locators.inbox.list.empty)).toBeInTheDocument();
    });

    it("does not render any rows in the empty state", () => {
      render(<Inbox items={[]} />);
      expect(screen.queryAllByTestId(locators.inbox.list.row)).toHaveLength(0);
    });
  });

  describe("error state", () => {
    it("renders the error state when the client rejects", () => {
      render(<Inbox error={{ message: "network failure" }} />);
      expect(screen.getByTestId(locators.dataStates.error)).toBeInTheDocument();
    });
  });
});

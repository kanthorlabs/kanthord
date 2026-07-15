/**
 * Story 003 T1 — Inbox list component tests.
 *
 * Fake-client convention (Story 001 pattern): wrap in DaemonClientProvider with
 * an inline fake that implements listInboxItems only.
 *
 * The Inbox component fetches via client.listInboxItems({}), adapts each proto
 * item via toInboxItemVM, then renders the list.
 *
 * Asserts:
 *   - Loading state while data is fetching
 *   - 3-item fixture → 3 rows; each row carries an EscalationSeverityBadge
 *   - unclassified-artifact-change item → row contains the distinct unclassified badge
 *   - non-unclassified items → rows contain the standard severity badge
 *   - Deterministic default sort: escalations first, then approvals; within each
 *     kind sorted by id alphabetically — fixture submitted out of sort order to
 *     prove the sort applies
 *   - Type filter narrows the visible rows
 *   - Empty inbox → explicit empty state; no rows rendered
 *   - Error state when the client rejects
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because:
 *   - clients/web/src/inbox/Inbox.tsx does not exist
 *   - locators.inbox.list.{table,row,empty,typeFilter,typeFilterItem} are not in
 *     the registry
 *   - locators.status.severityBadge and locators.status.unclassifiedBadge are not
 *     in the registry
 */
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Inbox } from "@/inbox/Inbox";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";

// ---------------------------------------------------------------------------
// View-model fixture builders
// ---------------------------------------------------------------------------

/**
 * The adapter produces InboxItemVM from the proto items the fake client
 * returns.  The fake client here returns proto-shaped objects that the Inbox
 * component passes through toInboxItemVM.  Fields unavailable in the current
 * proto (type, severity, suggestedCategory, evidence, status) will be defaulted
 * by the adapter.  For scannable-badge and filter tests we need type/severity
 * to be non-default, so we embed them in `summary` as JSON to be read by a
 * richer proto in the future — or the SE supplies a richer adapter seam.
 *
 * NOTE TO SE: The sort + filter tests below require the Inbox component to
 * expose an InboxItemVM per row.  The type filter must filter on vm.type.
 * The sort is: escalation before approval, then by id alphabetically.
 * The vm.type and vm.severity fields must be populated for badges to render.
 * Until the proto carries these fields, the adapter can default them or the
 * Inbox component may accept an `items` override prop for tests.
 *
 * For the badge and sort/filter tests to be deterministic the fake client
 * returns pre-built InboxItemVM objects.  We use the established
 * `as unknown as DaemonClient` cast so that the fake can return VM-shaped
 * objects directly, bypassing the real adapter.  The adapter is tested
 * separately in inbox-vm.test.ts.
 */

import type { InboxItemVM } from "@/inbox/inbox-vm";

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

// ---------------------------------------------------------------------------
// Fake client helpers
//
// The Inbox component calls client.listInboxItems({}) and adapts the result.
// For badge/sort/filter tests we need full VM control, so the fake returns
// objects already in InboxItemVM shape (the Inbox component uses a passed-in
// items override prop, OR accepts VMs directly when the client is faked at
// the VM level — SE decides which seam; tests drive via InboxItemVM fixtures).
// ---------------------------------------------------------------------------

function makeListClient(items: InboxItemVM[]): DaemonClient {
  return {
    listInboxItems: async () => ({ items }),
  } as unknown as DaemonClient;
}

function makeRejectingClient(): DaemonClient {
  return {
    listInboxItems: async () => {
      throw new Error("network failure");
    },
  } as unknown as DaemonClient;
}

function makeHangingClient(): DaemonClient {
  return {
    listInboxItems: () => new Promise(() => { /* never resolves */ }),
  } as unknown as DaemonClient;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Deterministic sort fixture: submitted out of sort order.
// Expected sort: escalation before approval, then id alphabetically.
// Expected order: item-a-esc, item-b-esc, item-z-app.
const SORT_FIXTURE: InboxItemVM[] = [
  makeOpenVM({ id: "item-z-app", kind: "approval",   type: "github.merge",             severity: "high"   }),
  makeOpenVM({ id: "item-a-esc", kind: "escalation", type: "write-access-request",      severity: "low"    }),
  makeOpenVM({ id: "item-b-esc", kind: "escalation", type: "write-access-request",      severity: "medium" }),
];

// Filter fixture: two unclassified-artifact-change + one write-access-request
const FILTER_FIXTURE: InboxItemVM[] = [
  makeOpenVM({ id: "item-f1", type: "unclassified-artifact-change", severity: "medium" }),
  makeOpenVM({ id: "item-f2", type: "write-access-request",          severity: "high"   }),
  makeOpenVM({ id: "item-f3", type: "unclassified-artifact-change", severity: "low"    }),
];

// Badge fixture: one unclassified + one normal escalation
const BADGE_FIXTURE: InboxItemVM[] = [
  makeOpenVM({ id: "item-unc", type: "unclassified-artifact-change", severity: "high"   }),
  makeOpenVM({ id: "item-nor", type: "write-access-request",          severity: "medium" }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Inbox — inbox list surface (Story 003 T1)", () => {
  describe("loading state", () => {
    it("renders the loading state while data is fetching", () => {
      render(
        <DaemonClientProvider client={makeHangingClient()}>
          <Inbox />
        </DaemonClientProvider>
      );
      expect(
        screen.getByTestId(locators.dataStates.loading)
      ).toBeInTheDocument();
    });
  });

  describe("3-item sort fixture — rows and badges", () => {
    it("renders exactly three rows", async () => {
      render(
        <DaemonClientProvider client={makeListClient(SORT_FIXTURE)}>
          <Inbox />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.inbox.list.row);
      expect(rows).toHaveLength(3);
    });

    it("table root carries the inbox list table testid (DESIGN §8)", async () => {
      render(
        <DaemonClientProvider client={makeListClient(SORT_FIXTURE)}>
          <Inbox />
        </DaemonClientProvider>
      );
      await screen.findAllByTestId(locators.inbox.list.row);
      expect(
        screen.getByTestId(locators.inbox.list.table)
      ).toBeInTheDocument();
    });
  });

  describe("scannable badges (daily-usage Input 2)", () => {
    it("unclassified-artifact-change row renders the distinct unclassified badge", async () => {
      render(
        <DaemonClientProvider client={makeListClient(BADGE_FIXTURE)}>
          <Inbox />
        </DaemonClientProvider>
      );
      await screen.findAllByTestId(locators.inbox.list.row);
      // At least one unclassifiedBadge is present (for item-unc)
      const unclassifiedBadges = screen.getAllByTestId(
        locators.status.unclassifiedBadge
      );
      expect(unclassifiedBadges.length).toBeGreaterThanOrEqual(1);
    });

    it("non-unclassified row renders the standard severity badge", async () => {
      render(
        <DaemonClientProvider client={makeListClient(BADGE_FIXTURE)}>
          <Inbox />
        </DaemonClientProvider>
      );
      await screen.findAllByTestId(locators.inbox.list.row);
      // At least one severityBadge is present (for item-nor)
      const severityBadges = screen.getAllByTestId(locators.status.severityBadge);
      expect(severityBadges.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("deterministic default sort", () => {
    it("escalation items appear before approval items in the rendered list", async () => {
      render(
        <DaemonClientProvider client={makeListClient(SORT_FIXTURE)}>
          <Inbox />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.inbox.list.row);
      // First two rows are escalations (item-a-esc, item-b-esc)
      expect(rows[0]).toHaveTextContent("item-a-esc");
      expect(rows[1]).toHaveTextContent("item-b-esc");
    });

    it("approval items appear after all escalation items", async () => {
      render(
        <DaemonClientProvider client={makeListClient(SORT_FIXTURE)}>
          <Inbox />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.inbox.list.row);
      // Last row is approval (item-z-app)
      expect(rows[2]).toHaveTextContent("item-z-app");
    });

    it("within the same kind, rows are sorted by id alphabetically", async () => {
      render(
        <DaemonClientProvider client={makeListClient(SORT_FIXTURE)}>
          <Inbox />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.inbox.list.row);
      // item-a-esc < item-b-esc alphabetically → item-a-esc at index 0
      expect(rows[0]).toHaveTextContent("item-a-esc");
      expect(rows[1]).toHaveTextContent("item-b-esc");
    });
  });

  describe("type filter (daily-usage Input 2)", () => {
    it("type filter control is present in the toolbar", async () => {
      render(
        <DaemonClientProvider client={makeListClient(FILTER_FIXTURE)}>
          <Inbox />
        </DaemonClientProvider>
      );
      await screen.findAllByTestId(locators.inbox.list.row);
      expect(
        screen.getByTestId(locators.inbox.list.typeFilter)
      ).toBeInTheDocument();
    });

    it("filtering to 'unclassified-artifact-change' shows only those 2 rows", async () => {
      const user = userEvent.setup();
      render(
        <DaemonClientProvider client={makeListClient(FILTER_FIXTURE)}>
          <Inbox />
        </DaemonClientProvider>
      );
      // Wait for list to render (3 rows initially)
      await screen.findAllByTestId(locators.inbox.list.row);

      // Open the type filter trigger (works for both custom div and vendored
      // Select — the trigger testid is the same in both implementations).
      await user.click(screen.getByTestId(locators.inbox.list.typeFilter));

      // Use findByTestId (async) so the test works whether the item is
      // immediately in the DOM (custom div) or appears in a Radix Select
      // portal after the trigger opens (vendored Select, B1 target impl).
      await user.click(
        await screen.findByTestId(locators.inbox.list.typeFilterItem("unclassified-artifact-change"))
      );

      const rows = screen.getAllByTestId(locators.inbox.list.row);
      expect(rows).toHaveLength(2);
    });

    it("filtering to 'write-access-request' shows only that 1 row", async () => {
      const user = userEvent.setup();
      render(
        <DaemonClientProvider client={makeListClient(FILTER_FIXTURE)}>
          <Inbox />
        </DaemonClientProvider>
      );
      await screen.findAllByTestId(locators.inbox.list.row);

      // Open trigger first; wait for item via findByTestId for Radix portal
      // compatibility (B1 — same two-step userEvent pattern as vendored Select).
      await user.click(screen.getByTestId(locators.inbox.list.typeFilter));
      await user.click(
        await screen.findByTestId(locators.inbox.list.typeFilterItem("write-access-request"))
      );

      const rows = screen.getAllByTestId(locators.inbox.list.row);
      expect(rows).toHaveLength(1);
    });
  });

  describe("empty inbox state", () => {
    it("renders the explicit empty state when the API returns no items", async () => {
      render(
        <DaemonClientProvider client={makeListClient([])}>
          <Inbox />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.inbox.list.empty);
      expect(
        screen.getByTestId(locators.inbox.list.empty)
      ).toBeInTheDocument();
    });

    it("does not render any rows in the empty state", async () => {
      render(
        <DaemonClientProvider client={makeListClient([])}>
          <Inbox />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.inbox.list.empty);
      expect(
        screen.queryAllByTestId(locators.inbox.list.row)
      ).toHaveLength(0);
    });
  });

  describe("error state", () => {
    it("renders the error state when the client rejects", async () => {
      render(
        <DaemonClientProvider client={makeRejectingClient()}>
          <Inbox />
        </DaemonClientProvider>
      );
      await waitFor(() => {
        expect(
          screen.getByTestId(locators.dataStates.error)
        ).toBeInTheDocument();
      });
    });
  });
});

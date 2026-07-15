/**
 * Story 006 T1 — Budgets view + override flow component tests.
 *
 * The budgets surface renders a per-task ledger built against a BudgetVM list
 * (N4 gap — no ListBudgets on the proto; the component accepts a pre-resolved
 * view-model list from a thin adapter that issues per-task GetBudget calls).
 * Hermetic tests drive the component directly with fixtures; the override
 * mutation uses the real overrideBudget client method via DaemonClientProvider.
 *
 * N4 ADAPTER NOTE (api-needs-for-026.md §N4):
 *   Only GetBudget(task_id) exists. The Budgets surface uses a UI-side
 *   view-model adapter (BudgetVM list) and waits for a ListBudgets proto
 *   decision from Epic 026. The adapter will be wired to the live daemon once
 *   ListBudgets lands; until then the view-model list comes from per-task
 *   GetBudget calls aggregated in the page layer.
 *
 * Asserts:
 *   LEDGER RENDER:
 *   - The ledger table root renders
 *   - Each row carries its task id, spent, ceiling, and a BreakerStateBadge
 *   - A recorded override (override.present=true) shows actor, amount, reason
 *   - An empty list renders the explicit empty state (no table)
 *
 *   OVERRIDE FLOW (ConfirmActionDialog, requiresInput=reason, DESIGN §7):
 *   - Override trigger renders for each row (per-row locator keyed by taskId)
 *   - Clicking the trigger opens the ConfirmActionDialog
 *   - Confirm is disabled until a non-empty reason is typed (client-side gate)
 *   - Confirm becomes enabled after typing a reason
 *   - On confirm, client.overrideBudget is called with taskId + the typed reason
 *   - A success state renders after a successful override
 *   - Rate-limit rejection (ConnectError Code.ResourceExhausted) renders the
 *     typed api-error element with the server message
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because:
 *   - clients/web/src/budgets/Budgets.tsx does not exist
 *   - clients/web/src/budgets/budget-vm.ts does not exist (BudgetVM type)
 *   - locators.budgets.ledger.{table,row,empty} are not in the registry
 *   - locators.budgets.override.{trigger,apiError,successState} are not in
 *     the registry
 *   - locators.status.breakerStateBadge is not in the registry
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectError, Code } from "@connectrpc/connect";
import { Budgets } from "@/budgets/Budgets";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";

// ---------------------------------------------------------------------------
// Fixtures — plain objects matching the BudgetVM shape the component defines.
// The TE does not import the type (it does not exist yet); the SE creates it
// in clients/web/src/budgets/budget-vm.ts when implementing the component.
// ---------------------------------------------------------------------------

const BUDGET_CLOSED = {
  taskId: "task-001",
  spent: 42.5,
  ceiling: 100.0,
  breakerState: "closed",
  override: { present: false, amount: 0, reason: "", actor: "" },
};

const BUDGET_OPEN_WITH_OVERRIDE = {
  taskId: "task-002",
  spent: 105.0,
  ceiling: 100.0,
  breakerState: "open",
  override: {
    present: true,
    amount: 150.0,
    reason: "Emergency budget raise for critical feature",
    actor: "alice",
  },
};

const BUDGET_HALFOPEN = {
  taskId: "task-003",
  spent: 80.0,
  ceiling: 100.0,
  breakerState: "half-open",
  override: { present: false, amount: 0, reason: "", actor: "" },
};

// ---------------------------------------------------------------------------
// Fake clients
// ---------------------------------------------------------------------------

function makeOverrideClient(
  overrideFn: DaemonClient["overrideBudget"]
): DaemonClient {
  return { overrideBudget: overrideFn } as unknown as DaemonClient;
}

function makeSuccessClient(): {
  client: DaemonClient;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn().mockResolvedValue({ newCeiling: 150 });
  return { client: makeOverrideClient(spy), spy };
}

function makeRateLimitClient(): DaemonClient {
  return makeOverrideClient(async () => {
    throw new ConnectError("rate limit exceeded", Code.ResourceExhausted);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Budgets — per-task ledger + override flow (Story 006 T1)", () => {
  // -----------------------------------------------------------------------
  // Ledger render
  // -----------------------------------------------------------------------

  describe("ledger table", () => {
    it("renders the ledger table root with two fixture rows", () => {
      render(
        <DaemonClientProvider client={makeOverrideClient(vi.fn())}>
          <Budgets budgets={[BUDGET_CLOSED, BUDGET_OPEN_WITH_OVERRIDE]} />
        </DaemonClientProvider>
      );
      expect(screen.getByTestId(locators.budgets.ledger.table)).toBeInTheDocument();
      const rows = screen.getAllByTestId(locators.budgets.ledger.row);
      expect(rows).toHaveLength(2);
    });

    it("each row shows its task id", () => {
      render(
        <DaemonClientProvider client={makeOverrideClient(vi.fn())}>
          <Budgets budgets={[BUDGET_CLOSED, BUDGET_OPEN_WITH_OVERRIDE]} />
        </DaemonClientProvider>
      );
      const rows = screen.getAllByTestId(locators.budgets.ledger.row);
      expect(rows[0]).toHaveTextContent(BUDGET_CLOSED.taskId);
      expect(rows[1]).toHaveTextContent(BUDGET_OPEN_WITH_OVERRIDE.taskId);
    });

    it("renders a BreakerStateBadge in each row", () => {
      render(
        <DaemonClientProvider client={makeOverrideClient(vi.fn())}>
          <Budgets
            budgets={[BUDGET_CLOSED, BUDGET_OPEN_WITH_OVERRIDE, BUDGET_HALFOPEN]}
          />
        </DaemonClientProvider>
      );
      const badges = screen.getAllByTestId(locators.status.breakerStateBadge);
      expect(badges).toHaveLength(3);
    });

    it("renders the explicit empty state when the budgets list is empty", () => {
      render(
        <DaemonClientProvider client={makeOverrideClient(vi.fn())}>
          <Budgets budgets={[]} />
        </DaemonClientProvider>
      );
      expect(screen.getByTestId(locators.budgets.ledger.empty)).toBeInTheDocument();
    });

    it("does not render the ledger table when the budgets list is empty", () => {
      render(
        <DaemonClientProvider client={makeOverrideClient(vi.fn())}>
          <Budgets budgets={[]} />
        </DaemonClientProvider>
      );
      expect(
        screen.queryByTestId(locators.budgets.ledger.table)
      ).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Recorded override visibility
  // -----------------------------------------------------------------------

  describe("recorded override (override.present=true) is visible", () => {
    it("shows the override actor", () => {
      render(
        <DaemonClientProvider client={makeOverrideClient(vi.fn())}>
          <Budgets budgets={[BUDGET_OPEN_WITH_OVERRIDE]} />
        </DaemonClientProvider>
      );
      const row = screen.getByTestId(locators.budgets.ledger.row);
      expect(row).toHaveTextContent(BUDGET_OPEN_WITH_OVERRIDE.override.actor);
    });

    it("shows the override reason", () => {
      render(
        <DaemonClientProvider client={makeOverrideClient(vi.fn())}>
          <Budgets budgets={[BUDGET_OPEN_WITH_OVERRIDE]} />
        </DaemonClientProvider>
      );
      const row = screen.getByTestId(locators.budgets.ledger.row);
      expect(row).toHaveTextContent(
        BUDGET_OPEN_WITH_OVERRIDE.override.reason
      );
    });

    it("shows the override amount", () => {
      render(
        <DaemonClientProvider client={makeOverrideClient(vi.fn())}>
          <Budgets budgets={[BUDGET_OPEN_WITH_OVERRIDE]} />
        </DaemonClientProvider>
      );
      const row = screen.getByTestId(locators.budgets.ledger.row);
      // 150.0 should appear as "150" or similar in the rendered text
      expect(row).toHaveTextContent("150");
    });
  });

  // -----------------------------------------------------------------------
  // Override flow — ConfirmActionDialog with requiresInput (DESIGN §7)
  // -----------------------------------------------------------------------

  describe("override flow", () => {
    it("override trigger renders for each budget row (keyed by taskId)", () => {
      render(
        <DaemonClientProvider client={makeOverrideClient(vi.fn())}>
          <Budgets budgets={[BUDGET_CLOSED, BUDGET_OPEN_WITH_OVERRIDE]} />
        </DaemonClientProvider>
      );
      expect(
        screen.getByTestId(locators.budgets.override.trigger(BUDGET_CLOSED.taskId))
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(
          locators.budgets.override.trigger(BUDGET_OPEN_WITH_OVERRIDE.taskId)
        )
      ).toBeInTheDocument();
    });

    it("clicking the override trigger opens the dialog (confirmDialog.content appears)", async () => {
      const user = userEvent.setup();
      render(
        <DaemonClientProvider client={makeOverrideClient(vi.fn())}>
          <Budgets budgets={[BUDGET_CLOSED]} />
        </DaemonClientProvider>
      );
      await user.click(
        screen.getByTestId(locators.budgets.override.trigger(BUDGET_CLOSED.taskId))
      );
      expect(screen.getByTestId(locators.confirmDialog.content)).toBeInTheDocument();
    });

    it("confirm button is disabled before a reason is entered (client-side gate)", async () => {
      const user = userEvent.setup();
      render(
        <DaemonClientProvider client={makeOverrideClient(vi.fn())}>
          <Budgets budgets={[BUDGET_CLOSED]} />
        </DaemonClientProvider>
      );
      await user.click(
        screen.getByTestId(locators.budgets.override.trigger(BUDGET_CLOSED.taskId))
      );
      expect(screen.getByTestId(locators.confirmDialog.confirm)).toBeDisabled();
    });

    it("confirm button is enabled after typing a non-empty reason", async () => {
      const user = userEvent.setup();
      render(
        <DaemonClientProvider client={makeOverrideClient(vi.fn())}>
          <Budgets budgets={[BUDGET_CLOSED]} />
        </DaemonClientProvider>
      );
      await user.click(
        screen.getByTestId(locators.budgets.override.trigger(BUDGET_CLOSED.taskId))
      );
      await user.type(
        screen.getByTestId(locators.confirmDialog.input),
        "testing override"
      );
      expect(screen.getByTestId(locators.confirmDialog.confirm)).not.toBeDisabled();
    });

    it("on confirm, calls overrideBudget with the correct taskId and typed reason", async () => {
      const user = userEvent.setup();
      const { client, spy } = makeSuccessClient();
      render(
        <DaemonClientProvider client={client}>
          <Budgets budgets={[BUDGET_CLOSED]} />
        </DaemonClientProvider>
      );
      await user.click(
        screen.getByTestId(locators.budgets.override.trigger(BUDGET_CLOSED.taskId))
      );
      await user.type(
        screen.getByTestId(locators.confirmDialog.input),
        "emergency override reason"
      );
      await user.click(screen.getByTestId(locators.confirmDialog.confirm));
      await waitFor(() => {
        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({
            taskId: BUDGET_CLOSED.taskId,
            reason: "emergency override reason",
          })
        );
      });
    });

    it("renders the success state after a successful override", async () => {
      const user = userEvent.setup();
      const { client } = makeSuccessClient();
      render(
        <DaemonClientProvider client={client}>
          <Budgets budgets={[BUDGET_CLOSED]} />
        </DaemonClientProvider>
      );
      await user.click(
        screen.getByTestId(locators.budgets.override.trigger(BUDGET_CLOSED.taskId))
      );
      await user.type(
        screen.getByTestId(locators.confirmDialog.input),
        "override approved"
      );
      await user.click(screen.getByTestId(locators.confirmDialog.confirm));
      await screen.findByTestId(locators.budgets.override.successState);
      expect(
        screen.getByTestId(locators.budgets.override.successState)
      ).toBeInTheDocument();
    });

    // -----------------------------------------------------------------------
    // Error handling — plain Error (non-ConnectError) (B6, reviewer blocker)
    // -----------------------------------------------------------------------

    it("renders the api-error surface when overrideBudget throws a plain Error (not ConnectError) (B6)", async () => {
      // Current catch handles only ConnectError — a plain Error is silently
      // dropped, so overrideResult stays 'idle' and apiError never renders.
      // After the fix, ANY error must surface the apiError element.
      const user = userEvent.setup();
      const spy = vi.fn().mockRejectedValue(new Error("network failure"));
      const client = makeOverrideClient(spy);

      render(
        <DaemonClientProvider client={client}>
          <Budgets budgets={[BUDGET_CLOSED]} />
        </DaemonClientProvider>
      );

      await user.click(
        screen.getByTestId(locators.budgets.override.trigger(BUDGET_CLOSED.taskId))
      );
      await user.type(
        screen.getByTestId(locators.confirmDialog.input),
        "a reason"
      );
      await user.click(screen.getByTestId(locators.confirmDialog.confirm));

      // The mutation must have been attempted.
      await waitFor(() => expect(spy).toHaveBeenCalledOnce());

      // The apiError surface must appear (not success, not idle).
      const errEl = await screen.findByTestId(locators.budgets.override.apiError);
      expect(errEl).toBeInTheDocument();

      // Success state must NOT appear.
      expect(
        screen.queryByTestId(locators.budgets.override.successState)
      ).not.toBeInTheDocument();
    });

    it("renders the typed api error when override is rate-limited (Code.ResourceExhausted)", async () => {
      const user = userEvent.setup();
      render(
        <DaemonClientProvider client={makeRateLimitClient()}>
          <Budgets budgets={[BUDGET_CLOSED]} />
        </DaemonClientProvider>
      );
      await user.click(
        screen.getByTestId(locators.budgets.override.trigger(BUDGET_CLOSED.taskId))
      );
      await user.type(
        screen.getByTestId(locators.confirmDialog.input),
        "a reason"
      );
      await user.click(screen.getByTestId(locators.confirmDialog.confirm));
      await screen.findByTestId(locators.budgets.override.apiError);
      const err = screen.getByTestId(locators.budgets.override.apiError);
      expect(err).toBeInTheDocument();
      expect(err).toHaveTextContent("rate limit exceeded");
    });
  });
});

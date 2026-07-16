/**
 * Story 002 T2 — Halt flow component tests.
 *
 * Fake-client convention (established in Story 001):
 *   - Tests wrap in <DaemonClientProvider client={fake}> with an inline fake.
 *
 * ACs:
 *   - Halt is a destructive verb → rendered via ConfirmActionDialog (DESIGN §7)
 *   - Halt on a running fixture task → confirms via dialog → parked status +
 *     acting user rendered in result area
 *   - Second-halt typed CONFLICT (ConnectError Code.AlreadyExists) → the typed
 *     conflict is surfaced inline (not a generic error toast)
 *   - Without confirming the dialog, haltTask is never called
 *
 * Selection via registry locators only (DESIGN §8).
 * The Halt trigger is locators.planFlows.halt.trigger (halt-scoped).
 * The confirm/cancel buttons are locators.confirmDialog.{confirm,cancel}
 * (shared ConfirmActionDialog composite locators).
 *
 * RED: fails because:
 *   - clients/web/src/plan-flows/Halt.tsx does not exist
 *   - locators.planFlows.halt.{trigger,result,conflict} are not in locators.ts
 *   - locators.confirmDialog.{confirm,cancel} are not in locators.ts
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectError, Code } from "@connectrpc/connect";
import { Halt } from "@/plan-flows/Halt";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUNNING_TASK = {
  taskId: "task-001",
  actor: "operator@kanthord",
};

const PARKED_RESPONSE = {
  status: "parked",
};

function makeHaltClient(callLog: string[]): DaemonClient {
  return {
    haltTask: async () => {
      callLog.push("haltTask");
      return PARKED_RESPONSE;
    },
  } as unknown as DaemonClient;
}

function makeConflictHaltClient(callLog: string[]): DaemonClient {
  return {
    haltTask: async () => {
      callLog.push("haltTask");
      throw new ConnectError("task is already halted", Code.AlreadyExists);
    },
  } as unknown as DaemonClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Halt — halt flow (Story 002 T2)", () => {
  describe("trigger renders (destructive path via ConfirmActionDialog)", () => {
    it("renders the halt trigger button", () => {
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeHaltClient(callLog)}>
          <Halt taskId={RUNNING_TASK.taskId} actor={RUNNING_TASK.actor} />
        </DaemonClientProvider>
      );
      expect(
        screen.getByTestId(locators.planFlows.halt.trigger)
      ).toBeInTheDocument();
    });

    it("does not invoke haltTask when the user cancels the confirm dialog", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeHaltClient(callLog)}>
          <Halt taskId={RUNNING_TASK.taskId} actor={RUNNING_TASK.actor} />
        </DaemonClientProvider>
      );
      // Open dialog, then cancel
      await user.click(screen.getByTestId(locators.planFlows.halt.trigger));
      await user.click(screen.getByTestId(locators.confirmDialog.cancel));
      expect(callLog).toHaveLength(0);
    });
  });

  describe("running fixture — parked state + acting user", () => {
    it("invokes onSuccess exactly once after a successful halt", async () => {
      const user = userEvent.setup();
      const onSuccess = vi.fn();
      render(
        <DaemonClientProvider client={makeHaltClient([])}>
          <Halt taskId={RUNNING_TASK.taskId} actor={RUNNING_TASK.actor} onSuccess={onSuccess} />
        </DaemonClientProvider>
      );

      await user.click(screen.getByTestId(locators.planFlows.halt.trigger));
      await user.click(screen.getByTestId(locators.confirmDialog.confirm));
      await screen.findByTestId(locators.planFlows.halt.result);
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    it("renders the parked status in the result after confirming halt", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeHaltClient(callLog)}>
          <Halt taskId={RUNNING_TASK.taskId} actor={RUNNING_TASK.actor} />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.halt.trigger));
      await user.click(screen.getByTestId(locators.confirmDialog.confirm));
      const result = await screen.findByTestId(locators.planFlows.halt.result);
      expect(result).toHaveTextContent("parked");
      expect(callLog).toEqual(["haltTask"]);
    });

    it("renders the acting user in the result after confirming halt", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeHaltClient(callLog)}>
          <Halt taskId={RUNNING_TASK.taskId} actor={RUNNING_TASK.actor} />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.halt.trigger));
      await user.click(screen.getByTestId(locators.confirmDialog.confirm));
      const result = await screen.findByTestId(locators.planFlows.halt.result);
      expect(result).toHaveTextContent("operator@kanthord");
      expect(callLog).toEqual(["haltTask"]);
    });
  });

  describe("second-halt typed CONFLICT fixture", () => {
    it("does not invoke onSuccess when the API returns a halt conflict", async () => {
      const user = userEvent.setup();
      const onSuccess = vi.fn();
      render(
        <DaemonClientProvider client={makeConflictHaltClient([])}>
          <Halt taskId={RUNNING_TASK.taskId} actor={RUNNING_TASK.actor} onSuccess={onSuccess} />
        </DaemonClientProvider>
      );

      await user.click(screen.getByTestId(locators.planFlows.halt.trigger));
      await user.click(screen.getByTestId(locators.confirmDialog.confirm));
      await screen.findByTestId(locators.planFlows.halt.conflict);
      expect(onSuccess).not.toHaveBeenCalled();
    });
    it("renders the typed conflict element when the API returns AlreadyExists", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeConflictHaltClient(callLog)}>
          <Halt taskId={RUNNING_TASK.taskId} actor={RUNNING_TASK.actor} />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.halt.trigger));
      await user.click(screen.getByTestId(locators.confirmDialog.confirm));
      const conflict = await screen.findByTestId(locators.planFlows.halt.conflict);
      // Typed conflict element is present (surfaced inline, not a sonner toast)
      expect(conflict).toBeInTheDocument();
    });

    it("conflict element contains the already-halted error message", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeConflictHaltClient(callLog)}>
          <Halt taskId={RUNNING_TASK.taskId} actor={RUNNING_TASK.actor} />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.halt.trigger));
      await user.click(screen.getByTestId(locators.confirmDialog.confirm));
      const conflict = await screen.findByTestId(locators.planFlows.halt.conflict);
      expect(conflict).toHaveTextContent("already halted");
    });

    it("does not render the success result element on conflict", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeConflictHaltClient(callLog)}>
          <Halt taskId={RUNNING_TASK.taskId} actor={RUNNING_TASK.actor} />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.halt.trigger));
      await user.click(screen.getByTestId(locators.confirmDialog.confirm));
      await screen.findByTestId(locators.planFlows.halt.conflict);
      expect(
        screen.queryByTestId(locators.planFlows.halt.result)
      ).not.toBeInTheDocument();
    });
  });
});

/**
 * Story 002 T2 — ConfirmActionDialog composite tests.
 *
 * ConfirmActionDialog is the DESIGN §7 destructive-confirm composite:
 *   - Always uses AlertDialog (never a plain dialog) for destructive/irreversible verbs
 *   - Accepts a trigger ReactNode (the caller's button) + title + description + onConfirm
 *   - Optionally accepts a requiresInput spec — when set, the confirm button is disabled
 *     until the user types a non-empty value in the required input field
 *
 * DESIGN §8 locator placement for AlertDialog:
 *   trigger = confirmDialog.trigger (placed on the trigger element by the consumer)
 *   portal content root = confirmDialog.content (placed by ConfirmActionDialog on
 *     AlertDialogContent)
 *   confirm action = confirmDialog.confirm (placed by ConfirmActionDialog on
 *     AlertDialogAction)
 *   cancel action = confirmDialog.cancel (placed by ConfirmActionDialog on
 *     AlertDialogCancel)
 *   required input = confirmDialog.input (present only when requiresInput is set)
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because:
 *   - clients/web/src/components/ConfirmActionDialog.tsx does not exist
 *   - locators.confirmDialog.{trigger,content,confirm,cancel,input} are not
 *     in clients/web/src/locators.ts
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { locators } from "@/locators";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConfirmActionDialog — destructive-confirm composite (Story 002 T2)", () => {
  describe("trigger renders and is clickable", () => {
    it("renders the trigger element before the dialog is opened", () => {
      render(
        <ConfirmActionDialog
          trigger={
            <button data-testid={locators.confirmDialog.trigger}>Halt Task</button>
          }
          title="Confirm Halt"
          description="This action is irreversible."
          onConfirm={vi.fn()}
        />
      );
      expect(
        screen.getByTestId(locators.confirmDialog.trigger)
      ).toBeInTheDocument();
    });

    it("dialog content is not in the DOM before the trigger is clicked", () => {
      render(
        <ConfirmActionDialog
          trigger={
            <button data-testid={locators.confirmDialog.trigger}>Halt Task</button>
          }
          title="Confirm Halt"
          description="This action is irreversible."
          onConfirm={vi.fn()}
        />
      );
      expect(
        screen.queryByTestId(locators.confirmDialog.content)
      ).not.toBeInTheDocument();
    });
  });

  describe("dialog opens on trigger click", () => {
    it("dialog content is visible after the trigger is clicked", async () => {
      const user = userEvent.setup();
      render(
        <ConfirmActionDialog
          trigger={
            <button data-testid={locators.confirmDialog.trigger}>Halt Task</button>
          }
          title="Confirm Halt"
          description="This action is irreversible."
          onConfirm={vi.fn()}
        />
      );
      await user.click(screen.getByTestId(locators.confirmDialog.trigger));
      expect(
        screen.getByTestId(locators.confirmDialog.content)
      ).toBeInTheDocument();
    });

    it("renders the confirm button in the open dialog", async () => {
      const user = userEvent.setup();
      render(
        <ConfirmActionDialog
          trigger={
            <button data-testid={locators.confirmDialog.trigger}>Halt Task</button>
          }
          title="Confirm Halt"
          description="This action is irreversible."
          onConfirm={vi.fn()}
        />
      );
      await user.click(screen.getByTestId(locators.confirmDialog.trigger));
      expect(
        screen.getByTestId(locators.confirmDialog.confirm)
      ).toBeInTheDocument();
    });

    it("renders the cancel button in the open dialog", async () => {
      const user = userEvent.setup();
      render(
        <ConfirmActionDialog
          trigger={
            <button data-testid={locators.confirmDialog.trigger}>Halt Task</button>
          }
          title="Confirm Halt"
          description="This action is irreversible."
          onConfirm={vi.fn()}
        />
      );
      await user.click(screen.getByTestId(locators.confirmDialog.trigger));
      expect(
        screen.getByTestId(locators.confirmDialog.cancel)
      ).toBeInTheDocument();
    });
  });

  describe("confirm / cancel behavior", () => {
    it("calls onConfirm exactly once when the confirm button is clicked", async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      render(
        <ConfirmActionDialog
          trigger={
            <button data-testid={locators.confirmDialog.trigger}>Halt Task</button>
          }
          title="Confirm Halt"
          description="This action is irreversible."
          onConfirm={onConfirm}
        />
      );
      await user.click(screen.getByTestId(locators.confirmDialog.trigger));
      await user.click(screen.getByTestId(locators.confirmDialog.confirm));
      expect(onConfirm).toHaveBeenCalledOnce();
    });

    it("does not call onConfirm when the cancel button is clicked", async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      render(
        <ConfirmActionDialog
          trigger={
            <button data-testid={locators.confirmDialog.trigger}>Halt Task</button>
          }
          title="Confirm Halt"
          description="This action is irreversible."
          onConfirm={onConfirm}
        />
      );
      await user.click(screen.getByTestId(locators.confirmDialog.trigger));
      await user.click(screen.getByTestId(locators.confirmDialog.cancel));
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("optional required input — disables confirm until valid", () => {
    it("renders the required input field when requiresInput is set", async () => {
      const user = userEvent.setup();
      render(
        <ConfirmActionDialog
          trigger={
            <button data-testid={locators.confirmDialog.trigger}>Override</button>
          }
          title="Confirm Override"
          description="Enter a reason to proceed."
          onConfirm={vi.fn()}
          requiresInput={{ label: "Reason" }}
        />
      );
      await user.click(screen.getByTestId(locators.confirmDialog.trigger));
      expect(
        screen.getByTestId(locators.confirmDialog.input)
      ).toBeInTheDocument();
    });

    it("confirm button is disabled when the required input is empty", async () => {
      const user = userEvent.setup();
      render(
        <ConfirmActionDialog
          trigger={
            <button data-testid={locators.confirmDialog.trigger}>Override</button>
          }
          title="Confirm Override"
          description="Enter a reason to proceed."
          onConfirm={vi.fn()}
          requiresInput={{ label: "Reason" }}
        />
      );
      await user.click(screen.getByTestId(locators.confirmDialog.trigger));
      expect(
        screen.getByTestId(locators.confirmDialog.confirm)
      ).toBeDisabled();
    });

    it("confirm button is enabled after typing a non-empty value in the required input", async () => {
      const user = userEvent.setup();
      render(
        <ConfirmActionDialog
          trigger={
            <button data-testid={locators.confirmDialog.trigger}>Override</button>
          }
          title="Confirm Override"
          description="Enter a reason to proceed."
          onConfirm={vi.fn()}
          requiresInput={{ label: "Reason" }}
        />
      );
      await user.click(screen.getByTestId(locators.confirmDialog.trigger));
      await user.type(
        screen.getByTestId(locators.confirmDialog.input),
        "emergency override"
      );
      expect(
        screen.getByTestId(locators.confirmDialog.confirm)
      ).not.toBeDisabled();
    });

    it("confirm is not disabled when requiresInput is not set", async () => {
      const user = userEvent.setup();
      render(
        <ConfirmActionDialog
          trigger={
            <button data-testid={locators.confirmDialog.trigger}>Halt Task</button>
          }
          title="Confirm Halt"
          description="This action is irreversible."
          onConfirm={vi.fn()}
        />
      );
      await user.click(screen.getByTestId(locators.confirmDialog.trigger));
      expect(
        screen.getByTestId(locators.confirmDialog.confirm)
      ).not.toBeDisabled();
    });
  });
});

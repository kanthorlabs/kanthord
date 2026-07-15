/**
 * ConfirmActionDialog — DESIGN §7 destructive-confirm composite (Story 002 T2).
 *
 * Wraps AlertDialog for any destructive / irreversible verb (halt, override, …).
 * The trigger ReactNode is rendered via AlertDialogTrigger asChild so callers
 * supply their own styled button (and its locator testid).
 *
 * When requiresInput is set the confirm button is disabled until the user has
 * typed a non-empty value (DESIGN §7 typed-input disables confirm until valid).
 */
import { useState } from "react";
import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { locators } from "@/locators";

interface RequiresInput {
  label: string;
}

export interface ConfirmActionDialogProps {
  /** Caller-supplied trigger element; its data-testid is owned by the caller. */
  trigger: ReactNode;
  title: string;
  description: string;
  /**
   * Called when the user confirms. Receives the current input value (empty
   * string when requiresInput is not set). Callers that do not need the value
   * may accept zero parameters — TypeScript's callback compatibility allows it.
   */
  onConfirm: (inputValue: string) => void;
  /** When set, the confirm button is disabled until the input field is non-empty. */
  requiresInput?: RequiresInput;
}

export function ConfirmActionDialog({
  trigger,
  title,
  description,
  onConfirm,
  requiresInput,
}: ConfirmActionDialogProps) {
  const [inputValue, setInputValue] = useState("");

  const isConfirmDisabled =
    requiresInput !== undefined && inputValue.trim() === "";

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent data-testid={locators.confirmDialog.content}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {requiresInput !== undefined && (
          <div className="grid gap-2">
            <Label htmlFor="confirm-action-input">{requiresInput.label}</Label>
            <Input
              id="confirm-action-input"
              data-testid={locators.confirmDialog.input}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel data-testid={locators.confirmDialog.cancel}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid={locators.confirmDialog.confirm}
            disabled={isConfirmDisabled}
            onClick={() => onConfirm(inputValue)}
          >
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

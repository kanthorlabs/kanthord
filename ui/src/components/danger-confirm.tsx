import type { ReactElement, ReactNode } from "react";

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

export interface DangerConfirmProps {
  /** The control that opens the dialog — the only thing rendered at rest. */
  readonly trigger: ReactNode;
  readonly title: string;
  readonly description: string;
  /** Label of the destructive confirm action, e.g. "Remove dependency". */
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
}

export function DangerConfirm({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
}: DangerConfirmProps): ReactElement {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild data-testid="danger-confirm-trigger">
        {trigger}
      </AlertDialogTrigger>
      <AlertDialogContent data-testid="danger-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="danger-confirm-cancel">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            data-testid="danger-confirm-accept"
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

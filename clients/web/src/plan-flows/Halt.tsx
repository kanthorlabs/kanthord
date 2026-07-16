/**
 * Halt — halt-task flow (Story 002 T2).
 *
 * Halt is a destructive verb → always uses ConfirmActionDialog (DESIGN §7).
 * The trigger is locators.planFlows.halt.trigger; the confirm/cancel buttons
 * use the shared locators.confirmDialog.{confirm,cancel}.
 *
 * On success: renders parked status + acting user inline.
 * On Code.AlreadyExists conflict: renders the typed conflict inline (not a
 * generic error toast) per the Epic 026 gate contract.
 */
import { useState } from "react";
import { ConnectError, Code } from "@connectrpc/connect";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { locators } from "@/locators";

interface HaltProps {
  taskId: string;
  actor: string;
  onSuccess?: () => void | Promise<void>;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; status: string }
  | { kind: "conflict"; message: string };

export function Halt({ taskId, actor, onSuccess }: HaltProps) {
  const client = useDaemonClient();
  const [state, setState] = useState<State>({ kind: "idle" });

  async function handleHalt() {
    setState({ kind: "loading" });
    try {
      const result = await client.haltTask({ taskId, actor });
      setState({ kind: "success", status: result.status });
      await onSuccess?.();
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.AlreadyExists) {
        setState({ kind: "conflict", message: err.message });
      } else {
        throw err;
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ConfirmActionDialog
        trigger={
          <Button
            variant="destructive"
            data-testid={locators.planFlows.halt.trigger}
          >
            Halt Task
          </Button>
        }
        title="Confirm Halt"
        description="This action is irreversible and will park the task immediately."
        onConfirm={handleHalt}
      />

      {state.kind === "success" && (
        <div
          data-testid={locators.planFlows.halt.result}
          className="flex flex-col gap-1"
        >
          <Alert>
            <AlertDescription>
              <span className="font-medium">{state.status}</span>
              {" — halted by "}
              <span className="font-mono">{actor}</span>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {state.kind === "conflict" && (
        <div
          data-testid={locators.planFlows.halt.conflict}
          className="text-sm text-destructive"
        >
          {state.message}
        </div>
      )}
    </div>
  );
}

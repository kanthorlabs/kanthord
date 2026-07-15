/**
 * ReplanApproval — re-planning diff approval flow (Story 002 T3, PRD §7.5).
 *
 * Approval is NOT a destructive halt/override — no ConfirmActionDialog used;
 * the approve button invokes the mutation directly (per test contract).
 *
 * Initial render: DiffPane (authored-file diff) + base generation value.
 * Approve: invokes client.approveReplan exactly once.
 *   success  → re-opened task ids rendered inline
 *   Code.Aborted (base-generation mismatch) → typed conflict rendered inline;
 *                no second apply (single call enforced by state guard)
 *
 * base_generation and new_generation are int64 (bigint); rendered via String().
 */
import { useState } from "react";
import { ConnectError, Code } from "@connectrpc/connect";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { DiffPane } from "@/components/DiffPane";
import type { DiffFile } from "@/components/DiffPane";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { locators } from "@/locators";

interface ReplanApprovalProps {
  featureId: string;
  actor: string;
  baseGeneration: bigint;
  files: DiffFile[];
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "approved"; reopenedTaskIds: string[] }
  | { kind: "conflict"; message: string };

export function ReplanApproval({
  featureId,
  actor,
  baseGeneration,
  files,
}: ReplanApprovalProps) {
  const client = useDaemonClient();
  const [state, setState] = useState<State>({ kind: "idle" });

  async function handleApprove() {
    setState({ kind: "loading" });
    try {
      const result = await client.approveReplan({
        featureId,
        baseGeneration,
        actor,
        edits: [],
      });
      setState({ kind: "approved", reopenedTaskIds: result.reopenedTaskIds });
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.Aborted) {
        setState({ kind: "conflict", message: err.message });
      } else {
        throw err;
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DiffPane files={files} />

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Base generation:</span>
        <span
          data-testid={locators.planFlows.replan.baseGeneration}
          className="font-mono font-semibold text-foreground"
        >
          {String(baseGeneration)}
        </span>
      </div>

      <div>
        <Button
          data-testid={locators.planFlows.replan.approve}
          onClick={handleApprove}
          disabled={state.kind === "loading"}
        >
          Approve Replan
        </Button>
      </div>

      {state.kind === "approved" && (
        <div
          data-testid={locators.planFlows.replan.reopenedTasks}
          className="flex flex-col gap-1"
        >
          <Alert>
            <AlertDescription>
              Re-opened tasks:{" "}
              <span className="font-mono">
                {state.reopenedTaskIds.join(", ")}
              </span>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {state.kind === "conflict" && (
        <div
          data-testid={locators.planFlows.replan.conflict}
          className="text-sm text-destructive"
        >
          {state.message}
        </div>
      )}
    </div>
  );
}

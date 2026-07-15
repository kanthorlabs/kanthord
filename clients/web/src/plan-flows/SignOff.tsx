/**
 * SignOff — plan sign-off flow (Story 002 T1).
 *
 * Invokes client.signOffPlan exactly once per click.
 *   valid=true  → compile result area + stamped generation (bigint → String)
 *   valid=false → each diagnostic rendered verbatim (Epic 026 contract —
 *                 the UI adds no rewording)
 *
 * The generation field is int64 (bigint) on the wire; rendered via String().
 */
import { useState } from "react";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { locators } from "@/locators";

interface SignOffProps {
  featureId: string;
  actor: string;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "valid"; generation: bigint }
  | { kind: "invalid"; diagnostics: string[] };

export function SignOff({ featureId, actor }: SignOffProps) {
  const client = useDaemonClient();
  const [state, setState] = useState<State>({ kind: "idle" });

  async function handleSignOff() {
    setState({ kind: "loading" });
    const result = await client.signOffPlan({ featureId, actor });
    if (result.valid) {
      setState({ kind: "valid", generation: result.generation });
    } else {
      setState({ kind: "invalid", diagnostics: result.diagnostics });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button
          data-testid={locators.planFlows.signOff.trigger}
          onClick={handleSignOff}
          disabled={state.kind === "loading"}
        >
          Sign Off Plan
        </Button>
      </div>

      {state.kind === "valid" && (
        <div data-testid={locators.planFlows.signOff.result} className="flex flex-col gap-1">
          <Alert>
            <AlertDescription>
              Plan signed off. Generation:{" "}
              <span
                data-testid={locators.planFlows.signOff.generation}
                className="font-mono font-semibold"
              >
                {String(state.generation)}
              </span>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {state.kind === "invalid" && (
        <ul className="flex flex-col gap-1">
          {state.diagnostics.map((d, i) => (
            <li
              key={i}
              data-testid={locators.planFlows.signOff.diagnostic}
              className="text-sm text-destructive"
            >
              {d}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

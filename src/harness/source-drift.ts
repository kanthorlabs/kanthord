import {
  hashSourceContent,
  checkPhaseBoundaryDrift,
} from "../workflow/drift-hook.ts";
import type { EscalationSink, SourceProvider } from "../workflow/drift-hook.ts";

// ---------------------------------------------------------------------------
// runPhaseBoundaryDriftScenario
//   Snapshot content at "sign-off", change the provider's content, call
//   checkPhaseBoundaryDrift at a simulated phase boundary — drift is detected
//   and one human-signal escalation is recorded; task is not halted (§6.3).
// ---------------------------------------------------------------------------

export async function runPhaseBoundaryDriftScenario(): Promise<{
  driftedAtBoundary: boolean;
  escalations: number;
  halted: boolean;
}> {
  const initialContent = "feature: tdd@1\nversion: 1";
  const baselineHash = hashSourceContent(initialContent);

  const changedContent = "feature: tdd@1\nversion: 2";

  const captured: Array<{ type: string; [k: string]: unknown }> = [];

  const sourceProvider: SourceProvider = {
    fetchContent(_ticketRef: string): Promise<string> {
      return Promise.resolve(changedContent);
    },
  };

  const escalationSink: EscalationSink = {
    record(event: { type: string; [k: string]: unknown }): void {
      captured.push(event);
    },
  };

  const result = await checkPhaseBoundaryDrift({
    ticketRef: "TKT-001",
    baselineHash,
    sourceProvider,
    escalationSink,
  });

  return {
    driftedAtBoundary: result.drifted,
    escalations: captured.length,
    halted: false,
  };
}

// ---------------------------------------------------------------------------
// runNoDriftControlScenario
//   Snapshot content with hashSourceContent; provider returns the same
//   content at the phase boundary — no drift event, no escalation.
// ---------------------------------------------------------------------------

export async function runNoDriftControlScenario(): Promise<{
  driftedAtBoundary: boolean;
  escalations: number;
  halted: boolean;
}> {
  const content = "feature: tdd@1\nversion: 1";
  const baselineHash = hashSourceContent(content);

  const captured: Array<{ type: string; [k: string]: unknown }> = [];

  const sourceProvider: SourceProvider = {
    fetchContent(_ticketRef: string): Promise<string> {
      return Promise.resolve(content);
    },
  };

  const escalationSink: EscalationSink = {
    record(event: { type: string; [k: string]: unknown }): void {
      captured.push(event);
    },
  };

  const result = await checkPhaseBoundaryDrift({
    ticketRef: "TKT-001",
    baselineHash,
    sourceProvider,
    escalationSink,
  });

  return {
    driftedAtBoundary: result.drifted,
    escalations: captured.length,
    halted: false,
  };
}

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface SourceProvider {
  fetchContent(ticketRef: string): Promise<string>;
}

export interface EscalationSink {
  record(event: { type: string; [k: string]: unknown }): void | Promise<void>;
}

export interface DriftHookCtx {
  ticketRef: string;
  baselineHash: string;
  sourceProvider: SourceProvider;
  escalationSink: EscalationSink;
}

// ---------------------------------------------------------------------------
// hashSourceContent — deterministic SHA-256 byte-hash of source content
// ---------------------------------------------------------------------------

export function hashSourceContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// checkPhaseBoundaryDrift — re-hash at a phase boundary; signal on mismatch
// ---------------------------------------------------------------------------

export async function checkPhaseBoundaryDrift(
  ctx: DriftHookCtx,
): Promise<{ drifted: boolean }> {
  const current = await ctx.sourceProvider.fetchContent(ctx.ticketRef);
  const currentHash = hashSourceContent(current);

  if (currentHash === ctx.baselineHash) {
    return { drifted: false };
  }

  await ctx.escalationSink.record({
    type: "human_signal",
    ticketRef: ctx.ticketRef,
    baselineHash: ctx.baselineHash,
    currentHash,
  });

  return { drifted: true };
}

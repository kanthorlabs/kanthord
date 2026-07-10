export type GateOutcome = "pass" | "fail" | "needs_human";

export type GateResult = {
  outcome: GateOutcome;
  summary?: string;
};

export interface GateResultSink {
  record(phase: string, result: GateResult): void | Promise<void>;
}

export interface Workflow {
  readonly version: string;
  readonly phases: readonly string[];
  currentPhase(): string;
  gateCheck(phase: string): Promise<GateResult>;
  checkpoint(): Promise<void>;
  on(
    event:
      | "phase_started"
      | "phase_changed"
      | "gate_checked"
      | "checkpoint_written",
    listener: (...args: any[]) => void,
  ): this;
}

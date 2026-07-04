export type GateOutcome = "pass" | "fail" | "needs_human";

export interface GateResultSink {
  record(phase: string, outcome: GateOutcome): void | Promise<void>;
}

export interface Workflow {
  readonly version: string;
  readonly phases: readonly string[];
  currentPhase(): string;
  gateCheck(phase: string): Promise<GateOutcome>;
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

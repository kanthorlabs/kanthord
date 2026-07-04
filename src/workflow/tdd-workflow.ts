import { EventEmitter } from "node:events";
import type { GateOutcome, GateResultSink, Workflow } from "./workflow.ts";
import type { FeatureStore } from "../store/feature-store.ts";

const TDD_PHASES: readonly string[] = ["failing_test_exists", "tests_pass"];

interface CheckpointCtx {
  store: FeatureStore;
  storyId: string;
  taskStem: string;
}

export class TddWorkflow extends EventEmitter implements Workflow {
  readonly version: string = "tdd@1";
  readonly phases: readonly string[] = TDD_PHASES;

  private readonly script: Partial<Record<string, GateOutcome>>;
  private readonly sink: GateResultSink;
  private readonly ctx: CheckpointCtx | undefined;
  private phaseIndex: number = 0;

  constructor(
    script: Partial<Record<string, GateOutcome>>,
    sink: GateResultSink,
    ctx?: CheckpointCtx,
  ) {
    super();
    this.script = script;
    this.sink = sink;
    this.ctx = ctx;
  }

  currentPhase(): string {
    const phase = this.phases[this.phaseIndex];
    if (phase === undefined) throw new Error("phase index out of bounds");
    return phase;
  }

  async gateCheck(phase: string): Promise<GateOutcome> {
    const outcome: GateOutcome = this.script[phase] ?? "fail";
    // Record to sink first — if it throws, no events emitted, currentPhase() NOT advanced
    await this.sink.record(phase, outcome);
    // Emit gate_checked after successful sink write
    this.emit("gate_checked", { phase, outcome });
    // Advance only on pass and only while a next phase exists
    if (outcome === "pass") {
      const nextIndex = this.phaseIndex + 1;
      if (nextIndex < this.phases.length) {
        this.phaseIndex = nextIndex;
        this.emit("phase_changed");
        const nextPhase = this.phases[this.phaseIndex];
        if (nextPhase !== undefined) {
          this.emit("phase_started", { phase: nextPhase });
        }
      }
    }
    return outcome;
  }

  async checkpoint(): Promise<void> {
    if (this.ctx === undefined) return;
    const { store, storyId, taskStem } = this.ctx;
    const currentPhase = this.currentPhase();
    const content = `# STATE\n\ncurrent_phase: ${currentPhase}\n`;
    await store.writeState(storyId, taskStem, content);
    await store.appendJournal(storyId, taskStem, {
      event: "checkpoint_written",
      phase: currentPhase,
      ts: new Date().toISOString(),
    });
    this.emit("checkpoint_written");
  }
}

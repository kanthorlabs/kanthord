/**
 * Story 04 T2 — FakeSessionFactory
 *
 * Hermetic StreamFn for unit-testing code that drives the real pi Agent loop.
 * Scripted turns become fauxAssistantMessage responses served by createFauxCore;
 * no network, no real timers (scheduleChunk uses queueMicrotask when tokensPerSecond
 * is unset).
 */
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type FakeTurn = {
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  text?: string;
};

export class FakeSessionFactory {
  private readonly _streamFn: StreamFn;

  constructor(turns: FakeTurn[]) {
    const core = createFauxCore({});

    const responses = turns.map((turn) => {
      if (turn.toolCalls && turn.toolCalls.length > 0) {
        return fauxAssistantMessage(
          turn.toolCalls.map((tc) => fauxToolCall(tc.name, tc.arguments)),
          { stopReason: "toolUse" },
        );
      }
      return fauxAssistantMessage(turn.text ?? "", { stopReason: "stop" });
    });

    core.setResponses(responses);

    // createFauxCore returns streamSimple typed as StreamFunction<string, SimpleStreamOptions>.
    // StreamFn from pi-agent-core is (model: Model<Api>, ...) => AssistantMessageEventStream.
    // The cast is safe: the faux core ignores the model parameter at runtime.
    this._streamFn = core.streamSimple as unknown as StreamFn;
  }

  get streamFn(): StreamFn {
    return this._streamFn;
  }
}

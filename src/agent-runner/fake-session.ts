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
import type {
  ProviderSession,
  ProviderSessionFactory,
  SessionContext,
} from "./pi-session.ts";
import type { ResolvedProvider } from "./port.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type FakeTurn = {
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  text?: string;
};

/**
 * Keyed form of scripted turns: task title → that task's turns. Since the fake
 * session factory serves the same turns to every `.for()` call, tasks that must
 * make *different* workspace edits (e.g. the deterministic transplant Proof's
 * non-overlapping vs overlapping siblings) key their turns by exact task title.
 * The `"*"` key is the default served to any task with no exact-title entry.
 */
export type FakeTurnMap = Record<string, FakeTurn[]>;

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

/**
 * Adapt scripted turns into the `ProviderSessionFactory` port so the real
 * composition root can run the pi Agent loop with no model / no network. Each
 * `.for()` call yields a fresh faux session serving the scripted turns; the
 * `aiProvider`/`credential` arguments are ignored (they only satisfy the
 * runner's context-binding check). Used by the `KANTHORD_FAKE_AGENT` e2e seam.
 *
 * `turns` may be either a plain `FakeTurn[]` (served identically to every task —
 * the original behaviour) or a `FakeTurnMap` keyed by task title. In the keyed
 * form, `.for()` selects the entry matching `context.taskTitle`, falling back to
 * the `"*"` default (or an empty script if neither is present).
 */
export function fakeSessionFactoryFromTurns(
  turns: FakeTurn[] | FakeTurnMap,
): ProviderSessionFactory {
  const selectTurns = (context?: SessionContext): FakeTurn[] => {
    if (Array.isArray(turns)) return turns;
    const byTitle =
      context?.taskTitle !== undefined ? turns[context.taskTitle] : undefined;
    return byTitle ?? turns["*"] ?? [];
  };
  return {
    async for(
      _provider: ResolvedProvider,
      _ctx?: SessionContext,
    ): Promise<ProviderSession> {
      const fake = new FakeSessionFactory(selectTurns(_ctx));
      return {
        model: {} as ProviderSession["model"],
        streamFn: fake.streamFn as unknown as ProviderSession["streamFn"],
        getApiKey: () => "fake-key",
      };
    },
  };
}

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
import {
  CredentialError,
  type ProviderSession,
  type ProviderSessionFactory,
  type SessionContext,
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

/**
 * EPIC 008.4 — Fake-seam options. `failProviders` lists the provider `name`
 * (or `provider` field) values whose `.for()` call must reject with a typed
 * provider error, so the runner classifies the failure as a `providerError`
 * and the failover loop advances to the next provider in the chain.
 */
export type FakeSessionFactoryOpts = {
  failProviders?: string[];
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
 *
 * EPIC 008.4 — `opts.failProviders` (read from the hermetic
 * `KANTHORD_FAKE_FAIL_PROVIDERS` env var in `main.ts`) makes `.for()` reject
 * with a typed `CredentialError` when the resolved provider's `name` or
 * `provider` field is listed. The runner classifies the rejection as
 * `providerError: true, reasonCode: 'auth'` and the failover loop advances.
 */
export function fakeSessionFactoryFromTurns(
  turns: FakeTurn[] | FakeTurnMap,
  opts?: FakeSessionFactoryOpts,
): ProviderSessionFactory {
  const failList = opts?.failProviders ?? [];
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
      if (failList.length > 0) {
        if (
          failList.includes(_provider.name) ||
          failList.includes(_provider.provider)
        ) {
          // Typed provider error: the runner's `classifySessionError` arm for
          // `CredentialError` produces reasonCode='auth'. The error message is
          // redacted at the seam (pi.ts) before reaching the result.
          throw new CredentialError(
            _provider.name,
            _provider.provider,
            `fake-session: provider '${_provider.name}' is in failProviders`,
          );
        }
      }
      const fake = new FakeSessionFactory(selectTurns(_ctx));
      return {
        model: {} as ProviderSession["model"],
        streamFn: fake.streamFn as unknown as ProviderSession["streamFn"],
        getApiKey: () => "fake-key",
      };
    },
  };
}

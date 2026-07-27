/**
 * Story 04 T1 — PiProviderSessionFactory
 *
 * Adapter-internal factory that converts an AIProvider + Credential resource
 * pair into a pi-ai session (model, streamFn, getApiKey, optional
 * credentialStore). All pi types are confined to this file — they never enter
 * port.ts (per D2 debate ruling).
 */
import type {
  Api,
  Model,
  StreamFunction,
  SimpleStreamOptions,
  CredentialStore as PiCredentialStore,
  Credential as PiCredential,
  OAuthCredential as PiOAuthCredential,
} from "@earendil-works/pi-ai";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { ReasoningEffort } from "../domain/resource.ts";
import {
  CUSTOM_PROVIDER_DEFAULT_CONTEXT_WINDOW,
  CUSTOM_PROVIDER_DEFAULT_MAX_TOKENS,
} from "../domain/resource.ts";
import type { ResolvedProvider } from "./port.ts";

import type { AiProviderRegistry } from "../storage/port.ts";
import type { Logger } from "../logger/port.ts";
import { NullLogger } from "../logger/null.ts";

// ---------------------------------------------------------------------------
// Public session type
// ---------------------------------------------------------------------------

export type ProviderSession = {
  model: Model<Api>;
  streamFn: StreamFunction;
  getApiKey: () => string;
  credentialStore?: PiCredentialStore;
};

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

/**
 * Optional per-task context passed to `for()`. The real adapter ignores it; the
 * `KANTHORD_FAKE_AGENT` seam uses `taskTitle` to select per-task scripted turns
 * (see fake-session.ts), which the deterministic transplant Proof relies on.
 */
export type SessionContext = { taskTitle?: string };

export interface ProviderSessionFactory {
  for(
    provider: ResolvedProvider,
    context?: SessionContext,
    expectedCredentialVersion?: number,
  ): Promise<ProviderSession>;
}

// ---------------------------------------------------------------------------
// Named errors
// ---------------------------------------------------------------------------

export class CredentialError extends Error {
  readonly resourceName: string;
  readonly provider: string;

  constructor(resourceName: string, provider: string, message: string) {
    super(message);
    this.name = "CredentialError";
    this.resourceName = resourceName;
    this.provider = provider;
  }
}

export class UnknownModelError extends Error {
  readonly provider: string;
  readonly model: string;

  constructor(provider: string, model: string) {
    super(`Unknown model '${model}' for provider '${provider}'`);
    this.name = "UnknownModelError";
    this.provider = provider;
    this.model = model;
  }
}

/**
 * A record with its own `baseUrl` whose provider id is unknown to pi's builtin
 * catalog and whose `api` flavor is absent. It cannot be a builtin with an
 * overridden URL, so it is a custom OpenAI-compatible provider missing `api`.
 * The custom branch below keys off `api`, so without it the session falls
 * through to the builtin catalog and dies with `UnknownModelError`, blaming the
 * model name for a missing field. Fail at the field instead.
 */
export class IncompleteCustomProviderError extends Error {
  readonly provider: string;
  readonly field: string;

  constructor(provider: string, field: string) {
    super(
      `Provider '${provider}' has baseUrl set but '${field}' is missing — a custom OpenAI-compatible provider must carry '${field}'`,
    );
    this.name = "IncompleteCustomProviderError";
    this.provider = provider;
    this.field = field;
  }
}

export class UnsupportedApiError extends Error {
  readonly api: string;

  constructor(api: string) {
    super(
      `Unsupported API flavor '${api}' — expected 'openai-completions' or 'openai-responses'`,
    );
    this.name = "UnsupportedApiError";
    this.api = api;
  }
}

// ---------------------------------------------------------------------------
// Reasoning-effort injection
// ---------------------------------------------------------------------------

/**
 * Wrap a StreamFunction so every call carries the configured reasoning effort.
 * pi maps the level onto the model via SimpleStreamOptions.reasoning. When no
 * effort is set, the base function is returned unchanged.
 */
export function withReasoning(
  base: StreamFunction,
  effort: ReasoningEffort | undefined,
): StreamFunction {
  if (!effort) return base;
  return (model, context, options) =>
    base(model, context, {
      ...options,
      reasoning: effort,
    } as SimpleStreamOptions);
}

// ---------------------------------------------------------------------------
// PiProviderSessionFactory
// ---------------------------------------------------------------------------

export class PiProviderSessionFactory implements ProviderSessionFactory {
  readonly #registry: AiProviderRegistry;
  readonly #logger: Logger;

  constructor(options: { registry: AiProviderRegistry; logger?: Logger }) {
    this.#registry = options.registry;
    this.#logger = options.logger ?? new NullLogger();
  }

  async for(
    provider: ResolvedProvider,
    _context?: SessionContext,
    expectedCredentialVersion?: number,
  ): Promise<ProviderSession> {
    // _context (per-task selection) is a fake-seam concern; the real adapter
    // builds one session per provider and ignores it.
    // (d) empty value
    if (!provider.value) {
      throw new CredentialError(
        provider.name,
        provider.provider,
        `Credential '${provider.name}' has empty value`,
      );
    }

    // Discriminate credential kind by attempting JSON parse
    let parsedOAuth: PiOAuthCredential | undefined;
    try {
      const raw = JSON.parse(provider.value) as { type?: unknown };
      if (raw && raw.type === "oauth") {
        parsedOAuth = raw as PiOAuthCredential;
      }
    } catch {
      // not JSON → API key path
    }

    let getApiKey: () => string;
    let credentialStore: PiCredentialStore | undefined;

    if (parsedOAuth) {
      // (b) OAuth path.
      // Hand pi the credential store instead of a static token so pi's own
      // getAuth() runs OAuth refresh under a lock and persists the rotated
      // token (auth/resolve.ts). `current` is a mutable latest-known copy so
      // reads within a session see the refreshed value (avoids re-refreshing
      // with a rotated-away refresh token).
      let current: PiOAuthCredential = parsedOAuth;
      const credId = provider.id;
      const registry = this.#registry;
      const logger = this.#logger;
      let expectedVersion: number | undefined = expectedCredentialVersion;

      // Return "" (no override): a non-empty apiKey would make pi treat the
      // request as api-key auth and skip OAuth refresh (auth/resolve.ts:17).
      getApiKey = () => "";

      credentialStore = {
        read: async (_providerId: string): Promise<PiCredential | undefined> =>
          current,
        modify: async (
          _providerId: string,
          fn: (
            current: PiCredential | undefined,
          ) => Promise<PiCredential | undefined>,
        ): Promise<PiCredential | undefined> => {
          const result = await fn(current);
          if (result !== undefined) {
            current = result as PiOAuthCredential;
            if (expectedVersion !== undefined) {
              // The write-back must never throw into the agent loop (Story G):
              // a failed CAS is a silent no-op for the in-flight attempt.
              try {
                const cas = registry.updateCredentialCAS(
                  credId,
                  JSON.stringify(result),
                  expectedVersion,
                );
                if (cas.applied) {
                  expectedVersion = cas.newVersion;
                }
              } catch (err) {
                logger.error(
                  `credential CAS write-back for ${credId} failed: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                );
              }
            }
          }
          // Per pi's CredentialStore contract: return the latest credential.
          // When fn makes no change (returns undefined — e.g. another request
          // already refreshed) pi still expects the current value, not undefined.
          return current;
        },
        delete: async (_providerId: string): Promise<void> => {
          // Unreachable: pi never calls delete on the store. kanthord's
          // `logout ai-provider` goes through the registry (008.1), and 008.3's
          // CAS write-back above is what keeps it from being undone.
        },
      };
    } else {
      // (a) API key path
      const apiKey = provider.value;
      getApiKey = () => apiKey;
    }

    // ── Custom provider branch (api != null) ──
    // When the provider has api set, it is a custom OpenAI-compatible
    // provider that is not in pi's builtin catalog. Build a session-local
    // model catalog via createModels + createProvider instead.
    if (provider.api != null) {
      const runtimeId = "custom:" + provider.id;
      const contextWindow =
        provider.contextWindow ?? CUSTOM_PROVIDER_DEFAULT_CONTEXT_WINDOW;
      const maxTokens =
        provider.maxTokens ?? CUSTOM_PROVIDER_DEFAULT_MAX_TOKENS;

      // Build a pi Model from the custom record data + documented defaults
      const model: Model<Api> = {
        id: provider.model,
        name: provider.model,
        api: provider.api as Api,
        provider: runtimeId,
        baseUrl: provider.baseUrl ?? "",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens,
      };

      // Session-local models — no builtin catalog
      const models = createModels(
        credentialStore ? { credentials: credentialStore } : undefined,
      );

      const streams =
        provider.api === "openai-completions"
          ? openAICompletionsApi()
          : provider.api === "openai-responses"
            ? openAIResponsesApi()
            : (() => {
                throw new UnsupportedApiError(provider.api ?? "");
              })();

      models.setProvider(
        createProvider({
          id: runtimeId,
          name: provider.name,
          baseUrl: provider.baseUrl,
          auth: {
            apiKey: {
              name: "Custom OpenAI-compatible API key",
              resolve: async () => {
                const key = getApiKey();
                if (key) return { auth: { apiKey: key } };
                return undefined;
              },
            },
          },
          models: [model],
          api: streams,
        }),
      );

      const found = models.getModel(runtimeId, provider.model);
      if (!found) {
        throw new UnknownModelError(runtimeId, provider.model);
      }

      const baseStream = models.streamSimple.bind(models) as StreamFunction;
      const streamFn = withReasoning(baseStream, provider.effort);

      return { model: found, streamFn, getApiKey, credentialStore };
    }

    // Build the model catalog. For OAuth, pass the credential store so
    // streamSimple resolves auth (with refresh) through it.
    const models = builtinModels(
      credentialStore ? { credentials: credentialStore } : undefined,
    );
    const found = models.getModel(provider.provider, provider.model);
    if (!found) {
      // A record with its own baseUrl whose provider id is not in the builtin
      // catalog is not a builtin with an overridden URL — it is a custom
      // OpenAI-compatible provider that reached here with `api` missing. Blame
      // the absent field, not the model name.
      if (
        provider.baseUrl != null &&
        provider.baseUrl !== "" &&
        models.getProvider(provider.provider) === undefined
      ) {
        throw new IncompleteCustomProviderError(provider.provider, "api");
      }
      throw new UnknownModelError(provider.provider, provider.model);
    }

    // (f) baseUrl override: spread a new model object with the custom URL
    const model: Model<Api> = provider.baseUrl
      ? { ...found, baseUrl: provider.baseUrl }
      : found;

    const baseStream = models.streamSimple.bind(models) as StreamFunction;
    const streamFn = withReasoning(baseStream, provider.effort);

    return { model, streamFn, getApiKey, credentialStore };
  }
}

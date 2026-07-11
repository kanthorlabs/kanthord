/**
 * src/agent/provider-session.ts
 *
 * Resolves a ProviderAccount + modelId into a {model, streamFn} pair ready
 * for the Agent spawn seam. Implements the pi-ai "Models-backed streamFn"
 * pattern (no getApiKey on the Agent — spike: copilot-provider-wiring).
 *
 * Exports:
 *   ProviderSession        — { model: Model<Api>; streamFn: StreamFunction }
 *   buildProviderSession   — async factory
 */

import type {
  Api,
  ApiKeyAuth,
  AuthResult,
  Model,
  Provider,
  ProviderStreams,
  StreamFunction,
} from "@earendil-works/pi-ai";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import type { ProviderAccountRegistry } from "./provider-account-registry.ts";
import type { ProviderCredentialStore } from "./provider-credential-store.ts";
import type { OpenAICompatibleConfigStore } from "./openai-compatible.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A resolved provider session — model + streamFn for the Agent spawn seam. */
export interface ProviderSession {
  model: Model<Api>;
  streamFn: StreamFunction;
  /** Resolve request auth for a model via the pi-ai Models collection. */
  getAuth(model: Model<Api>): Promise<AuthResult | undefined>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the base provider factory for the given kind, typed as Provider<Api>
 * so the generic boundary is at this helper.
 */
function makeBaseProvider(kind: string): Provider<Api> {
  if (kind === "github-copilot") {
    return githubCopilotProvider() as unknown as Provider<Api>;
  }
  if (kind === "openai-codex") {
    return openaiCodexProvider() as unknown as Provider<Api>;
  }
  throw new Error(`unsupported provider kind: "${kind}"`);
}

// ---------------------------------------------------------------------------
// OpenAI-compatible helper
// ---------------------------------------------------------------------------

/**
 * Build a ProviderSession for an openai-compatible account. Loads endpoint
 * metadata from the config store, constructs a synthetic model, and registers
 * a custom provider backed by the openai streaming implementation.
 */
async function buildOpenAICompatibleSession(
  input: { accountId: string; modelId: string },
  deps: {
    registry: ProviderAccountRegistry;
    store: ProviderCredentialStore;
    openaiCompatibleConfigStore?: OpenAICompatibleConfigStore | undefined;
  },
): Promise<ProviderSession> {
  if (deps.openaiCompatibleConfigStore === undefined) {
    throw new Error(
      `openaiCompatibleConfigStore is required for openai-compatible accounts (account "${input.accountId}")`,
    );
  }
  const config = await deps.openaiCompatibleConfigStore.load(input.accountId);
  if (config === undefined) {
    throw new Error(`openai-compatible config not found for account "${input.accountId}"`);
  }
  if (!config.models.includes(input.modelId)) {
    throw new Error(`model not found: "${input.modelId}" in openai-compatible account "${input.accountId}"`);
  }

  // Require a stored api-key for openai-compatible accounts; reject early with
  // a clear error rather than silently building a session that will fail at
  // inference time.
  const credential = await deps.store.read(input.accountId);
  if (credential === undefined) {
    throw new Error(
      `no api key configured for openai-compatible account "${input.accountId}"; ` +
        `store an api-key credential before building a session`,
    );
  }

  // Build a synthetic model from the config. The api field is typed as Api
  // (which accepts any string) so the cast is safe.
  const model: Model<Api> = {
    id: input.modelId,
    name: input.modelId,
    api: config.api as Api,
    provider: input.accountId,
    baseUrl: config.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 0,
    maxTokens: 0,
  };

  // Build an account-scoped api-key auth with no ambient env fallback — only
  // the stored credential is consulted; process.env.OPENAI_API_KEY is ignored.
  const accountKeyAuth: ApiKeyAuth = {
    name: `${input.accountId} api key`,
    async resolve({ credential: c }) {
      if (c === undefined) return undefined;
      return { auth: { apiKey: c.key, baseUrl: config.baseUrl } };
    },
  };

  // Select the ProviderStreams implementation from config.api.
  const apiImpl: ProviderStreams =
    config.api === "openai-completions" ? openAICompletionsApi() : openAIResponsesApi();

  const customProvider = createProvider({
    id: input.accountId,
    name: `${input.accountId} (openai-compatible)`,
    baseUrl: config.baseUrl,
    auth: { apiKey: accountKeyAuth },
    models: [model],
    api: apiImpl,
  });

  const models = createModels({ credentials: deps.store });
  models.setProvider(customProvider);

  const streamFn: StreamFunction = (m, ctx, opts) => models.streamSimple(m, ctx, opts);

  return { model, streamFn, getAuth: (m) => models.getAuth(m) };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Resolve a ProviderAccount + modelId into a session for the Agent spawn seam.
 *
 * - Looks up the account in `registry` (throws with the id if not found).
 * - Finds the model in the base provider's catalog (throws with the id if not
 *   found).
 * - Registers a pi-ai provider instance under the canonical `providerKind` id.
 * - Returns `{ model, streamFn, getAuth }` where:
 *   - `model.provider === providerKind` (canonical pi-ai boundary id)
 *   - `streamFn` is backed by `Models.streamSimple` (no `getApiKey` path)
 *   - `getAuth(model)` delegates to `Models.getAuth` — enterprise Copilot base
 *     URL is derived at auth-resolution time by pi-ai's `toAuth()` (via
 *     `proxy-ep`), not by kanthord token parsing
 */
export async function buildProviderSession(
  input: { accountId: string; modelId: string },
  deps: {
    registry: ProviderAccountRegistry;
    store: ProviderCredentialStore;
    openaiCompatibleConfigStore?: OpenAICompatibleConfigStore | undefined;
  },
): Promise<ProviderSession> {
  // 1. Resolve the account — registry.get throws with the id if not found
  const account = await deps.registry.get(input.accountId);

  // 2a. Early branch for openai-compatible accounts (config-driven endpoint).
  if (account.providerKind === "openai-compatible") {
    return buildOpenAICompatibleSession(input, deps);
  }

  // 2. Get the kind-specific base provider (typed as Provider<Api>)
  const baseProvider = makeBaseProvider(account.providerKind);

  // 3. Find the requested model in the base provider's catalog
  const baseModel = baseProvider.getModels().find((m) => m.id === input.modelId);
  if (baseModel === undefined) {
    throw new Error(`model not found: "${input.modelId}"`);
  }

  // 4. Build a model with the canonical providerKind as the pi-ai provider boundary
  //    id. pi-ai hard-codes auth/header behavior on this field (e.g. github-copilot
  //    Bearer-auth and dynamic headers dispatch on provider === "github-copilot"),
  //    so it must equal the canonical kind string, not accountId. The enterprise
  //    base URL is derived at auth-resolution time by pi-ai's Copilot toAuth()
  //    (via proxy-ep) — kanthord no longer parses the token to compute it.
  const model: Model<Api> = { ...baseModel, provider: account.providerKind };

  // 7. Per-session credential adapter: remaps the canonical kind id to this
  //    account's stored credentialKey so pi-ai OAuth refresh persists to the
  //    correct per-account slot. Account isolation is preserved — each session
  //    gets its own adapter instance scoped to one account's credentialKey.
  const credKey = account.credentialKey;
  const kindId = account.providerKind;
  const adapter: ProviderCredentialStore = {
    read: (id) => id === kindId ? deps.store.read(credKey) : Promise.resolve(undefined),
    modify: (id, fn) =>
      id === kindId ? deps.store.modify(credKey, fn) : Promise.resolve(undefined),
    delete: (id) => id === kindId ? deps.store.delete(credKey) : Promise.resolve(),
  };

  // 8. Create a Models collection with the per-session adapter and register the
  //    real base provider (id = canonical kind) so pi-ai's per-kind auth and
  //    streaming dispatch fires correctly.
  const models = createModels({ credentials: adapter });
  models.setProvider(baseProvider);

  // 9. Build a Models.streamSimple-backed streamFn; no getApiKey involved
  const streamFn: StreamFunction = (m, ctx, opts) => models.streamSimple(m, ctx, opts);

  return { model, streamFn, getAuth: (m) => models.getAuth(m) };
}

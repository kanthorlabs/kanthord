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
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type {
  AIProvider,
  Credential,
  ReasoningEffort,
} from "../domain/resource.ts";

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

export interface ProviderSessionFactory {
  for(aiProvider: AIProvider, credential: Credential): Promise<ProviderSession>;
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
  readonly #saveCredentialValue: (credentialId: string, value: string) => void;

  constructor(options: {
    saveCredentialValue: (credentialId: string, value: string) => void;
  }) {
    this.#saveCredentialValue = options.saveCredentialValue;
  }

  async for(
    aiProvider: AIProvider,
    credential: Credential,
  ): Promise<ProviderSession> {
    // (d) empty value
    if (!credential.value) {
      throw new CredentialError(
        credential.name,
        credential.provider,
        `Credential '${credential.name}' has empty value`,
      );
    }

    // (c) provider mismatch — message must name both providers, not the secret
    if (credential.provider !== aiProvider.provider) {
      throw new CredentialError(
        credential.name,
        credential.provider,
        `Credential provider '${credential.provider}' does not match AIProvider provider '${aiProvider.provider}'`,
      );
    }

    // Discriminate credential kind by attempting JSON parse
    let parsedOAuth: PiOAuthCredential | undefined;
    try {
      const raw = JSON.parse(credential.value) as { type?: unknown };
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
      const credId = credential.id;
      const saveFn = this.#saveCredentialValue;

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
            saveFn(credId, JSON.stringify(result));
          }
          // Per pi's CredentialStore contract: return the latest credential.
          // When fn makes no change (returns undefined — e.g. another request
          // already refreshed) pi still expects the current value, not undefined.
          return current;
        },
        delete: async (_providerId: string): Promise<void> => {
          // no-op for now; logout path is a later story
        },
      };
    } else {
      // (a) API key path
      const apiKey = credential.value;
      getApiKey = () => apiKey;
    }

    // Build the model catalog. For OAuth, pass the credential store so
    // streamSimple resolves auth (with refresh) through it.
    const models = builtinModels(
      credentialStore ? { credentials: credentialStore } : undefined,
    );
    const found = models.getModel(aiProvider.provider, aiProvider.model);
    if (!found) {
      throw new UnknownModelError(aiProvider.provider, aiProvider.model);
    }

    // (f) baseUrl override: spread a new model object with the custom URL
    const model: Model<Api> = aiProvider.baseUrl
      ? { ...found, baseUrl: aiProvider.baseUrl }
      : found;

    const baseStream = models.streamSimple.bind(models) as StreamFunction;
    const streamFn = withReasoning(baseStream, aiProvider.effort);

    return { model, streamFn, getApiKey, credentialStore };
  }
}

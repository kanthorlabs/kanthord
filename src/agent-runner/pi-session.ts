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
  CredentialStore as PiCredentialStore,
  Credential as PiCredential,
  OAuthCredential as PiOAuthCredential,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { AIProvider, Credential } from "../domain/resource.ts";

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

    // Look up model in the built-in catalog
    const models = builtinModels();
    const found = models.getModel(aiProvider.provider, aiProvider.model);
    if (!found) {
      throw new UnknownModelError(aiProvider.provider, aiProvider.model);
    }

    // (f) baseUrl override: spread a new model object with the custom URL
    const model: Model<Api> = aiProvider.baseUrl
      ? { ...found, baseUrl: aiProvider.baseUrl }
      : found;

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
      // (b) OAuth path
      const oauthCred = parsedOAuth;
      const credId = credential.id;
      const saveFn = this.#saveCredentialValue;

      // OAuth access token is the API key for request auth
      getApiKey = () => oauthCred.access;

      // CredentialStore that persists refreshed tokens back through
      // saveCredentialValue (injected by the composition root / tests)
      credentialStore = {
        read: async (_providerId: string): Promise<PiCredential | undefined> =>
          oauthCred,
        modify: async (
          _providerId: string,
          fn: (
            current: PiCredential | undefined,
          ) => Promise<PiCredential | undefined>,
        ): Promise<PiCredential | undefined> => {
          const result = await fn(oauthCred);
          if (result !== undefined) {
            saveFn(credId, JSON.stringify(result));
          }
          return result;
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

    const streamFn = models.streamSimple.bind(models) as StreamFunction;

    return { model, streamFn, getApiKey, credentialStore };
  }
}

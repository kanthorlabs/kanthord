/**
 * pi-backed adapter for the OAuth login capability. All pi-ai OAuth types and
 * the vendor callback orchestration are confined here (per the hexagonal rule
 * that driving adapters must not carry vendor logic).
 */
import type {
  OAuthLoginCallbacks,
  OAuthProviderInterface,
} from "@earendil-works/pi-ai";
import { getOAuthProvider } from "@earendil-works/pi-ai/oauth";
import type { OAuthLoginProvider, OAuthLoginPresenter } from "./port.ts";
import { UnknownOAuthProviderError } from "./port.ts";

export class PiOAuthLoginProvider implements OAuthLoginProvider {
  readonly #getProvider: (id: string) => OAuthProviderInterface | undefined;

  constructor(options?: {
    getProvider?: (id: string) => OAuthProviderInterface | undefined;
  }) {
    this.#getProvider = options?.getProvider ?? getOAuthProvider;
  }

  has(providerId: string): boolean {
    return this.#getProvider(providerId) !== undefined;
  }

  async login(input: {
    providerId: string;
    method: string;
    presenter: OAuthLoginPresenter;
  }): Promise<string> {
    const provider = this.#getProvider(input.providerId);
    if (provider === undefined) {
      throw new UnknownOAuthProviderError(input.providerId);
    }

    const { presenter, method } = input;
    const callbacks: OAuthLoginCallbacks = {
      // Method selection (e.g. openai-codex browser vs device-code): honor the
      // caller's choice instead of cancelling.
      onSelect: async () => method,
      onAuth: (info) => presenter.showAuthUrl(info.url, info.instructions),
      onDeviceCode: (info) =>
        presenter.showDeviceCode({
          userCode: info.userCode,
          verificationUri: info.verificationUri,
        }),
      onProgress: (message) => presenter.progress(message),
      // Fallback only — reached when the local callback server did not capture
      // the code (onManualCodeInput is deliberately omitted so pi does not race
      // a stdin read against the callback server).
      onPrompt: (prompt) => presenter.promptCode(prompt.message),
    };

    const creds = await provider.login(callbacks);
    // Tag as an OAuth credential so PiProviderSessionFactory recognizes it —
    // raw provider creds are untagged and would be misread as an API key.
    // `type` last so a stray `creds.type` cannot clobber the tag.
    return JSON.stringify({ ...creds, type: "oauth" });
  }
}

/**
 * OAuth login capability — the port the core depends on to authenticate an AI
 * provider via OAuth. Owned by the core so any transport (CLI today, HTTP
 * later) can drive it; the concrete pi-backed adapter lives in `./pi.ts`.
 */

/**
 * Interactive presentation for an OAuth login flow, supplied by the driving
 * transport. The CLI prints to the terminal and reads stdin; an HTTP transport
 * would surface the URL to the browser and receive the code via a redirect.
 */
export interface OAuthLoginPresenter {
  /** Show the authorization URL the human must open. */
  showAuthUrl(url: string, instructions?: string): void;
  /** Show a device code + verification URL (headless / device-code flow). */
  showDeviceCode(info: { userCode: string; verificationUri: string }): void;
  /** Progress messages during the flow. */
  progress(message: string): void;
  /** Read a pasted code / redirect URL — fallback when the callback server
   * does not receive the code automatically. */
  promptCode(message: string): Promise<string>;
}

/**
 * Runs an OAuth login flow for a provider and returns the storage-ready,
 * serialized credential value (opaque tagged JSON the credential resource
 * persists verbatim).
 */
export interface OAuthLoginProvider {
  /** Whether an OAuth flow is registered for this provider id. */
  has(providerId: string): boolean;
  login(input: {
    providerId: string;
    method: string;
    presenter: OAuthLoginPresenter;
  }): Promise<string>;
}

export class UnknownOAuthProviderError extends Error {
  readonly providerId: string;
  constructor(providerId: string) {
    super(`no OAuth flow registered for provider ${providerId}`);
    this.name = "UnknownOAuthProviderError";
    this.providerId = providerId;
  }
}

/**
 * src/cli/login-deps.ts
 *
 * Production dependency factory for `kanthord login`.
 *
 * Binds the real pi-ai device-code login functions by identity and constructs
 * the account registry + credential store rooted at dataRoot. No network call
 * occurs at construction time.
 *
 * Exports:
 *   buildLoginDeps(opts) — factory returning a LoginCommandDeps
 */

import { loginOpenAICodexDeviceCode, loginGitHubCopilot } from "@earendil-works/pi-ai/oauth";
import type { LoginCommandDeps } from "./login.ts";
import { createProviderAccountRegistry } from "../agent/provider-account-registry.ts";
import { createProviderCredentialStore } from "../agent/provider-credential-store.ts";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build production LoginCommandDeps for `kanthord login`.
 *
 * - `loginFns["openai-codex"]` is the real `loginOpenAICodexDeviceCode` (identity).
 * - `loginFns["github-copilot"]` is the real `loginGitHubCopilot` (identity).
 * - `store` and `registry` are file-backed instances rooted at `dataRoot`.
 *
 * No IO or network calls occur at construction time.
 *
 * Note: the real pi-ai functions return `OAuthCredentials` while the seam type
 * expects `OAuthCredential` (which extends `OAuthCredentials` with `type:"oauth"`).
 * The cast below is safe: at runtime the return values carry `type:"oauth"` and
 * the referential identity required by the hermetic test is preserved.
 */
export function buildLoginDeps(opts: { dataRoot: string }): LoginCommandDeps {
  const store = createProviderCredentialStore({ dataRoot: opts.dataRoot });
  const registry = createProviderAccountRegistry({ dataRoot: opts.dataRoot, store });

  // Cast bridges the OAuthCredentials → OAuthCredential return-type gap while
  // preserving referential identity of the underlying function objects.
  const loginFns = {
    "openai-codex": loginOpenAICodexDeviceCode,
    "github-copilot": loginGitHubCopilot,
  } as unknown as LoginCommandDeps["loginFns"];

  return { registry, store, loginFns };
}

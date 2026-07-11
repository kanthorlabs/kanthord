/**
 * src/agent/login-operation.ts
 *
 * Observable device-code login operation.
 *
 * Drives a loginFn through its OAuthLoginCallbacks seam, tracking phase
 * transitions:
 *   pending → device-code (+ userCode, verificationUri)
 *           → complete (+ accountId) | failed
 *
 * On success: adds the account to registry and writes the credential to store.
 * On failure/cancel: no writes.
 *
 * result always resolves (never rejects) — terminal states are complete/failed.
 *
 * Exports:
 *   LoginOperationState        — discriminated union of phases
 *   LoginOperation             — { getState, result }
 *   StartLoginOperationOpts    — factory options
 *   startLoginOperation(opts)  — factory
 */

import type { OAuthCredential, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import type { ProviderKind, ProviderAccountRegistry } from "./provider-account-registry.ts";
import type { ProviderCredentialStore } from "./provider-credential-store.ts";

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export type LoginOperationState =
  | { phase: "pending" }
  | { phase: "device-code"; userCode: string; verificationUri: string }
  | { phase: "complete"; accountId: string }
  | { phase: "failed" };

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/** An in-flight or completed login operation. */
export interface LoginOperation {
  /** Returns the current operation phase. */
  getState(): LoginOperationState;
  /**
   * Resolves when the operation reaches a terminal state (complete or failed).
   * Never rejects — all failure paths transition to the "failed" phase.
   */
  result: Promise<void>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface StartLoginOperationOpts {
  /** Provider kind for the new account. */
  providerKind: ProviderKind;
  /** Human-readable label for the new account (e.g. "work"). */
  label: string;
  /**
   * Injectable device-code login seam. The production caller passes the real
   * pi-ai loginOpenAICodexDeviceCode / loginGitHubCopilot here; tests pass a
   * fake that calls onDeviceCode and resolves with a canned OAuthCredential.
   */
  loginFn: (callbacks: OAuthLoginCallbacks) => Promise<OAuthCredential>;
  /** Account registry — a new account is added on success. */
  registry: ProviderAccountRegistry;
  /** Credential store — the OAuthCredential is written on success. */
  store: ProviderCredentialStore;
  /**
   * Optional callback invoked when the device-code phase is entered.
   * Fires whether the loginFn calls onDeviceCode synchronously or after an
   * async suspension, so the caller always receives the code + URL in time.
   */
  onDeviceCode?: (info: { userCode: string; verificationUri: string }) => void;
  /**
   * Optional GitHub Enterprise Server domain (e.g. "company.ghe.com").
   * When supplied, onPrompt returns this value so pi-ai resolves the GHE
   * endpoint instead of the github.com default. Omitting it (or passing
   * undefined) preserves the empty-string / github.com default.
   */
  enterpriseDomain?: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Start an observable device-code login operation.
 *
 * Immediately invokes loginFn with a callbacks object and returns a
 * LoginOperation whose state transitions are observable via getState().
 * The result promise resolves in all terminal states (complete or failed).
 */
export function startLoginOperation(opts: StartLoginOperationOpts): LoginOperation {
  let state: LoginOperationState = { phase: "pending" };

  // Build the callbacks object that loginFn will call to report progress.
  const callbacks: OAuthLoginCallbacks = {
    onAuth: (_info) => {
      // No-op: auth-URL flow is not exercised in this operation.
    },
    onDeviceCode: (info) => {
      state = {
        phase: "device-code",
        userCode: info.userCode,
        verificationUri: info.verificationUri,
      };
      opts.onDeviceCode?.({ userCode: info.userCode, verificationUri: info.verificationUri });
    },
    // onPrompt: return the enterprise domain when supplied (GitHub Enterprise
    // Server flow), or empty string to preserve pi-ai's github.com default.
    onPrompt: async (_prompt) => opts.enterpriseDomain ?? "",
    onSelect: async (_prompt) => undefined,
  };

  // result intentionally catches all errors — by design the operation always
  // resolves, surfacing failures through the "failed" phase rather than
  // rejecting. This is not IO/subprocess: it is user-facing state management.
  const result: Promise<void> = (async () => {
    try {
      const credential = await opts.loginFn(callbacks);
      const oauthCred: OAuthCredential = { ...credential, type: "oauth" as const };
      const account = await opts.registry.add({
        providerKind: opts.providerKind,
        label: opts.label,
      });
      await opts.store.modify(account.id, async () => oauthCred);
      state = { phase: "complete", accountId: account.id };
    } catch {
      state = { phase: "failed" };
    }
  })();

  return {
    getState: () => state,
    result,
  };
}

/**
 * src/cli/daemon-provider-session.ts
 *
 * Boot-time account→session resolver for the kanthord daemon.
 * Builds a real ProviderSession from the logged-in account in dataRoot,
 * failing closed with typed, redaction-safe errors.
 *
 * Exports:
 *   DaemonProviderSessionOpts    — resolver options
 *   resolveDaemonProviderSession — async factory
 */

import type { Api, Model, StreamFunction } from "@earendil-works/pi-ai";

import type { ProviderAccount } from "../agent/provider-account-registry.ts";
import { createProviderAccountRegistry } from "../agent/provider-account-registry.ts";
import { createProviderCredentialStore } from "../agent/provider-credential-store.ts";
import { buildProviderSession } from "../agent/provider-session.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DaemonProviderSessionOpts {
  /** Kanthord data root — directory holding accounts.json / credentials.json. */
  dataRoot: string;
  /** Label of the account to use. Omit to auto-select the sole registered account. */
  accountLabel?: string | undefined;
  /** Explicit model id. Falls back to account.defaultModel; fails closed if absent. */
  modelId?: string | undefined;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a boot-time provider session from the kanthord data root.
 *
 * Account selection:
 *   - explicit label, matches    → use that account
 *   - explicit label, no match   → fail: "kanthord login"
 *   - no label, 0 accounts       → fail: "kanthord login"
 *   - no label, 1 account        → auto-select
 *   - no label, >1 accounts      → fail: "--account <label>"
 *
 * Model id: explicit modelId → account.defaultModel → fail: "--model <id>"
 *
 * Errors carry no raw token.
 */
export async function resolveDaemonProviderSession(
  opts: DaemonProviderSessionOpts,
): Promise<{ model: Model<Api>; streamFn: StreamFunction }> {
  const { dataRoot, accountLabel, modelId } = opts;

  const store = createProviderCredentialStore({ dataRoot });
  const registry = createProviderAccountRegistry({ dataRoot, store });

  // 1. Select account
  const accounts = await registry.list();
  let selectedAccount: ProviderAccount;

  if (accountLabel !== undefined) {
    const found = accounts.find((a) => a.label === accountLabel);
    if (found === undefined) {
      if (accounts.length === 0) {
        throw new Error(
          `No provider accounts found. Run 'kanthord login' to register an account.`,
        );
      }
      throw new Error(
        `No account with label "${accountLabel}" found. ` +
          `Use --account <label> to select one of the registered accounts.`,
      );
    }
    selectedAccount = found;
  } else {
    if (accounts.length === 0) {
      throw new Error(
        `No provider accounts found. Run 'kanthord login' to register an account.`,
      );
    }
    if (accounts.length > 1) {
      const labels = accounts.map((a) => a.label).join(", ");
      throw new Error(
        `Multiple provider accounts found (${labels}). ` +
          `Specify one with --account <label>.`,
      );
    }
    const sole = accounts[0];
    if (sole === undefined) {
      // accounts.length === 1 above guarantees this slot is filled; narrow for
      // noUncheckedIndexedAccess.
      throw new Error(
        `No provider accounts found. Run 'kanthord login' to register an account.`,
      );
    }
    selectedAccount = sole;
  }

  // 2. Resolve model id
  const resolvedModelId = modelId ?? selectedAccount.defaultModel;
  if (resolvedModelId === undefined) {
    throw new Error(
      `No model specified for account "${selectedAccount.label}". ` +
        `Provide one with --model <id>.`,
    );
  }

  // 3. Build session via the 019.4 engine — no network call at build time
  const session = await buildProviderSession(
    { accountId: selectedAccount.id, modelId: resolvedModelId },
    { registry, store },
  );

  return { model: session.model, streamFn: session.streamFn };
}

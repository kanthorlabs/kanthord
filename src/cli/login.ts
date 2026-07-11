/**
 * src/cli/login.ts
 *
 * `kanthord login <kind> --account <label>` CLI command.
 *
 * Parses positional kind alias and --account flag, drives startLoginOperation
 * through the injected loginFns seam, prints device-code state (userCode +
 * verificationUri) via `out`, and returns 0 on success.
 *
 * Exports:
 *   LoginCommandDeps   — injectable dependencies for testing
 *   runLoginCommand    — command entry point returning an exit code
 */

import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuthCredential, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import type { ProviderKind, ProviderAccountRegistry } from "../agent/provider-account-registry.ts";
import type { ProviderCredentialStore } from "../agent/provider-credential-store.ts";
import { startLoginOperation } from "../agent/login-operation.ts";

// ---------------------------------------------------------------------------
// CLI kind-alias map
// ---------------------------------------------------------------------------

/** Maps CLI positional argument values to canonical ProviderKind values. */
const KIND_ALIASES: Partial<Record<string, ProviderKind>> = {
  openai: "openai-codex",
  "openai-codex": "openai-codex",
  "github-copilot": "github-copilot",
  copilot: "github-copilot",
  "openai-compatible": "openai-compatible",
};

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/** Injectable dependencies for the login CLI command. */
export interface LoginCommandDeps {
  /** Account registry — a new account is added on success. */
  registry: ProviderAccountRegistry;
  /** Credential store — the OAuthCredential is written on success. */
  store: ProviderCredentialStore;
  /**
   * Per-kind injectable login seam. Production callers bind the real pi-ai
   * device-code login functions here; tests pass fakes that emit the
   * device-code callback and resolve with a canned OAuthCredential.
   */
  loginFns: Partial<
    Record<ProviderKind, (callbacks: OAuthLoginCallbacks) => Promise<OAuthCredential>>
  >;
  /** Output sink. Defaults to a no-op when absent. */
  out?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/**
 * Run `kanthord login <kind> --account <label>`.
 *
 * Returns an exit code: 0 on success, non-zero on error (unknown kind, missing
 * loginFn, or missing --account flag).
 */
export async function runLoginCommand(
  args: string[],
  deps: LoginCommandDeps,
): Promise<number> {
  // --- Parse args ---
  const positionals: string[] = [];
  let label: string | undefined;
  let enterpriseDomain: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--account") {
      label = args[i + 1];
      i++;
    } else if (arg === "--enterprise") {
      enterpriseDomain = args[i + 1];
      i++;
    } else if (arg !== undefined && !arg.startsWith("--")) {
      positionals.push(arg);
    }
  }

  const out = deps.out ?? (() => {});
  const kindAlias = positionals[0];
  const providerKind = kindAlias !== undefined ? KIND_ALIASES[kindAlias] : undefined;

  // --- Validate kind ---
  if (providerKind === undefined) {
    out(
      `Unknown provider kind: "${kindAlias ?? "(none)"}". ` +
        `Supported: openai, github-copilot, openai-compatible.`,
    );
    return 1;
  }

  // --- Validate loginFn ---
  const loginFn = deps.loginFns[providerKind];
  if (loginFn === undefined) {
    out(`No login function registered for provider kind "${providerKind}".`);
    return 1;
  }

  // --- Validate --account ---
  if (label === undefined) {
    out("--account <label> is required.");
    return 1;
  }

  // --- Start login operation ---
  const op = startLoginOperation({
    providerKind,
    label,
    loginFn,
    registry: deps.registry,
    store: deps.store,
    onDeviceCode: (info) => {
      out(`User code:        ${info.userCode}`);
      out(`Verification URL: ${info.verificationUri}`);
    },
    enterpriseDomain,
  });

  await op.result;
  const terminalState = op.getState();
  if (terminalState.phase === "failed") return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Runnable entrypoint
// ---------------------------------------------------------------------------

/** Usage text printed for --help or missing/unknown positional. */
const USAGE = `\
Usage: kanthord login <kind> --account <label>

Supported kinds:
  openai          (alias for openai-codex)
  openai-codex
  github-copilot
  copilot         (alias for github-copilot)
  openai-compatible

Flags (optional):
  --enterprise <domain>   GitHub Enterprise Server domain (github-copilot only)

Examples:
  kanthord login openai --account work
  kanthord login github-copilot --account personal
  kanthord login github-copilot --account corp --enterprise company.ghe.com
`;

/**
 * Testable runnable entry point for `kanthord login`.
 *
 * `buildDeps` defaults to the real `buildLoginDeps` (lazy-imported to avoid
 * circular-module issues at library load time). `out` defaults to a
 * process.stdout line writer. `exit` defaults to process.exit. The direct-run
 * guard at the bottom calls runMain(process.argv.slice(2)).
 */
export async function runMain(
  argv: string[],
  opts?: {
    buildDeps?: (o: { dataRoot: string }) => LoginCommandDeps;
    out?: (msg: string) => void;
    exit?: (code: number) => void;
  },
): Promise<void> {
  const out = opts?.out ?? ((m: string) => { process.stdout.write(m + "\n"); });
  const doExit = opts?.exit ?? ((code: number) => { process.exit(code); });

  if (argv.includes("--help")) {
    out(USAGE);
    doExit(0);
    return;
  }

  // Lazy import avoids circular-module issues when login.ts is imported as a
  // library; the import only runs when runMain() is called.
  const { buildLoginDeps } = await import("./login-deps.ts");
  const dataRoot =
    process.env["KANTHORD_DATA"] ?? join(homedir(), ".kanthord");

  const buildDepsFn = opts?.buildDeps ?? buildLoginDeps;
  const deps = buildDepsFn({ dataRoot });
  const code = await runLoginCommand(argv, { ...deps, out });
  doExit(code);
}

// Run only when this file is the process entry point.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void runMain(process.argv.slice(2));
}

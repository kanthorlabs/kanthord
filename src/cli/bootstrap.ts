/**
 * src/cli/bootstrap — Bootstrap CLI (Story 000 / Task T5)
 *
 * Exports:
 *   - IdentityInput   — { name: string; token: string }
 *   - SlotInput       — { name: string; platform: string; repo: string; identity: string }
 *   - WritableOutput  — { write(msg: string): void }
 *   - BootstrapDeps   — wiring + identity/slot configuration
 *   - BootstrapResult — { exitCode: number; verifyReport: VerifyReport }
 *   - runBootstrap    — fail-closed non-interactive bootstrap command
 *
 * Invariants:
 *   - Fail-closed: any missing/empty token → exits non-zero and writes NOTHING.
 *   - Writes only <kanthordHome>/keyring/<name>.token (0600) and <kanthordHome>/slots.json.
 *   - Never writes ~/.gitconfig, ~/.config/gh, or touches any macOS keychain.
 *   - If sandboxedHome is provided, uses it as HOME and GH_CONFIG_DIR root for child processes.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verifySetup } from "../git/verify-setup.ts";
import type { RunGitSeam, VerifyReport } from "../git/verify-setup.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type IdentityInput = {
  name: string;
  token: string;
};

export type SlotInput = {
  name: string;
  platform: string;
  repo: string;
  identity: string;
};

export type WritableOutput = {
  write(msg: string): void;
};

export type BootstrapDeps = {
  ghBin: string;
  gitBin: string;
  kanthordHome: string;
  sandboxedHome?: string;
  identities: IdentityInput[];
  slots: SlotInput[];
  stdout: WritableOutput;
  stderr: WritableOutput;
  runGit?: RunGitSeam;
};

export type BootstrapResult = {
  exitCode: number;
  verifyReport: VerifyReport;
};

// ---------------------------------------------------------------------------
// runBootstrap
// ---------------------------------------------------------------------------

/**
 * Non-interactive bootstrap: validates inputs, writes keyring + slots,
 * then runs verifySetup for each slot.
 *
 * Fail-closed: if any identity has an empty token, returns non-zero exitCode
 * and writes nothing to kanthordHome.
 */
export async function runBootstrap(
  flags: { nonInteractive: boolean },
  deps: BootstrapDeps,
): Promise<BootstrapResult> {
  const {
    ghBin,
    gitBin,
    kanthordHome,
    sandboxedHome,
    identities,
    slots,
    stderr,
    runGit,
  } = deps;

  // Unused flags param acknowledged; nonInteractive is the only mode today.
  void flags;

  // Build a lookup map: identity name → token
  const identityMap = new Map<string, string>();
  for (const id of identities) {
    identityMap.set(id.name, id.token);
  }

  // ---------------------------------------------------------------------------
  // Fail-closed validation: any missing/empty token → write nothing, exit 1
  // ---------------------------------------------------------------------------
  for (const id of identities) {
    if (id.token === "" || id.token === undefined) {
      stderr.write(
        `bootstrap: missing token for identity "${id.name}" — aborting (fail-closed)\n`,
      );
      // Return a synthetic VerifyReport indicating failure (no real check ran)
      const failReport: VerifyReport = {
        platform: "",
        repo: "",
        identity: id.name,
        ok: false,
        checks: [
          {
            name: "identity-token",
            ok: false,
            detail: `Token for identity "${id.name}" is empty.`,
            remediation: `Set a non-empty token for identity "${id.name}" before running bootstrap.`,
          },
        ],
        inboxItems: [
          {
            kind: "system:setup",
            message: `Bootstrap failed: missing token for identity "${id.name}"`,
            details: `Token for identity "${id.name}" is empty.`,
            remediation: `Set a non-empty token for identity "${id.name}".`,
          },
        ],
      };
      return { exitCode: 1, verifyReport: failReport };
    }
  }

  // ---------------------------------------------------------------------------
  // Write keyring + slots (all-or-nothing: validate first, then write)
  // ---------------------------------------------------------------------------
  const keyringDir = join(kanthordHome, "keyring");
  await mkdir(keyringDir, { recursive: true });

  for (const id of identities) {
    const tokenPath = join(keyringDir, `${id.name}.token`);
    await writeFile(tokenPath, id.token, { mode: 0o600 });
  }

  const slotsPath = join(kanthordHome, "slots.json");
  await writeFile(slotsPath, JSON.stringify(slots, null, 2), {
    encoding: "utf8",
  });

  // ---------------------------------------------------------------------------
  // Run verifySetup for each slot
  // ---------------------------------------------------------------------------
  // configDir: use kanthordHome (not the system gh config path)
  // HOME: if sandboxedHome is provided, use it; otherwise use the system HOME.
  const configDir = sandboxedHome !== undefined
    ? sandboxedHome
    : kanthordHome;

  // Collect all verify reports; use the last one as the canonical result.
  // For a single slot (the common case) this is straightforward.
  let lastReport: VerifyReport | undefined;
  let allOk = true;

  for (const slot of slots) {
    const token = identityMap.get(slot.identity);
    const resolvedToken = token !== undefined ? token : "";

    const report = await verifySetup({
      platform: slot.platform,
      repo: slot.repo,
      identity: slot.identity,
      token: resolvedToken,
      ghBin,
      gitBin,
      configDir,
      runGit,
    });

    lastReport = report;
    if (!report.ok) {
      allOk = false;
    }
  }

  // If no slots were provided, synthesize a passing report.
  if (lastReport === undefined) {
    lastReport = {
      platform: "",
      repo: "",
      identity: "",
      ok: true,
      checks: [],
      inboxItems: [],
    };
  }

  const exitCode = allOk ? 0 : 1;
  return { exitCode, verifyReport: lastReport };
}

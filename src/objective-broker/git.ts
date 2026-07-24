// src/objective-broker/git.ts — GitObjectiveBroker adapter (EPIC 007.12 Story C).
// Uses real git via execFile (no shell). Fetches an objective commit into the
// bare home repo, validates it is exactly one commit ahead of the recorded
// parent, and CAS-advances the initiative branch — mirroring the CAS shape
// already used by GitRepositoryLanding.landPreviewed (src/landing/git.ts).

import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import type { ObjectiveBroker } from "./port.ts";
import { LandingCASMismatchError } from "../landing/port.ts";

const execFile = promisify(execFileCb);

async function gitOut(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd });
  return stdout.trim();
}

export class GitObjectiveBroker implements ObjectiveBroker {
  async fetch(homeDir: string, clonePath: string, oid: string): Promise<void> {
    await execFile("git", ["fetch", clonePath, oid], { cwd: homeDir });
  }

  async countCommitsSince(
    homeDir: string,
    parentOid: string,
    oid: string,
  ): Promise<number> {
    const out = await gitOut(
      homeDir,
      "rev-list",
      "--count",
      `${parentOid}..${oid}`,
    );
    return Number.parseInt(out, 10);
  }

  async casUpdateRef(
    homeDir: string,
    ref: string,
    oid: string,
    expectedOld: string,
  ): Promise<void> {
    try {
      await execFile("git", ["update-ref", ref, oid, expectedOld], {
        cwd: homeDir,
      });
    } catch {
      const newTargetOID = await gitOut(homeDir, "rev-parse", ref);
      throw new LandingCASMismatchError(newTargetOID);
    }
  }

  async currentTip(homeDir: string, ref: string): Promise<string> {
    return gitOut(homeDir, "rev-parse", ref);
  }
}

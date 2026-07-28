// src/repository-probe/port.ts — EPIC 014 Story 4
// The read-only repository-probe port. The probe is a one-shot, side-effect-
// free check (`git ls-remote --heads`) that the readiness report runs only
// when the operator passes `--probe-repositories`. The port stays tiny on
// purpose: one capability (probe a repository), one method.

import type { RepositoryAuth } from "../domain/resource.ts";

/** Bounded timeout per `git ls-remote` call — a hang is `failed`, never a wait. */
export const REPOSITORY_PROBE_TIMEOUT_MS = 10_000;

export interface RepositoryProbeInput {
  remoteUrl: string;
  branch: string;
  auth: RepositoryAuth;
}

export interface RepositoryProbeResult {
  status: "ok" | "failed";
  detail: string;
}

export interface RepositoryProbe {
  probe(input: RepositoryProbeInput): Promise<RepositoryProbeResult>;
}

// src/app/project/probe-ai-provider.ts — EPIC 014 Story 5
// Provider-probe adapter for `check project --probe-provider`.
//
// Wraps the existing `TestAiProvider` tester with a fixed probe prompt, a
// structured outcome (`status` / `detail`), and redaction of the resolved
// provider secret from any error message — so a dead key never leaks into
// a report or a log.
//
// Why this is a separate use case (not a method on `TestAiProvider`):
// - `TestAiProvider.execute` is a general-purpose "ask the provider" path
//   used by the `test ai-provider` CLI command; its return value is the
//   model reply, which is unbounded and may contain a credential.
// - The readiness probe needs a fixed confirmation string in the success
//   detail (so the model reply can never reach the report) and a redacted,
//   first-line, 300-char-capped detail in the failure case. Splitting the
//   two keeps each use case's contract honest.

import { makeRedactor } from "../../domain/redact.ts";

/** The fixed prompt the readiness probe sends to the provider. Stable contract. */
export const PROVIDER_PROBE_PROMPT = "kanthord readiness probe";

/** The structured outcome of a single provider probe. */
export interface ProviderProbeOutcome {
  resourceId: string;
  status: "ok" | "failed";
  detail: string;
}

/** The contract the readiness probe needs from the underlying tester. */
export interface ProbeAiProviderTester {
  execute(input: { id: string; prompt: string }): Promise<string>;
}

/** A redactor accessor: given a provider id, return its secret (or null). */
export type ProviderSecretOf = (providerId: string) => string | null;

/** Detail length cap for the failure path. Matches `GitRepositoryProbe`. */
const PROBE_DETAIL_MAX = 300;

/** Success-path confirmation. Fixed string — never the model reply. */
const PROBE_OK_DETAIL = "provider answered the probe prompt";

export class ProbeAiProvider {
  readonly #tester: ProbeAiProviderTester;
  readonly #secretOf: ProviderSecretOf;

  constructor(tester: ProbeAiProviderTester, secretOf: ProviderSecretOf) {
    this.#tester = tester;
    this.#secretOf = secretOf;
  }

  /**
   * Run the readiness probe against a single provider.
   *
   * NEVER throws — a failed provider must not abort the rest of the
   * `check project` report. The caller is the use case; an exception here
   * would surface as a top-level rejection and skip every other check.
   */
  async execute(providerId: string): Promise<ProviderProbeOutcome> {
    try {
      await this.#tester.execute({
        id: providerId,
        prompt: PROVIDER_PROBE_PROMPT,
      });
      return {
        resourceId: providerId,
        status: "ok",
        detail: PROBE_OK_DETAIL,
      };
    } catch (err) {
      const redact = makeRedactor(this.#secretOf(providerId));
      const raw = err instanceof Error ? err.message : String(err);
      const detail = redact(raw)
        .split("\n")[0]!
        .trim()
        .slice(0, PROBE_DETAIL_MAX);
      return {
        resourceId: providerId,
        status: "failed",
        detail,
      };
    }
  }
}

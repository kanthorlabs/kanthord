/**
 * Story 06 T1 — verification types
 *
 * Three distinct types used by the runner and profiles:
 *
 * OutcomeEvidence  — runner-computed structural facts about the workspace
 *                    after the agent run (diff vs baseCommit + last response).
 * VerificationResult — profile-owned two-valued judgment: accepted or rejected.
 * VerificationEvidence — one entry per task-authored verification command
 *                        executed by the runner (D6).
 */

/**
 * Structural facts the runner computes from the workspace after waitForIdle().
 * Passed by value to the profile — profiles never touch the workspace directly.
 */
export type OutcomeEvidence = {
  baseCommit: string;
  finalDiff: { files: string[]; hasChanges: boolean };
  finalResponse: string;
};

/**
 * Two-valued verdict returned by PiAgentProfile.verify().
 *
 * accepted: work is acceptable; the runner proceeds to finalize.
 * rejected: work is not acceptable; the runner returns a failed TaskResult
 *           with reason = '<code>: <message>'.
 */
export type VerificationResult =
  | { verdict: "accepted"; evidence: string }
  | {
      verdict: "rejected";
      code: "NO_CHANGES" | "UNEXPECTED_CHANGES" | "MISSING_RESPONSE";
      message: string;
    };

/**
 * One entry per task-authored verification command executed after an accepted
 * verdict (D6). Captured by the runner, never authored by the profile.
 */
export type VerificationEvidence = {
  command: string;
  exitCode: number;
  output: string;
};

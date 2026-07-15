/**
 * Story 006 T2 — DaemonOps view + verify trigger component tests.
 *
 * DaemonOps renders:
 *   1. A glanceable dead-man HEALTH CARD (DESIGN §6 OpsPage card) showing:
 *      - Last ping time (from DeadManPing.sentAt, an int64 bigint)
 *      - Processed count "N tasks processed today" (DeadManPing.tasksProcessed)
 *      - Explicit states for absent/not-yet-available data
 *   2. A verify trigger button that calls client.triggerVerify({}) and renders
 *      the returned VerifyReport inline.
 *
 * The component calls client.getDaemonStatus({}) on mount and
 * client.triggerVerify({}) when the trigger is clicked.
 *
 * Asserts:
 *   HEALTH CARD:
 *   - Loading state renders while getDaemonStatus is pending
 *   - The health card renders when ping is present (present=true)
 *   - Ping time (sentAt) renders in the card
 *   - "N tasks processed today" renders when present=true, tasksProcessed > 0
 *   - "0 tasks processed today" renders when present=true, tasksProcessed=0n
 *     (the N==0 silent-idle case — distinct from not-yet-available)
 *   - tasksProcessed "0" renders the count element (not the unavailable element)
 *   - tasksProcessed unavailable renders when present=false (not the count "0")
 *   - "no ping recorded" explicit state renders when present=false
 *
 *   VERIFY TRIGGER:
 *   - The trigger button is present after data loads
 *   - Clicking trigger calls client.triggerVerify({}) exactly once
 *   - Clean-pass case: verify report container renders with "pass" outcome
 *   - Divergence-list case: verify report renders "fail" outcome AND the
 *     report_json detail content appears in the report area
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because:
 *   - clients/web/src/daemon-ops/DaemonOps.tsx does not exist
 *   - locators.daemonOps.{healthCard, pingTime, tasksProcessed,
 *     tasksProcessedUnavailable, noPingState, verifyTrigger, verifyReport,
 *     verifyOutcome} are not in the registry
 *   - locators.opsPage.{root, card} are not in the registry
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DaemonOps } from "@/daemon-ops/DaemonOps";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";

// ---------------------------------------------------------------------------
// Fixtures — plain objects matching the proto field shapes (bigint for int64).
// The TE does not import the generated types; values are structurally typed.
// ---------------------------------------------------------------------------

/** Ping with tasks: the normal operational state. */
const PING_WITH_TASKS = {
  present: true,
  sentAt: 1_750_000_000_000n, // epoch ms (bigint)
  tasksProcessed: 42n,
};

/**
 * Ping with zero tasks: present=true but tasksProcessed=0n.
 * This is the "silent-idle" N==0 case — dangerous because the daemon is up
 * but not processing; the count must render as "0" (not not-yet-available).
 */
const PING_ZERO_TASKS = {
  present: true,
  sentAt: 1_750_000_000_000n,
  tasksProcessed: 0n,
};

/**
 * No ping yet: present=false (Epic 029 has not yet populated the count).
 * Both the ping time and the tasks count are not yet available.
 */
const NO_PING = {
  present: false,
  sentAt: 0n,
  tasksProcessed: 0n,
};

/** Verify report — clean pass. */
const CLEAN_REPORT = {
  present: true,
  outcome: "pass",
  ranAt: 1_750_000_001_000n,
  reportJson: '{"summary":"All checks passed","divergences":[]}',
};

/** Verify report — divergence list. */
const DIVERGENCE_REPORT = {
  present: true,
  outcome: "fail",
  ranAt: 1_750_000_002_000n,
  reportJson:
    '{"summary":"Divergences found","divergences":["task-001: missing artifact","task-002: state mismatch"]}',
};

// ---------------------------------------------------------------------------
// Fake clients
// ---------------------------------------------------------------------------

interface OpsClientOpts {
  lastPing?: typeof PING_WITH_TASKS | typeof NO_PING;
  /**
   * Typed loosely so plain-object lambdas compile regardless of the strict
   * proto-es return type that Client<typeof DaemonService> carries on its
   * triggerVerify method. The fake object is cast `as unknown as DaemonClient`
   * before being consumed, so the loose slot does not weaken any assertion.
   */
  triggerVerifyFn?: (req: unknown, options?: unknown) => Promise<unknown>;
}

function makeStatusOnly(
  ping: typeof PING_WITH_TASKS | typeof NO_PING
): DaemonClient {
  return {
    getDaemonStatus: async () => ({
      version: "0.0.0-test",
      uptimeSeconds: 3600n,
      lastPing: ping,
      lastVerify: undefined,
    }),
    triggerVerify: () => new Promise(() => { /* never resolves by default */ }),
  } as unknown as DaemonClient;
}

function makeOpsClient({
  lastPing = PING_WITH_TASKS,
  triggerVerifyFn,
}: OpsClientOpts = {}): DaemonClient {
  return {
    getDaemonStatus: async () => ({
      version: "0.0.0-test",
      uptimeSeconds: 3600n,
      lastPing,
      lastVerify: undefined,
    }),
    triggerVerify: triggerVerifyFn ?? (async () => ({ report: CLEAN_REPORT })),
  } as unknown as DaemonClient;
}

function makeHangingClient(): DaemonClient {
  return {
    getDaemonStatus: () => new Promise(() => { /* never resolves */ }),
    triggerVerify: () => new Promise(() => { /* never resolves */ }),
  } as unknown as DaemonClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DaemonOps — daemon-ops view + verify trigger (Story 006 T2)", () => {
  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  describe("loading state", () => {
    it("renders the loading state while getDaemonStatus is pending", () => {
      render(
        <DaemonClientProvider client={makeHangingClient()}>
          <DaemonOps />
        </DaemonClientProvider>
      );
      expect(screen.getByTestId(locators.dataStates.loading)).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Dead-man health card — ping present
  // -----------------------------------------------------------------------

  describe("health card — ping present (present=true)", () => {
    it("renders the health card when the ping is present", async () => {
      render(
        <DaemonClientProvider client={makeStatusOnly(PING_WITH_TASKS)}>
          <DaemonOps />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.daemonOps.healthCard);
      expect(screen.getByTestId(locators.daemonOps.healthCard)).toBeInTheDocument();
    });

    it("renders the ping time element when present=true", async () => {
      render(
        <DaemonClientProvider client={makeStatusOnly(PING_WITH_TASKS)}>
          <DaemonOps />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.daemonOps.healthCard);
      expect(screen.getByTestId(locators.daemonOps.pingTime)).toBeInTheDocument();
    });

    it("renders the tasks-processed count (N=42) when present=true", async () => {
      render(
        <DaemonClientProvider client={makeStatusOnly(PING_WITH_TASKS)}>
          <DaemonOps />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.daemonOps.healthCard);
      const count = screen.getByTestId(locators.daemonOps.tasksProcessed);
      expect(count).toBeInTheDocument();
      expect(count).toHaveTextContent("42");
    });

    it("renders 'tasks processed today' label alongside the count", async () => {
      render(
        <DaemonClientProvider client={makeStatusOnly(PING_WITH_TASKS)}>
          <DaemonOps />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.daemonOps.healthCard);
      const card = screen.getByTestId(locators.daemonOps.healthCard);
      expect(card).toHaveTextContent(/tasks processed today/i);
    });
  });

  // -----------------------------------------------------------------------
  // Dead-man health card — N==0 (silent-idle) case: present=true, count=0
  // -----------------------------------------------------------------------

  describe("health card — N=0 case (present=true, tasksProcessed=0n)", () => {
    it("renders '0' in the tasks-processed element (not the unavailable element)", async () => {
      render(
        <DaemonClientProvider client={makeStatusOnly(PING_ZERO_TASKS)}>
          <DaemonOps />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.daemonOps.healthCard);
      const count = screen.getByTestId(locators.daemonOps.tasksProcessed);
      expect(count).toBeInTheDocument();
      expect(count).toHaveTextContent("0");
    });

    it("does NOT render the not-yet-available element when present=true, count=0", async () => {
      render(
        <DaemonClientProvider client={makeStatusOnly(PING_ZERO_TASKS)}>
          <DaemonOps />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.daemonOps.healthCard);
      expect(
        screen.queryByTestId(locators.daemonOps.tasksProcessedUnavailable)
      ).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Dead-man health card — no ping yet (present=false)
  // -----------------------------------------------------------------------

  describe("health card — no ping yet (present=false)", () => {
    it("renders the explicit 'no ping recorded' state", async () => {
      render(
        <DaemonClientProvider client={makeStatusOnly(NO_PING)}>
          <DaemonOps />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.daemonOps.healthCard);
      expect(
        screen.getByTestId(locators.daemonOps.noPingState)
      ).toBeInTheDocument();
    });

    it("'no ping recorded' element contains the expected text", async () => {
      render(
        <DaemonClientProvider client={makeStatusOnly(NO_PING)}>
          <DaemonOps />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.daemonOps.healthCard);
      expect(screen.getByTestId(locators.daemonOps.noPingState)).toHaveTextContent(
        /no ping recorded/i
      );
    });

    it("renders the not-yet-available element for tasks count when present=false", async () => {
      render(
        <DaemonClientProvider client={makeStatusOnly(NO_PING)}>
          <DaemonOps />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.daemonOps.healthCard);
      expect(
        screen.getByTestId(locators.daemonOps.tasksProcessedUnavailable)
      ).toBeInTheDocument();
    });

    it("does NOT render the tasks-processed count element when present=false", async () => {
      render(
        <DaemonClientProvider client={makeStatusOnly(NO_PING)}>
          <DaemonOps />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.daemonOps.healthCard);
      expect(
        screen.queryByTestId(locators.daemonOps.tasksProcessed)
      ).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Error handling (B2, B3 — reviewer blockers)
  // -----------------------------------------------------------------------

  describe("error handling", () => {
    it("renders the error state when getDaemonStatus rejects — does not stay on loading (B2)", async () => {
      // getDaemonStatus has no .catch in the current impl — the component stays
      // on the loading skeleton forever. After the fix it must show dataStates.error.
      const rejectingClient: DaemonClient = {
        getDaemonStatus: async () => {
          throw new Error("network failure");
        },
        triggerVerify: () => new Promise(() => { /* never resolves */ }),
      } as unknown as DaemonClient;

      render(
        <DaemonClientProvider client={rejectingClient}>
          <DaemonOps />
        </DaemonClientProvider>
      );

      const errorEl = await screen.findByTestId(locators.dataStates.error);
      expect(errorEl).toBeInTheDocument();
      expect(
        screen.queryByTestId(locators.dataStates.loading)
      ).not.toBeInTheDocument();
    });

    it("renders the inline verify-error element when triggerVerify rejects (B3)", async () => {
      // handleVerify has no try/catch and locators.daemonOps.verifyError does not
      // exist yet — both are part of the failing state the SE must fix.
      const user = userEvent.setup();
      const client = makeOpsClient({
        triggerVerifyFn: async () => {
          throw new Error("verify network failure");
        },
      });

      render(
        <DaemonClientProvider client={client}>
          <DaemonOps />
        </DaemonClientProvider>
      );

      await screen.findByTestId(locators.daemonOps.healthCard);
      await user.click(screen.getByTestId(locators.daemonOps.verifyTrigger));

      // locators.daemonOps.verifyError is the new locator the SE must add.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const verifyError = await screen.findByTestId((locators.daemonOps as any).verifyError);
      expect(verifyError).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Verify trigger
  // -----------------------------------------------------------------------

  describe("verify trigger", () => {
    it("verify trigger button is present after data loads", async () => {
      render(
        <DaemonClientProvider client={makeOpsClient()}>
          <DaemonOps />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.daemonOps.healthCard);
      expect(
        screen.getByTestId(locators.daemonOps.verifyTrigger)
      ).toBeInTheDocument();
    });

    it("clicking the trigger calls client.triggerVerify once", async () => {
      const user = userEvent.setup();
      const triggerVerifyFn = vi.fn().mockResolvedValue({ report: CLEAN_REPORT });
      render(
        <DaemonClientProvider
          client={makeOpsClient({ triggerVerifyFn })}
        >
          <DaemonOps />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.daemonOps.healthCard);
      await user.click(screen.getByTestId(locators.daemonOps.verifyTrigger));
      await waitFor(() => {
        expect(triggerVerifyFn).toHaveBeenCalledOnce();
      });
    });

    describe("clean-pass report", () => {
      it("renders the verify report container after trigger", async () => {
        const user = userEvent.setup();
        render(
          <DaemonClientProvider
            client={makeOpsClient({
              triggerVerifyFn: async () => ({ report: CLEAN_REPORT }),
            })}
          >
            <DaemonOps />
          </DaemonClientProvider>
        );
        await screen.findByTestId(locators.daemonOps.healthCard);
        await user.click(screen.getByTestId(locators.daemonOps.verifyTrigger));
        await screen.findByTestId(locators.daemonOps.verifyReport);
        expect(
          screen.getByTestId(locators.daemonOps.verifyReport)
        ).toBeInTheDocument();
      });

      it("renders the 'pass' outcome in the verify report", async () => {
        const user = userEvent.setup();
        render(
          <DaemonClientProvider
            client={makeOpsClient({
              triggerVerifyFn: async () => ({ report: CLEAN_REPORT }),
            })}
          >
            <DaemonOps />
          </DaemonClientProvider>
        );
        await screen.findByTestId(locators.daemonOps.healthCard);
        await user.click(screen.getByTestId(locators.daemonOps.verifyTrigger));
        await screen.findByTestId(locators.daemonOps.verifyReport);
        expect(screen.getByTestId(locators.daemonOps.verifyOutcome)).toHaveTextContent(
          "pass"
        );
      });
    });

    describe("divergence-list report", () => {
      it("renders the verify report container after trigger", async () => {
        const user = userEvent.setup();
        render(
          <DaemonClientProvider
            client={makeOpsClient({
              triggerVerifyFn: async () => ({ report: DIVERGENCE_REPORT }),
            })}
          >
            <DaemonOps />
          </DaemonClientProvider>
        );
        await screen.findByTestId(locators.daemonOps.healthCard);
        await user.click(screen.getByTestId(locators.daemonOps.verifyTrigger));
        await screen.findByTestId(locators.daemonOps.verifyReport);
        expect(
          screen.getByTestId(locators.daemonOps.verifyReport)
        ).toBeInTheDocument();
      });

      it("renders the 'fail' outcome in the divergence report", async () => {
        const user = userEvent.setup();
        render(
          <DaemonClientProvider
            client={makeOpsClient({
              triggerVerifyFn: async () => ({ report: DIVERGENCE_REPORT }),
            })}
          >
            <DaemonOps />
          </DaemonClientProvider>
        );
        await screen.findByTestId(locators.daemonOps.healthCard);
        await user.click(screen.getByTestId(locators.daemonOps.verifyTrigger));
        await screen.findByTestId(locators.daemonOps.verifyReport);
        expect(screen.getByTestId(locators.daemonOps.verifyOutcome)).toHaveTextContent(
          "fail"
        );
      });

      it("renders the divergence detail from report_json in the report area", async () => {
        const user = userEvent.setup();
        render(
          <DaemonClientProvider
            client={makeOpsClient({
              triggerVerifyFn: async () => ({ report: DIVERGENCE_REPORT }),
            })}
          >
            <DaemonOps />
          </DaemonClientProvider>
        );
        await screen.findByTestId(locators.daemonOps.healthCard);
        await user.click(screen.getByTestId(locators.daemonOps.verifyTrigger));
        const report = await screen.findByTestId(locators.daemonOps.verifyReport);
        // The report_json content is rendered (raw or structured); at minimum
        // the divergence strings from the JSON appear somewhere in the report area.
        expect(report).toHaveTextContent("task-001: missing artifact");
        expect(report).toHaveTextContent("task-002: state mismatch");
      });
    });
  });
});

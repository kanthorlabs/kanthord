import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DaemonOps } from "@/daemon-ops/DaemonOps";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";

const PING_WITH_TASKS = { present: true, sentAt: 1_750_000_000_000n, tasksProcessed: 42n };
const PING_ZERO_TASKS = { present: true, sentAt: 1_750_000_000_000n, tasksProcessed: 0n };
const NO_PING = { present: false, sentAt: 0n, tasksProcessed: 0n };
const CLEAN_REPORT = {
  present: true, outcome: "pass", ranAt: 1_750_000_001_000n,
  reportJson: '{"summary":"All checks passed","divergences":[]}',
};
const DIVERGENCE_REPORT = {
  present: true, outcome: "fail", ranAt: 1_750_000_002_000n,
  reportJson: '{"summary":"Divergences found","divergences":["task-001: missing artifact","task-002: state mismatch"]}',
};

function renderOps(
  lastPing: typeof PING_WITH_TASKS | typeof NO_PING = PING_WITH_TASKS,
  triggerVerify: DaemonClient["triggerVerify"] = async () => ({ report: CLEAN_REPORT }) as never,
) {
  const client = { triggerVerify } as unknown as DaemonClient;
  return render(
    <DaemonClientProvider client={client}>
      <DaemonOps
        status={{ version: "0.0.0-test", uptimeSeconds: 3600n, lastPing }}
      />
    </DaemonClientProvider>,
  );
}

describe("DaemonOps — daemon-ops view + verify trigger (Story 006 T2)", () => {
  describe("loading state", () => {
    it("renders the loading state while getDaemonStatus is pending", () => {
      render(<DaemonOps loading />);
      expect(screen.getByTestId(locators.dataStates.loading)).toBeInTheDocument();
    });
  });

  describe("health card — ping present (present=true)", () => {
    it("renders the health card when the ping is present", () => {
      renderOps();
      expect(screen.getByTestId(locators.daemonOps.healthCard)).toBeInTheDocument();
    });

    it("renders the ping time element when present=true", () => {
      renderOps();
      expect(screen.getByTestId(locators.daemonOps.pingTime)).toBeInTheDocument();
    });

    it("renders the tasks-processed count (N=42) when present=true", () => {
      renderOps();
      const count = screen.getByTestId(locators.daemonOps.tasksProcessed);
      expect(count).toBeInTheDocument();
      expect(count).toHaveTextContent("42");
    });

    it("renders 'tasks processed today' label alongside the count", () => {
      renderOps();
      expect(screen.getByTestId(locators.daemonOps.healthCard)).toHaveTextContent(/tasks processed today/i);
    });
  });

  describe("health card — N=0 case (present=true, tasksProcessed=0n)", () => {
    it("renders '0' in the tasks-processed element (not the unavailable element)", () => {
      renderOps(PING_ZERO_TASKS);
      const count = screen.getByTestId(locators.daemonOps.tasksProcessed);
      expect(count).toBeInTheDocument();
      expect(count).toHaveTextContent("0");
    });

    it("does NOT render the not-yet-available element when present=true, count=0", () => {
      renderOps(PING_ZERO_TASKS);
      expect(screen.queryByTestId(locators.daemonOps.tasksProcessedUnavailable)).not.toBeInTheDocument();
    });
  });

  describe("health card — no ping yet (present=false)", () => {
    it("renders the explicit 'no ping recorded' state", () => {
      renderOps(NO_PING);
      expect(screen.getByTestId(locators.daemonOps.noPingState)).toBeInTheDocument();
    });

    it("'no ping recorded' element contains the expected text", () => {
      renderOps(NO_PING);
      expect(screen.getByTestId(locators.daemonOps.noPingState)).toHaveTextContent(/no ping recorded/i);
    });

    it("renders the not-yet-available element for tasks count when present=false", () => {
      renderOps(NO_PING);
      expect(screen.getByTestId(locators.daemonOps.tasksProcessedUnavailable)).toBeInTheDocument();
    });

    it("does NOT render the tasks-processed count element when present=false", () => {
      renderOps(NO_PING);
      expect(screen.queryByTestId(locators.daemonOps.tasksProcessed)).not.toBeInTheDocument();
    });
  });

  describe("error handling", () => {
    it("renders the error state when getDaemonStatus rejects — does not stay on loading (B2)", () => {
      render(<DaemonOps error={{ message: "network failure" }} />);
      expect(screen.getByTestId(locators.dataStates.error)).toBeInTheDocument();
      expect(screen.queryByTestId(locators.dataStates.loading)).not.toBeInTheDocument();
    });

    it("renders the inline verify-error element when triggerVerify rejects (B3)", async () => {
      const user = userEvent.setup();
      renderOps(PING_WITH_TASKS, async () => {
        throw new Error("verify network failure");
      });
      await user.click(screen.getByTestId(locators.daemonOps.verifyTrigger));
      expect(await screen.findByTestId(locators.daemonOps.verifyError)).toBeInTheDocument();
    });
  });

  describe("verify trigger", () => {
    it("verify trigger button is present after data loads", () => {
      renderOps();
      expect(screen.getByTestId(locators.daemonOps.verifyTrigger)).toBeInTheDocument();
    });

    it("clicking the trigger calls client.triggerVerify once", async () => {
      const user = userEvent.setup();
      const triggerVerify = vi.fn().mockResolvedValue({ report: CLEAN_REPORT });
      renderOps(PING_WITH_TASKS, triggerVerify as never);
      await user.click(screen.getByTestId(locators.daemonOps.verifyTrigger));
      await waitFor(() => expect(triggerVerify).toHaveBeenCalledOnce());
    });

    describe("clean-pass report", () => {
      it("renders the verify report container after trigger", async () => {
        const user = userEvent.setup();
        renderOps(PING_WITH_TASKS, async () => ({ report: CLEAN_REPORT }) as never);
        await user.click(screen.getByTestId(locators.daemonOps.verifyTrigger));
        expect(await screen.findByTestId(locators.daemonOps.verifyReport)).toBeInTheDocument();
      });

      it("renders the 'pass' outcome in the verify report", async () => {
        const user = userEvent.setup();
        renderOps(PING_WITH_TASKS, async () => ({ report: CLEAN_REPORT }) as never);
        await user.click(screen.getByTestId(locators.daemonOps.verifyTrigger));
        expect(await screen.findByTestId(locators.daemonOps.verifyOutcome)).toHaveTextContent("pass");
      });
    });

    describe("divergence-list report", () => {
      it("renders the verify report container after trigger", async () => {
        const user = userEvent.setup();
        renderOps(PING_WITH_TASKS, async () => ({ report: DIVERGENCE_REPORT }) as never);
        await user.click(screen.getByTestId(locators.daemonOps.verifyTrigger));
        expect(await screen.findByTestId(locators.daemonOps.verifyReport)).toBeInTheDocument();
      });

      it("renders the 'fail' outcome in the divergence report", async () => {
        const user = userEvent.setup();
        renderOps(PING_WITH_TASKS, async () => ({ report: DIVERGENCE_REPORT }) as never);
        await user.click(screen.getByTestId(locators.daemonOps.verifyTrigger));
        expect(await screen.findByTestId(locators.daemonOps.verifyOutcome)).toHaveTextContent("fail");
      });

      it("renders the divergence detail from report_json in the report area", async () => {
        const user = userEvent.setup();
        renderOps(PING_WITH_TASKS, async () => ({ report: DIVERGENCE_REPORT }) as never);
        await user.click(screen.getByTestId(locators.daemonOps.verifyTrigger));
        const report = await screen.findByTestId(locators.daemonOps.verifyReport);
        expect(report).toHaveTextContent("task-001: missing artifact");
        expect(report).toHaveTextContent("task-002: state mismatch");
      });
    });
  });
});

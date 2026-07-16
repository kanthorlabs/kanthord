/**
 * Story 002 T1 — SignOff flow component tests.
 *
 * Fake-client convention (established in Story 001):
 *   - Components get the daemon client via useDaemonClient() from DaemonClientProvider.
 *   - Tests wrap in <DaemonClientProvider client={fake}> with an inline fake cast
 *     as unknown as DaemonClient.
 *   - Only the methods under test are implemented on the fake.
 *
 * ACs:
 *   - valid-plan fixture → compile result + stamped generation rendered
 *   - invalid-plan fixture → each diagnostic string rendered VERBATIM (no rewording)
 *   - fake client saw exactly the signOffPlan method (and no other)
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because:
 *   - clients/web/src/plan-flows/SignOff.tsx does not exist
 *   - locators.planFlows.signOff.{trigger,result,generation,diagnostic} are not
 *     in clients/web/src/locators.ts
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignOff } from "@/plan-flows/SignOff";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_PLAN_RESPONSE = {
  valid: true,
  diagnostics: [] as string[],
  generation: BigInt(7),
};

const INVALID_PLAN_RESPONSE = {
  valid: false,
  diagnostics: [
    "Story S1 is missing a required task reference",
    "Task T3 has a dependency cycle: T3 → T5 → T3",
    "Epic 002 vocabulary: node type 'unknown_type' is not recognized",
  ],
  generation: BigInt(0),
};

function makeSignOffClient(
  response: typeof VALID_PLAN_RESPONSE | typeof INVALID_PLAN_RESPONSE,
  callLog: string[]
): DaemonClient {
  return {
    signOffPlan: async () => {
      callLog.push("signOffPlan");
      return response;
    },
  } as unknown as DaemonClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SignOff — plan sign-off flow (Story 002 T1)", () => {
  describe("initial render", () => {
    it("renders the sign-off trigger button before any action", () => {
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeSignOffClient(VALID_PLAN_RESPONSE, callLog)}>
          <SignOff featureId="feat-001" actor="operator@kanthord" />
        </DaemonClientProvider>
      );
      expect(
        screen.getByTestId(locators.planFlows.signOff.trigger)
      ).toBeInTheDocument();
    });
  });

  describe("valid-plan fixture", () => {
    it("invokes onSuccess exactly once after a valid plan is signed off", async () => {
      const user = userEvent.setup();
      const onSuccess = vi.fn();
      render(
        <DaemonClientProvider client={makeSignOffClient(VALID_PLAN_RESPONSE, [])}>
          <SignOff featureId="feat-001" actor="operator@kanthord" onSuccess={onSuccess} />
        </DaemonClientProvider>
      );

      await user.click(screen.getByTestId(locators.planFlows.signOff.trigger));
      await screen.findByTestId(locators.planFlows.signOff.result);
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    it("renders the result area after sign-off on a valid plan", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeSignOffClient(VALID_PLAN_RESPONSE, callLog)}>
          <SignOff featureId="feat-001" actor="operator@kanthord" />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.signOff.trigger));
      await screen.findByTestId(locators.planFlows.signOff.result);
      expect(
        screen.getByTestId(locators.planFlows.signOff.result)
      ).toBeInTheDocument();
    });

    it("renders the stamped generation (7) after sign-off on a valid plan", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeSignOffClient(VALID_PLAN_RESPONSE, callLog)}>
          <SignOff featureId="feat-001" actor="operator@kanthord" />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.signOff.trigger));
      await screen.findByTestId(locators.planFlows.signOff.generation);
      // generation=BigInt(7) must render as "7"
      expect(
        screen.getByTestId(locators.planFlows.signOff.generation)
      ).toHaveTextContent("7");
    });

    it("calls exactly signOffPlan and no other client method for a valid plan", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeSignOffClient(VALID_PLAN_RESPONSE, callLog)}>
          <SignOff featureId="feat-001" actor="operator@kanthord" />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.signOff.trigger));
      await screen.findByTestId(locators.planFlows.signOff.result);
      expect(callLog).toEqual(["signOffPlan"]);
    });
  });

  describe("invalid-plan fixture — diagnostics verbatim", () => {
    it("does not invoke onSuccess when sign-off returns invalid diagnostics", async () => {
      const user = userEvent.setup();
      const onSuccess = vi.fn();
      render(
        <DaemonClientProvider client={makeSignOffClient(INVALID_PLAN_RESPONSE, [])}>
          <SignOff featureId="feat-001" actor="operator@kanthord" onSuccess={onSuccess} />
        </DaemonClientProvider>
      );

      await user.click(screen.getByTestId(locators.planFlows.signOff.trigger));
      await screen.findAllByTestId(locators.planFlows.signOff.diagnostic);
      expect(onSuccess).not.toHaveBeenCalled();
    });
    it("renders the first diagnostic string verbatim (no rewording)", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeSignOffClient(INVALID_PLAN_RESPONSE, callLog)}>
          <SignOff featureId="feat-001" actor="operator@kanthord" />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.signOff.trigger));
      const items = await screen.findAllByTestId(locators.planFlows.signOff.diagnostic);
      expect(items[0]).toHaveTextContent(
        "Story S1 is missing a required task reference"
      );
    });

    it("renders the second diagnostic string verbatim (no rewording)", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeSignOffClient(INVALID_PLAN_RESPONSE, callLog)}>
          <SignOff featureId="feat-001" actor="operator@kanthord" />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.signOff.trigger));
      const items = await screen.findAllByTestId(locators.planFlows.signOff.diagnostic);
      expect(items[1]).toHaveTextContent(
        "Task T3 has a dependency cycle: T3 → T5 → T3"
      );
    });

    it("renders the third diagnostic string verbatim (no rewording)", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeSignOffClient(INVALID_PLAN_RESPONSE, callLog)}>
          <SignOff featureId="feat-001" actor="operator@kanthord" />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.signOff.trigger));
      const items = await screen.findAllByTestId(locators.planFlows.signOff.diagnostic);
      expect(items[2]).toHaveTextContent(
        "Epic 002 vocabulary: node type 'unknown_type' is not recognized"
      );
    });

    it("renders exactly three diagnostic items for the three-diagnostic fixture", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeSignOffClient(INVALID_PLAN_RESPONSE, callLog)}>
          <SignOff featureId="feat-001" actor="operator@kanthord" />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.signOff.trigger));
      const items = await screen.findAllByTestId(locators.planFlows.signOff.diagnostic);
      expect(items).toHaveLength(3);
    });

    it("does not render a generation element when the plan is invalid", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeSignOffClient(INVALID_PLAN_RESPONSE, callLog)}>
          <SignOff featureId="feat-001" actor="operator@kanthord" />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.signOff.trigger));
      await screen.findAllByTestId(locators.planFlows.signOff.diagnostic);
      expect(
        screen.queryByTestId(locators.planFlows.signOff.generation)
      ).not.toBeInTheDocument();
    });

    it("calls exactly signOffPlan and no other method for an invalid plan", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeSignOffClient(INVALID_PLAN_RESPONSE, callLog)}>
          <SignOff featureId="feat-001" actor="operator@kanthord" />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.signOff.trigger));
      await screen.findAllByTestId(locators.planFlows.signOff.diagnostic);
      expect(callLog).toEqual(["signOffPlan"]);
    });
  });
});

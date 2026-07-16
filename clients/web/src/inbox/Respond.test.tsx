/**
 * Story 003 T2 — Respond flow component tests (inline classification confirm +
 * Next-open-item).
 *
 * Fake-client convention (Story 001 pattern): wrap in DaemonClientProvider
 * with an inline fake implementing respondToEscalation / respondToApproval.
 *
 * Asserts (honest-classification Input 1 + daily-usage Inputs 1 & 4):
 *
 *   INLINE CLASSIFICATION CONFIRM (no modal):
 *   - "Accept suggested: <category>" primary button renders with the
 *     suggestedCategory text from the VM inline on the component
 *   - "Override" secondary trigger renders
 *   - After Override is clicked, the category select trigger is visible
 *   - Without selecting an override category the submit button is disabled
 *     (client-side guard — belt-and-braces with the server)
 *
 *   RESPOND INVOCATION:
 *   - Escalation item + Accept → respondToEscalation called with the
 *     confirmedCategory equal to the suggested category
 *   - Approval item + Accept → respondToApproval called with the
 *     confirmedCategory equal to the suggested category
 *   - Category-less API rejection (ConnectError) renders the typed api error
 *   - respondToEscalation is NOT called on a second click after override select
 *     without a value (client-side guard holds)
 *
 *   POST-SUCCESS STATE (daily-usage Input 4):
 *   - Success state element appears after a successful respond
 *   - "Next open item" (primary) button is visible in the success state
 *   - "Back to inbox" (secondary) button is visible in the success state
 *   - Location does NOT auto-navigate (stays at the current route)
 *   - Clicking "Next open item" navigates to the next open item under the
 *     current sort (/inbox/<next-item-id>) — deterministic per the sort order
 *     escalation-first, then by id alphabetically
 *
 * The Respond component is wrapped in MemoryRouter (required for useNavigate
 * used in the Next-open-item navigation).
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because:
 *   - clients/web/src/inbox/Respond.tsx does not exist
 *   - locators.inbox.respond.{acceptButton, overrideTrigger,
 *     categorySelectTrigger, categorySelectItem, submitButton, fieldError,
 *     apiError, successState, nextOpenItem, backToInbox} are not in the registry
 */
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { ConnectError, Code } from "@connectrpc/connect";
import { Respond } from "@/inbox/Respond";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";
import type { InboxItemVM } from "@/inbox/inbox-vm";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeVM(overrides: Partial<InboxItemVM> = {}): InboxItemVM {
  return {
    id: "item-alpha",
    kind: "escalation",
    featureId: "feat-001",
    summary: "Agent needs write access",
    type: "write-access-request",
    severity: "high",
    suggestedCategory: "correction",
    evidence: { kind: "text", text: "Agent attempted a write outside scope" },
    status: "open",
    ...overrides,
  };
}

const ESCALATION_ITEM = makeVM({
  id: "item-alpha",
  kind: "escalation",
  suggestedCategory: "correction",
});

const APPROVAL_ITEM = makeVM({
  id: "item-alpha",
  kind: "approval",
  suggestedCategory: "approval",
});

// Open items list for Next-open-item computation.
// Sort order: escalation-first, then id alphabetically.
// Expected order: item-alpha (esc), item-beta (esc), item-zeta (app)
const OPEN_ITEMS: InboxItemVM[] = [
  makeVM({ id: "item-alpha", kind: "escalation" }),
  makeVM({ id: "item-beta",  kind: "escalation" }),
  makeVM({ id: "item-zeta",  kind: "approval"   }),
];

// ---------------------------------------------------------------------------
// Fake clients
// ---------------------------------------------------------------------------

function makeEscalationClient(callLog: string[]): DaemonClient {
  return {
    respondToEscalation: async () => {
      callLog.push("respondToEscalation");
      return { status: "resolved" };
    },
  } as unknown as DaemonClient;
}

function makeApprovalClient(callLog: string[]): DaemonClient {
  return {
    respondToApproval: async () => {
      callLog.push("respondToApproval");
      return { status: "resolved" };
    },
  } as unknown as DaemonClient;
}

function makeCategoryLessRejectingClient(): DaemonClient {
  return {
    respondToEscalation: async () => {
      throw new ConnectError(
        "confirmed_category is required",
        Code.InvalidArgument
      );
    },
  } as unknown as DaemonClient;
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

/**
 * LocationDisplay is rendered alongside Respond so tests can assert whether
 * navigation happened (DESIGN: no auto-navigate on success).
 */
function LocationDisplay() {
  const location = useLocation();
  return (
    <div data-testid="test-location-display">{location.pathname}</div>
  );
}

function renderRespond(
  item: InboxItemVM,
  client: DaemonClient,
  openItems: InboxItemVM[] = OPEN_ITEMS,
  initialPath: string = "/inbox/item-alpha"
) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/inbox/:id"
          element={
            <DaemonClientProvider client={client}>
              <Respond item={item} openItems={openItems} />
              <LocationDisplay />
            </DaemonClientProvider>
          }
        />
        {/* Fallback to catch navigation to the next item */}
        <Route
          path="/inbox/:id"
          element={<LocationDisplay />}
        />
      </Routes>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Respond — inline classification confirm + Next-open-item (Story 003 T2)", () => {
  describe("inline classification confirm (honest-classification Input 1, no modal)", () => {
    it("renders the 'Accept suggested: correction' button with the suggested category", () => {
      const callLog: string[] = [];
      renderRespond(ESCALATION_ITEM, makeEscalationClient(callLog));
      const accept = screen.getByTestId(locators.inbox.respond.acceptButton);
      expect(accept).toBeInTheDocument();
      expect(accept).toHaveTextContent("correction");
    });

    it("renders the Override secondary trigger", () => {
      const callLog: string[] = [];
      renderRespond(ESCALATION_ITEM, makeEscalationClient(callLog));
      expect(
        screen.getByTestId(locators.inbox.respond.overrideTrigger)
      ).toBeInTheDocument();
    });

    it("no category modal/dialog is present on initial render (no extra modal)", () => {
      const callLog: string[] = [];
      renderRespond(ESCALATION_ITEM, makeEscalationClient(callLog));
      // The respond control is inline — no confirmDialog.content rendered
      expect(
        screen.queryByTestId(locators.confirmDialog.content)
      ).not.toBeInTheDocument();
    });
  });

  describe("Override path — category select revealed, submit guarded", () => {
    it("clicking Override reveals the category select trigger", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      renderRespond(ESCALATION_ITEM, makeEscalationClient(callLog));
      await user.click(screen.getByTestId(locators.inbox.respond.overrideTrigger));
      expect(
        screen.getByTestId(locators.inbox.respond.categorySelectTrigger)
      ).toBeInTheDocument();
    });

    it("submit is disabled when Override is open but no category is selected", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      renderRespond(ESCALATION_ITEM, makeEscalationClient(callLog));
      await user.click(screen.getByTestId(locators.inbox.respond.overrideTrigger));
      // Submit button present but disabled — no category selected
      expect(
        screen.getByTestId(locators.inbox.respond.submitButton)
      ).toBeDisabled();
    });

    it("respondToEscalation is not called when submit is blocked", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      renderRespond(ESCALATION_ITEM, makeEscalationClient(callLog));
      await user.click(screen.getByTestId(locators.inbox.respond.overrideTrigger));
      // Try to click a disabled button — no call should happen
      const submit = screen.getByTestId(locators.inbox.respond.submitButton);
      // Disabled buttons swallow clicks but we assert via callLog
      await user.click(submit);
      expect(callLog).toHaveLength(0);
    });
  });

  describe("Accept path — escalation kind invokes respondToEscalation", () => {
    it("clicking Accept calls respondToEscalation exactly once", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      renderRespond(ESCALATION_ITEM, makeEscalationClient(callLog));
      await user.click(screen.getByTestId(locators.inbox.respond.acceptButton));
      await waitFor(() => expect(callLog).toHaveLength(1));
      expect(callLog[0]).toBe("respondToEscalation");
    });

    it("clicking Accept sends resume with the suggested confirmedCategory", async () => {
      const user = userEvent.setup();
      const calls: Array<{ response: string; confirmedCategory: string }> = [];
      const client = {
        respondToEscalation: async (request: {
          response: string;
          confirmedCategory: string;
        }) => {
          calls.push(request);
          return { status: "resolved" };
        },
      } as unknown as DaemonClient;

      renderRespond(ESCALATION_ITEM, client);
      await user.click(screen.getByTestId(locators.inbox.respond.acceptButton));

      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toMatchObject({
        response: "resume",
        confirmedCategory: "correction",
      });
    });
  });

  describe("Accept path — approval kind invokes respondToApproval", () => {
    it("clicking Accept calls respondToApproval exactly once for approval items", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      renderRespond(APPROVAL_ITEM, makeApprovalClient(callLog));
      await user.click(screen.getByTestId(locators.inbox.respond.acceptButton));
      await waitFor(() => expect(callLog).toHaveLength(1));
      expect(callLog[0]).toBe("respondToApproval");
    });
  });

  describe("API category-less rejection — typed error rendered (belt and braces)", () => {
    it("a ConnectError from the API renders the typed api error element", async () => {
      const user = userEvent.setup();
      renderRespond(ESCALATION_ITEM, makeCategoryLessRejectingClient());
      await user.click(screen.getByTestId(locators.inbox.respond.acceptButton));
      const apiError = await screen.findByTestId(locators.inbox.respond.apiError);
      expect(apiError).toBeInTheDocument();
    });

    it("the api error element contains the server rejection message", async () => {
      const user = userEvent.setup();
      renderRespond(ESCALATION_ITEM, makeCategoryLessRejectingClient());
      await user.click(screen.getByTestId(locators.inbox.respond.acceptButton));
      const apiError = await screen.findByTestId(locators.inbox.respond.apiError);
      expect(apiError).toHaveTextContent("confirmed_category is required");
    });

    it("does NOT show the success state when the API rejects", async () => {
      const user = userEvent.setup();
      renderRespond(ESCALATION_ITEM, makeCategoryLessRejectingClient());
      await user.click(screen.getByTestId(locators.inbox.respond.acceptButton));
      await screen.findByTestId(locators.inbox.respond.apiError);
      expect(
        screen.queryByTestId(locators.inbox.respond.successState)
      ).not.toBeInTheDocument();
    });
  });

  describe("post-success state (daily-usage Input 4)", () => {
    it("success state element appears after a successful respond", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      renderRespond(ESCALATION_ITEM, makeEscalationClient(callLog));
      await user.click(screen.getByTestId(locators.inbox.respond.acceptButton));
      const success = await screen.findByTestId(locators.inbox.respond.successState);
      expect(success).toBeInTheDocument();
    });

    it("'Next open item' primary button is visible in the success state", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      renderRespond(ESCALATION_ITEM, makeEscalationClient(callLog));
      await user.click(screen.getByTestId(locators.inbox.respond.acceptButton));
      await screen.findByTestId(locators.inbox.respond.successState);
      expect(
        screen.getByTestId(locators.inbox.respond.nextOpenItem)
      ).toBeInTheDocument();
    });

    it("'Back to inbox' secondary button is visible in the success state", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      renderRespond(ESCALATION_ITEM, makeEscalationClient(callLog));
      await user.click(screen.getByTestId(locators.inbox.respond.acceptButton));
      await screen.findByTestId(locators.inbox.respond.successState);
      expect(
        screen.getByTestId(locators.inbox.respond.backToInbox)
      ).toBeInTheDocument();
    });

    it("does NOT auto-navigate after success (location unchanged)", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      renderRespond(ESCALATION_ITEM, makeEscalationClient(callLog));

      // Record location before respond
      const locationBefore = screen.getByTestId("test-location-display").textContent;

      await user.click(screen.getByTestId(locators.inbox.respond.acceptButton));
      await screen.findByTestId(locators.inbox.respond.successState);

      // Location must be unchanged — no auto-navigate
      const locationAfter = screen.getByTestId("test-location-display").textContent;
      expect(locationAfter).toBe(locationBefore);
    });

    it("clicking 'Next open item' navigates to the next open item under current sort", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      // OPEN_ITEMS sorted: [item-alpha, item-beta, item-zeta]
      // Respond to item-alpha → Next should be item-beta
      renderRespond(ESCALATION_ITEM, makeEscalationClient(callLog), OPEN_ITEMS);

      await user.click(screen.getByTestId(locators.inbox.respond.acceptButton));
      await screen.findByTestId(locators.inbox.respond.successState);

      await user.click(screen.getByTestId(locators.inbox.respond.nextOpenItem));

      // After navigating, the location should have changed to /inbox/item-beta
      await waitFor(() => {
        expect(
          screen.getByTestId("test-location-display")
        ).toHaveTextContent("/inbox/item-beta");
      });
    });

    it("'Next open item' text reads 'Next open item'", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      renderRespond(ESCALATION_ITEM, makeEscalationClient(callLog));
      await user.click(screen.getByTestId(locators.inbox.respond.acceptButton));
      await screen.findByTestId(locators.inbox.respond.successState);
      expect(
        screen.getByTestId(locators.inbox.respond.nextOpenItem)
      ).toHaveTextContent("Next open item");
    });

    it("'Back to inbox' text reads 'Back to inbox'", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      renderRespond(ESCALATION_ITEM, makeEscalationClient(callLog));
      await user.click(screen.getByTestId(locators.inbox.respond.acceptButton));
      await screen.findByTestId(locators.inbox.respond.successState);
      expect(
        screen.getByTestId(locators.inbox.respond.backToInbox)
      ).toHaveTextContent("Back to inbox");
    });
  });

  // ---------------------------------------------------------------------------
  // B3 — Accept must be blocked when no suggested category
  //
  // RED: the current Respond.tsx only disables Accept during "submitting";
  // it does NOT guard against an empty suggestedCategory.  Both tests below
  // fail until the SE adds the guard:
  //   disabled={responseState === "submitting" || !item.suggestedCategory}
  // ---------------------------------------------------------------------------
  describe("Accept guard — disabled when suggestedCategory is empty (B3)", () => {
    it("Accept button is disabled when suggestedCategory is empty", () => {
      const callLog: string[] = [];
      renderRespond(
        makeVM({ suggestedCategory: "" }),
        makeEscalationClient(callLog),
      );
      expect(
        screen.getByTestId(locators.inbox.respond.acceptButton)
      ).toBeDisabled();
    });

    it("clicking Accept with empty suggestedCategory does not call respondToEscalation", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      renderRespond(
        makeVM({ suggestedCategory: "" }),
        makeEscalationClient(callLog),
      );
      // The button must be disabled; a user-event click on a disabled button
      // is silently ignored, so callLog must remain empty.
      await user.click(screen.getByTestId(locators.inbox.respond.acceptButton));
      expect(callLog).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // S4 — Override Select item-click (polyfill smoke + full flow assertion)
  //
  // Proves that the jsdom polyfills (hasPointerCapture / scrollIntoView /
  // ResizeObserver) let userEvent drive the vendored Radix Select end-to-end
  // inside a component test:
  //   1. Click Override → category Select revealed
  //   2. Click SelectTrigger → SelectContent portal opens
  //   3. findByTestId waits for the portal item → click it
  //   4. Click Submit → respondToEscalation called with confirmedCategory
  // ---------------------------------------------------------------------------
  describe("Override path — category Select item-click (S4 polyfill smoke)", () => {
    it("selecting a category via the vendored Select and clicking Submit calls respondToEscalation with that confirmedCategory", async () => {
      const user = userEvent.setup();
      const calls: Array<{ confirmedCategory: string }> = [];
      const client = {
        respondToEscalation: async (req: { confirmedCategory: string }) => {
          calls.push({ confirmedCategory: req.confirmedCategory });
          return { status: "resolved" };
        },
      } as unknown as DaemonClient;

      renderRespond(ESCALATION_ITEM, client);

      // Step 1 — reveal the category select
      await user.click(screen.getByTestId(locators.inbox.respond.overrideTrigger));
      expect(
        screen.getByTestId(locators.inbox.respond.categorySelectTrigger)
      ).toBeInTheDocument();

      // Step 2 — open the Radix Select via its trigger
      await user.click(screen.getByTestId(locators.inbox.respond.categorySelectTrigger));

      // Step 3 — wait for portal item (SelectContent renders in a Radix portal)
      const correctionItem = await screen.findByTestId(
        locators.inbox.respond.categorySelectItem("correction")
      );
      await user.click(correctionItem);

      // Step 4 — Submit is now enabled; click it
      const submit = screen.getByTestId(locators.inbox.respond.submitButton);
      expect(submit).not.toBeDisabled();
      await user.click(submit);

      // Assert respond was called with the chosen category
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls.at(0)?.confirmedCategory).toBe("correction");
    });
  });
});

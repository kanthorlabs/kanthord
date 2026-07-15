/**
 * Story 001 T2 — DetailPage template tests.
 *
 * Asserts the DESIGN §6 DetailPage template:
 *   - breadcrumb slot renders the nav trail
 *   - tab triggers render for each tab definition (DESIGN §8 placement)
 *   - tab panels render for each tab definition (DESIGN §8 placement)
 *   - active tab panel content is visible; inactive panels are hidden (Radix Tabs)
 *
 * DESIGN §8 placement rule for Tabs:
 *   "each tab trigger and each tab panel (not the list wrapper)"
 *
 * Locators referenced (SE adds to registry):
 *   locators.detailPage.breadcrumb       — breadcrumb container
 *   locators.detailPage.tabTrigger(id)   — function returning testid for a trigger
 *   locators.detailPage.tabPanel(id)     — function returning testid for a panel
 *
 * RED: fails because DetailPage module does not exist yet and
 * locators.detailPage is not yet in the registry.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DetailPage } from "@/components/templates/DetailPage";
import { locators } from "@/locators";

const TWO_TAB_FIXTURE = {
  breadcrumb: [
    { label: "Features", href: "/features" },
    { label: "feat-001" },
  ],
  tabs: [
    {
      id: "plan",
      label: "Plan",
      content: <div>plan content</div>,
    },
    {
      id: "state",
      label: "State",
      content: <div>state content</div>,
    },
  ],
  defaultTab: "plan",
};

describe("DetailPage — DESIGN §6 template (breadcrumb + tabs)", () => {
  describe("breadcrumb slot", () => {
    it("renders the breadcrumb container", () => {
      render(<DetailPage {...TWO_TAB_FIXTURE} />);
      expect(
        screen.getByTestId(locators.detailPage.breadcrumb)
      ).toBeInTheDocument();
    });

    it("renders each breadcrumb label in the nav trail", () => {
      render(<DetailPage {...TWO_TAB_FIXTURE} />);
      const crumb = screen.getByTestId(locators.detailPage.breadcrumb);
      expect(crumb).toHaveTextContent("Features");
      expect(crumb).toHaveTextContent("feat-001");
    });
  });

  describe("tab triggers (DESIGN §8 — each tab trigger)", () => {
    it("renders a trigger for each tab with the correct testid", () => {
      render(<DetailPage {...TWO_TAB_FIXTURE} />);
      expect(
        screen.getByTestId(locators.detailPage.tabTrigger("plan"))
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(locators.detailPage.tabTrigger("state"))
      ).toBeInTheDocument();
    });

    it("tab trigger text matches the tab label", () => {
      render(<DetailPage {...TWO_TAB_FIXTURE} />);
      expect(
        screen.getByTestId(locators.detailPage.tabTrigger("plan"))
      ).toHaveTextContent("Plan");
      expect(
        screen.getByTestId(locators.detailPage.tabTrigger("state"))
      ).toHaveTextContent("State");
    });
  });

  describe("tab panels (DESIGN §8 — each tab panel)", () => {
    it("renders a panel for each tab with the correct testid", () => {
      render(<DetailPage {...TWO_TAB_FIXTURE} />);
      // Both panels are in the DOM (Radix Tabs renders all panels, hides inactive)
      expect(
        screen.getByTestId(locators.detailPage.tabPanel("plan"))
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(locators.detailPage.tabPanel("state"))
      ).toBeInTheDocument();
    });

    it("the default tab panel content is visible on initial render", () => {
      render(<DetailPage {...TWO_TAB_FIXTURE} />);
      const planPanel = screen.getByTestId(locators.detailPage.tabPanel("plan"));
      expect(planPanel).toHaveTextContent("plan content");
    });

    it("clicking a different tab trigger makes that panel's content visible", async () => {
      const user = userEvent.setup();
      render(<DetailPage {...TWO_TAB_FIXTURE} />);

      await user.click(screen.getByTestId(locators.detailPage.tabTrigger("state")));
      // After clicking "state", the state panel content is visible
      const statePanel = screen.getByTestId(locators.detailPage.tabPanel("state"));
      expect(statePanel).toHaveTextContent("state content");
    });
  });
});

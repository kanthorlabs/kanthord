/**
 * Story 000 T4 — AppRouter component tests.
 * Uses react-router-dom v6 MemoryRouter (hermetic, no daemon).
 * Asserts: (a) each of the six nav areas has a route in routes.ts, and
 * rendering at that path mounts the area's placeholder; (b) activating a nav
 * item changes the URL to that area's path.
 *
 * AppRouter renders Routes + AppShell (no built-in BrowserRouter); tests wrap
 * it in MemoryRouter. AppShell uses Sidebar → useIsMobile → window.matchMedia;
 * matchMedia is mocked to desktop before each test.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRouter } from "@/app/AppRouter";
import { ROUTES } from "@/app/routes";
import { locators } from "@/locators";

// matchMedia mock — required because AppShell → Sidebar → useIsMobile calls it.
function setupDesktopMedia() {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("AppRouter — route foundation (Story 000 T4)", () => {
  beforeEach(() => {
    setupDesktopMedia();
  });

  // (a) routes.ts defines all six area paths + auth-required path

  describe("routes.ts — path constants", () => {
    it("exports a path for each of the six nav areas", () => {
      const areas = [
        "features",
        "inbox",
        "broker",
        "slots",
        "budgets",
        "ops",
      ] as const;
      for (const area of areas) {
        expect(ROUTES[area]).toMatch(/^\//);
      }
    });

    it("exports an authRequired path", () => {
      expect(ROUTES.authRequired).toMatch(/^\//);
    });
  });

  // (a) rendering at each area path mounts that area's placeholder

  describe("area routes — placeholder rendering", () => {
    it("renders the features placeholder at the features path", () => {
      render(
        <MemoryRouter initialEntries={[ROUTES.features]}>
          <AppRouter />
        </MemoryRouter>
      );
      expect(
        screen.getByTestId(locators.features.placeholder)
      ).toBeInTheDocument();
    });

    it("renders the inbox placeholder at the inbox path", () => {
      render(
        <MemoryRouter initialEntries={[ROUTES.inbox]}>
          <AppRouter />
        </MemoryRouter>
      );
      expect(
        screen.getByTestId(locators.inbox.placeholder)
      ).toBeInTheDocument();
    });

    it("renders the broker placeholder at the broker path", () => {
      render(
        <MemoryRouter initialEntries={[ROUTES.broker]}>
          <AppRouter />
        </MemoryRouter>
      );
      expect(
        screen.getByTestId(locators.broker.placeholder)
      ).toBeInTheDocument();
    });

    it("renders the slots placeholder at the slots path", () => {
      render(
        <MemoryRouter initialEntries={[ROUTES.slots]}>
          <AppRouter />
        </MemoryRouter>
      );
      expect(
        screen.getByTestId(locators.slots.placeholder)
      ).toBeInTheDocument();
    });

    it("renders the budgets placeholder at the budgets path", () => {
      render(
        <MemoryRouter initialEntries={[ROUTES.budgets]}>
          <AppRouter />
        </MemoryRouter>
      );
      expect(
        screen.getByTestId(locators.budgets.placeholder)
      ).toBeInTheDocument();
    });

    it("renders the ops placeholder at the ops path", () => {
      render(
        <MemoryRouter initialEntries={[ROUTES.ops]}>
          <AppRouter />
        </MemoryRouter>
      );
      expect(
        screen.getByTestId(locators.ops.placeholder)
      ).toBeInTheDocument();
    });
  });

  // (b) activating a nav item changes the URL (observed via rendered placeholder)

  describe("nav-item activation changes the URL", () => {
    it("clicking the inbox nav item navigates from features to inbox", () => {
      render(
        <MemoryRouter initialEntries={[ROUTES.features]}>
          <AppRouter />
        </MemoryRouter>
      );

      // Start at features: features placeholder visible, inbox not
      expect(
        screen.getByTestId(locators.features.placeholder)
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId(locators.inbox.placeholder)
      ).not.toBeInTheDocument();

      // Activate the inbox nav item
      fireEvent.click(screen.getByTestId(locators.appShell.navItem("inbox")));

      // URL changed to inbox: inbox placeholder now visible
      expect(
        screen.getByTestId(locators.inbox.placeholder)
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId(locators.features.placeholder)
      ).not.toBeInTheDocument();
    });

    it("clicking the broker nav item navigates to broker", () => {
      render(
        <MemoryRouter initialEntries={[ROUTES.features]}>
          <AppRouter />
        </MemoryRouter>
      );
      fireEvent.click(screen.getByTestId(locators.appShell.navItem("broker")));
      expect(
        screen.getByTestId(locators.broker.placeholder)
      ).toBeInTheDocument();
    });
  });
});

/**
 * Story 000 T2 — AppShell component tests.
 * Asserts: six nav areas, header region, content region, placeholder child
 * rendering, mobile media-state behavior (matchMedia seam via useIsMobile),
 * nav count badge (Input 6), and mobile collapsed-toggle indicator (Input 6).
 * All elements selected via the locator registry (DESIGN §8).
 *
 * matchMedia seam: jsdom 29.x does not implement window.matchMedia; every test
 * group that renders AppShell mocks it before rendering (desktop default in
 * beforeEach; mobile tests override innerWidth + matchMedia return value).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { locators } from "@/locators";

// All six nav area keys in order (matches AppShell AC)
const NAV_AREAS = [
  "features",
  "inbox",
  "broker",
  "slots",
  "budgets",
  "ops",
] as const;

// --- matchMedia helpers ---

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

function setupMobileMedia() {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: 390, // iPhone 13 width — DESIGN §6 reference phone device
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: true,
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

// AppShell requires a router context for nav Links.
function renderShell(props: { navCounts?: Record<string, number>; children?: React.ReactNode } = {}) {
  return render(
    <MemoryRouter>
      <AppShell navCounts={props.navCounts}>
        {props.children ?? <div data-testid="placeholder-child">content</div>}
      </AppShell>
    </MemoryRouter>
  );
}

describe("AppShell (DESIGN §6 — shell, nav, count badge, mobile)", () => {
  beforeEach(() => {
    // Default to desktop so non-mobile tests never hit the matchMedia absence.
    setupDesktopMedia();
  });

  // --- §6 layout ---

  describe("desktop — six nav areas and layout regions", () => {
    it("renders all six nav areas (Features, Inbox, Broker, Slots, Budgets, Ops)", () => {
      renderShell();
      for (const area of NAV_AREAS) {
        expect(
          screen.getByTestId(locators.appShell.navItem(area))
        ).toBeInTheDocument();
      }
    });

    it("renders the header region", () => {
      renderShell();
      expect(screen.getByTestId(locators.appShell.header)).toBeInTheDocument();
    });

    it("mounts children inside the content region", () => {
      renderShell({ children: <div data-testid="my-child">hello</div> });
      expect(screen.getByTestId(locators.appShell.content)).toBeInTheDocument();
      expect(screen.getByTestId("my-child")).toBeInTheDocument();
    });
  });

  // --- Input 6: nav count badge ---

  describe("nav count badge (Input 6)", () => {
    it("renders a count badge on a nav item that has a nonzero count", () => {
      renderShell({ navCounts: { inbox: 3 } });
      const badge = screen.getByTestId(locators.appShell.navBadge);
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("3");
    });

    it("renders no badge when the count for that item is zero", () => {
      renderShell({ navCounts: { inbox: 0 } });
      expect(
        screen.queryByTestId(locators.appShell.navBadge)
      ).not.toBeInTheDocument();
    });

    it("renders no badge when navCounts is absent", () => {
      renderShell();
      expect(
        screen.queryByTestId(locators.appShell.navBadge)
      ).not.toBeInTheDocument();
    });
  });

  // --- Input 6: mobile off-canvas sidebar ---

  describe("mobile — off-canvas sidebar via matchMedia seam (DESIGN §6)", () => {
    it("opens the mobile nav via the menu toggle; all six areas become selectable", async () => {
      setupMobileMedia();
      renderShell();

      // Flush the useIsMobile useEffect (sets isMobile=true after initial render)
      await act(async () => {});

      // Mobile toggle is always rendered in the header
      const toggle = screen.getByTestId(locators.appShell.mobileToggle);

      // Click opens the off-canvas Sheet (Sidebar mobile variant)
      fireEvent.click(toggle);

      // After the sheet opens, all six nav items must be accessible
      for (const area of NAV_AREAS) {
        expect(
          await screen.findByTestId(locators.appShell.navItem(area))
        ).toBeInTheDocument();
      }
    });

    it("shows the mobile indicator when any nav item has a nonzero count", async () => {
      setupMobileMedia();
      renderShell({ navCounts: { inbox: 5 } });
      await act(async () => {});
      expect(
        await screen.findByTestId(locators.appShell.mobileIndicator)
      ).toBeInTheDocument();
    });

    it("shows no mobile indicator when all counts are zero", async () => {
      setupMobileMedia();
      renderShell({ navCounts: { inbox: 0 } });
      await act(async () => {});
      // Give React time to settle before asserting absence
      await screen.findByTestId(locators.appShell.mobileToggle);
      expect(
        screen.queryByTestId(locators.appShell.mobileIndicator)
      ).not.toBeInTheDocument();
    });

    it("shows no mobile indicator when navCounts is absent", async () => {
      setupMobileMedia();
      renderShell();
      await act(async () => {});
      await screen.findByTestId(locators.appShell.mobileToggle);
      expect(
        screen.queryByTestId(locators.appShell.mobileIndicator)
      ).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// S1 regression — orphaned appShell.nav locator
//
// Reviewer finding: locators.appShell.nav ("app-shell-nav") is defined in the
// registry but never placed on any element in AppShell. The nav root must
// carry data-testid={locators.appShell.nav}.
// ---------------------------------------------------------------------------

describe("S1 regression — appShell.nav testid placed on nav root (DESIGN §8)", () => {
  it("nav root element carries data-testid={locators.appShell.nav}", () => {
    renderShell();
    // Fails because no element in AppShell currently has this testid.
    expect(screen.getByTestId(locators.appShell.nav)).toBeInTheDocument();
  });
});

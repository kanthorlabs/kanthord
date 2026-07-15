/**
 * Story 000 T4 — RequireAuth component tests.
 * Uses react-router-dom v6 MemoryRouter + Routes (hermetic, no daemon).
 *
 * Asserts:
 * (c) RequireAuth with isAuthenticated=false redirects a protected deep link
 *     to the auth-required route AND preserves the original target in
 *     location.state.from.
 * (d) RequireAuth with isAuthenticated=true, when location.state carries a
 *     `from` target (left by the prior redirect), resolves to that original
 *     target — not the nav root.
 *
 * Auth-state seam: RequireAuth accepts an `isAuthenticated: boolean` prop so
 * the test can stub each state hermetically without a real auth source.
 * Story 001 supplies the real auth source and the auth-required screen content.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { RequireAuth } from "@/app/RequireAuth";
import { ROUTES } from "@/app/routes";

// Helper: captures current location.state inside the router context.
function LocationStateCapture({ onState }: { onState: (s: unknown) => void }) {
  const { state } = useLocation();
  onState(state);
  return null;
}

// Helper: captures the full Location object (search + hash included).
function FullLocationCapture({
  onLocation,
}: {
  onLocation: (loc: { search: string; hash: string }) => void;
}) {
  const loc = useLocation();
  onLocation(loc);
  return null;
}

describe("RequireAuth — auth-redirect preservation (Story 000 T4)", () => {
  // (c) unauthenticated → redirects + preserves from ---

  describe("unauthenticated state", () => {
    it("redirects to the auth-required route when not authenticated", () => {
      render(
        <MemoryRouter initialEntries={[ROUTES.features]}>
          <Routes>
            <Route
              path={ROUTES.features}
              element={
                <RequireAuth isAuthenticated={false}>
                  <div data-testid="protected-content">Features</div>
                </RequireAuth>
              }
            />
            <Route
              path={ROUTES.authRequired}
              element={<div data-testid="auth-page">Auth Required</div>}
            />
          </Routes>
        </MemoryRouter>
      );

      // Protected content must NOT render — redirected away
      expect(
        screen.queryByTestId("protected-content")
      ).not.toBeInTheDocument();
      // Auth-required route IS rendered
      expect(screen.getByTestId("auth-page")).toBeInTheDocument();
    });

    it("preserves the original target pathname in the redirect location state", () => {
      let capturedState: unknown = undefined;

      render(
        <MemoryRouter initialEntries={[ROUTES.features]}>
          <Routes>
            <Route
              path={ROUTES.features}
              element={
                <RequireAuth isAuthenticated={false}>
                  <div data-testid="protected-content">Features</div>
                </RequireAuth>
              }
            />
            <Route
              path={ROUTES.authRequired}
              element={
                <LocationStateCapture onState={(s) => { capturedState = s; }} />
              }
            />
          </Routes>
        </MemoryRouter>
      );

      // The redirect state must carry `from` with the original target
      expect(capturedState).toBeTruthy();
      const from = (capturedState as { from: { pathname: string } }).from;
      expect(from).toBeTruthy();
      // The preserved target matches the original protected path
      expect(from.pathname).toBe(ROUTES.features);
    });
  });

  // (d) authenticated after redirect → resolves to original target ---

  describe("authenticated state with redirect context (from state)", () => {
    it("resolves to the original target, not the nav root, when isAuthenticated=true and from state present", () => {
      render(
        <MemoryRouter
          initialEntries={[
            {
              pathname: ROUTES.authRequired,
              state: { from: { pathname: ROUTES.features } },
            },
          ]}
        >
          <Routes>
            {/*
             * RequireAuth at the auth route: when authenticated AND from state
             * is present, it redirects to the original target instead of
             * rendering the auth-page content (the restore mechanism).
             */}
            <Route
              path={ROUTES.authRequired}
              element={
                <RequireAuth isAuthenticated={true}>
                  <div data-testid="auth-page-content">Sign in</div>
                </RequireAuth>
              }
            />
            <Route
              path={ROUTES.features}
              element={
                <div data-testid="features-placeholder">Features</div>
              }
            />
          </Routes>
        </MemoryRouter>
      );

      // Auth-page content must NOT render — redirected to original target
      expect(
        screen.queryByTestId("auth-page-content")
      ).not.toBeInTheDocument();
      // Original target (features) IS rendered
      expect(
        screen.getByTestId("features-placeholder")
      ).toBeInTheDocument();
    });

    it("renders children normally when authenticated and no from state present", () => {
      render(
        <MemoryRouter initialEntries={[ROUTES.features]}>
          <Routes>
            <Route
              path={ROUTES.features}
              element={
                <RequireAuth isAuthenticated={true}>
                  <div data-testid="features-content">Features page</div>
                </RequireAuth>
              }
            />
          </Routes>
        </MemoryRouter>
      );

      // Authenticated with no redirect state → renders children as-is
      expect(screen.getByTestId("features-content")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// S2 regression — RequireAuth full-location preservation (search + hash)
//
// Reviewer finding: RequireAuth only preserves .pathname when restoring the
// post-auth destination; .search and .hash are silently dropped. Both the
// forward pass (redirect state) and the restore pass must carry the full target.
// ---------------------------------------------------------------------------

describe("S2 regression — RequireAuth full-location preservation (search + hash)", () => {
  it("preserves search and hash in state.from when redirecting an unauthenticated deep link", () => {
    // Deep link with both query string and hash fragment
    const deepLink = `${ROUTES.features}?tab=timeline#task-3`;
    let capturedState: unknown = undefined;

    render(
      <MemoryRouter initialEntries={[deepLink]}>
        <Routes>
          <Route
            path={ROUTES.features}
            element={
              <RequireAuth isAuthenticated={false}>
                <div data-testid="protected-s2a">Features</div>
              </RequireAuth>
            }
          />
          <Route
            path={ROUTES.authRequired}
            element={
              <LocationStateCapture onState={(s) => { capturedState = s; }} />
            }
          />
        </Routes>
      </MemoryRouter>
    );

    // The redirect must carry the full location — including search and hash —
    // in state.from so the post-auth restore can use them.
    const from = (
      capturedState as { from: { pathname: string; search: string; hash: string } }
    ).from;
    expect(from).toBeTruthy();
    expect(from.search).toBe("?tab=timeline");
    expect(from.hash).toBe("#task-3");
  });

  it("restores search and hash (not only pathname) when authenticated with from state carrying them", () => {
    // This is the failing case: current implementation navigates to
    // stateFrom.pathname only, dropping search and hash.
    let capturedSearch = "";
    let capturedHash = "";

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: ROUTES.authRequired,
            state: {
              from: {
                pathname: ROUTES.features,
                search: "?tab=timeline",
                hash: "#task-3",
              },
            },
          },
        ]}
      >
        <Routes>
          <Route
            path={ROUTES.authRequired}
            element={
              <RequireAuth isAuthenticated={true}>
                <div data-testid="auth-page-s2b">Sign in</div>
              </RequireAuth>
            }
          />
          <Route
            path={ROUTES.features}
            element={
              <FullLocationCapture
                onLocation={(loc) => {
                  capturedSearch = loc.search;
                  capturedHash = loc.hash;
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    );

    // RequireAuth must restore the full original target — navigate with search
    // and hash, not only pathname. Fails when Navigate uses stateFrom.pathname only.
    expect(capturedSearch).toBe("?tab=timeline");
    expect(capturedHash).toBe("#task-3");
  });
});

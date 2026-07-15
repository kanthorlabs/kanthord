/**
 * Story 001 T4 — AuthRequired screen + auth-wired RequireAuth tests.
 *
 * Asserts:
 *   (b) AuthRequired renders the DESIGN §7 auth-required pattern via
 *       locators.auth.required; shows no feature/surface data.
 *   (c) With unauthenticated AuthProvider state, a protected surface renders
 *       AuthRequired via Story 000 RequireAuth — never a cached surface.
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because AuthRequired and AuthProvider modules do not exist yet
 * and locators.auth.required is not yet in the registry.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectError, Code } from "@connectrpc/connect";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { AuthRequired } from "@/auth/AuthRequired";
import { RequireAuth } from "@/app/RequireAuth";
import { ROUTES } from "@/app/routes";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Fake clients
// ---------------------------------------------------------------------------

function makeUnauthClient(): DaemonClient {
  return new Proxy(
    {},
    {
      get() {
        return async () => {
          throw new ConnectError("unauthenticated", Code.Unauthenticated);
        };
      },
    }
  ) as unknown as DaemonClient;
}

function makeSuccessClient(): DaemonClient {
  return new Proxy(
    {},
    { get() { return async () => ({}); } }
  ) as unknown as DaemonClient;
}

// ---------------------------------------------------------------------------
// Test helper — wires RequireAuth to useAuth (the connection Story 001 adds)
// ---------------------------------------------------------------------------

function ConnectedRequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  return (
    <RequireAuth isAuthenticated={auth.status === "authenticated"}>
      {children}
    </RequireAuth>
  );
}

// ---------------------------------------------------------------------------
// (b) AuthRequired screen
// ---------------------------------------------------------------------------

describe("AuthRequired screen — DESIGN §7 auth-required pattern (T4b)", () => {
  it("renders the auth-required testid (DESIGN §7 auth-required screen)", () => {
    render(<AuthRequired />);
    expect(
      screen.getByTestId(locators.auth.required)
    ).toBeInTheDocument();
  });

  it("shows no feature-surface data — no features list row present", () => {
    render(<AuthRequired />);
    // The auth-required screen must never render feature content
    expect(
      screen.queryByTestId(locators.features.list.row)
    ).not.toBeInTheDocument();
  });

  it("shows no feature-surface data — no feature detail section present", () => {
    render(<AuthRequired />);
    expect(
      screen.queryByTestId(locators.features.detail.tasks)
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// (c) Unauthenticated AuthProvider + RequireAuth → renders AuthRequired
// ---------------------------------------------------------------------------

describe("RequireAuth wired to AuthProvider — unauthenticated → AuthRequired (T4c)", () => {
  it("renders AuthRequired (not the protected surface) when auth is unauthenticated", async () => {
    render(
      <AuthProvider client={makeUnauthClient()}>
        <MemoryRouter initialEntries={[ROUTES.features]}>
          <Routes>
            <Route
              path={ROUTES.features}
              element={
                <ConnectedRequireAuth>
                  <div data-testid="protected-features">Features content</div>
                </ConnectedRequireAuth>
              }
            />
            <Route
              path={ROUTES.authRequired}
              element={<AuthRequired />}
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    // Wait for the auth probe to resolve (unauthenticated) then redirect
    await screen.findByTestId(locators.auth.required);
    expect(
      screen.getByTestId(locators.auth.required)
    ).toBeInTheDocument();
  });

  it("does NOT render the protected surface when auth is unauthenticated", async () => {
    render(
      <AuthProvider client={makeUnauthClient()}>
        <MemoryRouter initialEntries={[ROUTES.features]}>
          <Routes>
            <Route
              path={ROUTES.features}
              element={
                <ConnectedRequireAuth>
                  <div data-testid="protected-features">Features content</div>
                </ConnectedRequireAuth>
              }
            />
            <Route
              path={ROUTES.authRequired}
              element={<AuthRequired />}
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    await screen.findByTestId(locators.auth.required);
    expect(
      screen.queryByTestId("protected-features")
    ).not.toBeInTheDocument();
  });

  it("renders the protected surface (not AuthRequired) when auth is authenticated", async () => {
    render(
      <AuthProvider client={makeSuccessClient()}>
        <MemoryRouter initialEntries={[ROUTES.features]}>
          <Routes>
            <Route
              path={ROUTES.features}
              element={
                <ConnectedRequireAuth>
                  <div data-testid="protected-features">Features content</div>
                </ConnectedRequireAuth>
              }
            />
            <Route
              path={ROUTES.authRequired}
              element={<AuthRequired />}
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    await screen.findByTestId("protected-features");
    expect(screen.getByTestId("protected-features")).toBeInTheDocument();
    expect(
      screen.queryByTestId(locators.auth.required)
    ).not.toBeInTheDocument();
  });
});

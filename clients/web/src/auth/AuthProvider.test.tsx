/**
 * Story 001 T4 — AuthProvider component tests.
 *
 * AuthProvider derives authenticated state by making a probe call on the
 * injected client. Tests use a Proxy-based fake that either resolves or
 * rejects ALL methods — this is intentionally method-agnostic so the SE
 * can pick any probe endpoint without invalidating the tests.
 *
 * Asserts:
 *   (a) probe resolves → useAuth() reports { status: "authenticated" }
 *   (b) probe rejects with Connect Code.Unauthenticated →
 *         useAuth() reports { status: "unauthenticated" }
 *   (c) probe rejects with any other error →
 *         useAuth() reports { status: "error" }, NOT "authenticated" or
 *         "unauthenticated" (never silently grants access on arbitrary errors)
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because AuthProvider module and useAuth hook do not exist yet.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectError, Code } from "@connectrpc/connect";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import type { DaemonClient } from "@/lib/client";

// ---------------------------------------------------------------------------
// Fake-client factories (Proxy-based — method-agnostic)
// ---------------------------------------------------------------------------

/** Every method resolves with an empty object. */
function makeSuccessClient(): DaemonClient {
  return new Proxy(
    {},
    {
      get() {
        return async () => ({});
      },
    }
  ) as unknown as DaemonClient;
}

/** Every method rejects with ConnectError(Unauthenticated). */
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

/** Every method rejects with a plain network error (NOT Connect Unauthenticated). */
function makeOtherErrorClient(): DaemonClient {
  return new Proxy(
    {},
    {
      get() {
        return async () => {
          throw new Error("ECONNREFUSED — network error");
        };
      },
    }
  ) as unknown as DaemonClient;
}

// ---------------------------------------------------------------------------
// Helper component — reads auth state and renders it as text
// ---------------------------------------------------------------------------

function AuthStateReadout() {
  const auth = useAuth();
  return <div data-testid="auth-state-readout">{auth.status}</div>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthProvider — authenticated state from probe call (Story 001 T4a)", () => {
  it("reports authenticated when the probe call resolves", async () => {
    render(
      <AuthProvider client={makeSuccessClient()}>
        <AuthStateReadout />
      </AuthProvider>
    );
    // Wait for the async probe to complete
    const readout = await screen.findByTestId("auth-state-readout");
    // Must settle at "authenticated" — not "loading" or "error"
    expect(readout).toHaveTextContent(/^authenticated$/);
  });

  it("shows a loading/pending state before the probe settles", () => {
    // Use a never-resolving client so the probe stays in flight
    const hangingClient = new Proxy(
      {},
      { get() { return () => new Promise(() => {}); } }
    ) as unknown as DaemonClient;

    render(
      <AuthProvider client={hangingClient}>
        <AuthStateReadout />
      </AuthProvider>
    );
    const readout = screen.getByTestId("auth-state-readout");
    // Must NOT report "authenticated" before the probe has resolved
    expect(readout).not.toHaveTextContent(/^authenticated$/);
  });
});

describe("AuthProvider — unauthenticated state from Connect Unauthenticated error (T4b)", () => {
  it("reports unauthenticated when probe rejects with Connect Code.Unauthenticated", async () => {
    render(
      <AuthProvider client={makeUnauthClient()}>
        <AuthStateReadout />
      </AuthProvider>
    );
    const readout = await screen.findByTestId("auth-state-readout");
    expect(readout).toHaveTextContent(/^unauthenticated$/);
  });

  it("does NOT report authenticated when probe rejects with Unauthenticated", async () => {
    render(
      <AuthProvider client={makeUnauthClient()}>
        <AuthStateReadout />
      </AuthProvider>
    );
    const readout = await screen.findByTestId("auth-state-readout");
    expect(readout).not.toHaveTextContent(/^authenticated$/);
  });
});

describe("AuthProvider — error state for non-Unauthenticated probe failure (T4c)", () => {
  it("reports error when probe rejects with a non-Connect error", async () => {
    render(
      <AuthProvider client={makeOtherErrorClient()}>
        <AuthStateReadout />
      </AuthProvider>
    );
    const readout = await screen.findByTestId("auth-state-readout");
    expect(readout).toHaveTextContent("error");
  });

  it("does NOT report authenticated when probe rejects with a non-Connect error", async () => {
    render(
      <AuthProvider client={makeOtherErrorClient()}>
        <AuthStateReadout />
      </AuthProvider>
    );
    const readout = await screen.findByTestId("auth-state-readout");
    expect(readout).not.toHaveTextContent(/^authenticated$/);
  });

  it("does NOT report unauthenticated when probe rejects with a non-Connect error", async () => {
    // A non-Unauthenticated error must result in "error", never "unauthenticated".
    // This guards against catch-all handlers that conflate error kinds.
    render(
      <AuthProvider client={makeOtherErrorClient()}>
        <AuthStateReadout />
      </AuthProvider>
    );
    const readout = await screen.findByTestId("auth-state-readout");
    expect(readout).not.toHaveTextContent(/^unauthenticated$/);
  });
});

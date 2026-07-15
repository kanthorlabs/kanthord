/**
 * AuthProvider — derives auth state by probing the injected Connect-Web
 * client (Story 001 T4a–c).
 *
 * Probe is method-agnostic from the test's perspective (tests supply a Proxy
 * that intercepts all calls). Internally we probe listFeatures({}) as a
 * lightweight read that requires a valid authenticated session.
 *
 * States:
 *   loading        — probe in flight (initial)
 *   authenticated  — probe resolved successfully
 *   unauthenticated — probe rejected with ConnectError Code.Unauthenticated
 *   error          — probe rejected with any other error
 *
 * AuthContext is exported so RequireAuth can read it via useContext without
 * calling useAuth() (which throws outside a provider), enabling the
 * "no-redirect during loading" pattern.
 */
import { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { ConnectError, Code } from "@connectrpc/connect";
import type { DaemonClient } from "@/lib/client";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";

export interface AuthState {
  status: AuthStatus;
}

/**
 * AuthContext — null when no AuthProvider is in the tree (consumed by
 * RequireAuth to distinguish "no provider" from "loading").
 */
export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

export function AuthProvider({
  client,
  children,
}: {
  client: DaemonClient;
  children: ReactNode;
}) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    client
      .listFeatures({})
      .then(() => {
        if (!cancelled) setState({ status: "authenticated" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ConnectError && err.code === Code.Unauthenticated) {
          setState({ status: "unauthenticated" });
        } else {
          setState({ status: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

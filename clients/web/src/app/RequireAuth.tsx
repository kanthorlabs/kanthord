/**
 * RequireAuth — auth-redirect preservation guard (Story 000 T4, Input 5).
 *
 * Unauthenticated: redirects to ROUTES.authRequired carrying the original
 * location as state.from, so the post-auth flow can restore it.
 *
 * Authenticated + from state present: redirects back to the original target.
 *
 * Authenticated + no from state: renders children as-is.
 *
 * Auth-state seam: `isAuthenticated` prop is injected so tests can stub
 * either state hermetically. Story 001 supplies the real auth source via
 * AuthContext.
 *
 * Story 001 wiring: if this component is rendered inside an AuthProvider, it
 * reads the auth context directly. When the context reports "loading", it
 * renders null (no redirect) so the probe can settle before a decision is
 * made. Once the probe settles, the context provides a definitive answer that
 * overrides the prop. When there is no AuthProvider in the tree, the context
 * is null and the prop governs behaviour — keeping Story 000 tests green.
 */
import { useContext } from "react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ROUTES } from "@/app/routes";
import { AuthContext } from "@/auth/AuthProvider";

interface RequireAuthProps {
  isAuthenticated: boolean;
  children: ReactNode;
}

export function RequireAuth({ isAuthenticated, children }: RequireAuthProps) {
  // Reads AuthContext directly (null when no provider in tree).
  // useAuth() would throw outside a provider, so we use useContext instead.
  const authCtx = useContext(AuthContext);
  const location = useLocation();

  // Inside an AuthProvider that is still probing: suspend rendering until the
  // probe settles. Returning null avoids a premature redirect that would send
  // an eventually-authenticated user to the auth-required route with no way
  // back (the /auth route renders AuthRequired, not ConnectedRequireAuth).
  if (authCtx !== null && authCtx.status === "loading") {
    return null;
  }

  // Determine the effective auth flag:
  //   - If a definitive AuthContext result exists, use it.
  //   - Otherwise (no provider in tree, e.g. Story 000 tests), use the prop.
  const effectiveIsAuthenticated =
    authCtx !== null ? authCtx.status === "authenticated" : isAuthenticated;

  if (!effectiveIsAuthenticated) {
    return (
      <Navigate to={ROUTES.authRequired} state={{ from: location }} replace />
    );
  }

  // When authenticated and a `from` target was preserved (i.e. we arrived
  // here via the auth redirect), bounce back to the original target carrying
  // the full location (pathname + search + hash) per the S2 requirement.
  const stateFrom = (
    location.state as {
      from?: { pathname: string; search?: string; hash?: string };
    } | null
  )?.from;
  if (stateFrom) {
    return <Navigate to={stateFrom} replace />;
  }

  return <>{children}</>;
}

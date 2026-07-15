/**
 * AppRouter — wires the six area routes into AppShell (Story 000 T4).
 * Does NOT include its own BrowserRouter; the caller provides the router
 * context (BrowserRouter in main.tsx, MemoryRouter in tests).
 *
 * Routes mount the container-owned dashboard surfaces inside the shell.
 */
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { AuthContext } from "@/auth/AuthProvider";
import { FeatureListContainer } from "@/features/FeatureListContainer";
import { FeatureDetailContainer } from "@/features/FeatureDetailContainer";
import { InboxContainer } from "@/inbox/InboxContainer";
import { InboxItemContainer } from "@/inbox/InboxItemContainer";
import { BrokerContainer } from "@/broker/BrokerContainer";
import { RepoSlotsContainer } from "@/slots/RepoSlotsContainer";
import { BudgetsContainer } from "@/budgets/BudgetsContainer";
import { DaemonOpsContainer } from "@/daemon-ops/DaemonOpsContainer";
import { AuthRequired } from "@/auth/AuthRequired";
import { RequireAuth } from "@/app/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { locators } from "@/locators";
import { ROUTES } from "@/app/routes";

export function AppRouter() {
  const client = useDaemonClient();
  const auth = useContext(AuthContext);
  const requestVersion = useRef(0);
  const [inboxCount, setInboxCount] = useState<number | undefined>();
  const [inboxCountError, setInboxCountError] = useState<string | undefined>();
  const canReadInboxCount = auth === null || auth.status === "authenticated";

  const refreshInboxCount = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!canReadInboxCount) {
      setInboxCount(undefined);
      setInboxCountError(undefined);
      return;
    }

    try {
      const result = await client.listInboxItems({});
      if (version === requestVersion.current) {
        setInboxCount(result.items.filter((item) => item.status === "open").length);
        setInboxCountError(undefined);
      }
    } catch (reason: unknown) {
      if (version === requestVersion.current) {
        setInboxCount(undefined);
        setInboxCountError(reason instanceof Error ? reason.message : String(reason));
      }
      throw reason;
    }
  }, [canReadInboxCount, client]);

  useEffect(() => {
    void refreshInboxCount().catch(() => undefined);
    return () => {
      requestVersion.current += 1;
    };
  }, [refreshInboxCount]);

  return (
    <AppShell navCounts={inboxCount === undefined ? undefined : { inbox: inboxCount }}>
      {inboxCountError !== undefined && (
        <Alert variant="destructive" data-testid={locators.appShell.navCountError}>
          <AlertDescription>{inboxCountError}</AlertDescription>
        </Alert>
      )}
      <Routes>
        <Route path="/" element={<Navigate to={ROUTES.features} replace />} />
        <Route path={ROUTES.features} element={<RequireAuth isAuthenticated><FeatureListContainer /></RequireAuth>} />
        <Route path={ROUTES.featureDetail} element={<RequireAuth isAuthenticated><FeatureDetailContainer /></RequireAuth>} />
        <Route path={ROUTES.inbox} element={<RequireAuth isAuthenticated><InboxContainer /></RequireAuth>} />
        <Route path={ROUTES.inboxItem} element={<RequireAuth isAuthenticated><InboxItemContainer onInboxChanged={refreshInboxCount} /></RequireAuth>} />
        <Route path={ROUTES.broker} element={<RequireAuth isAuthenticated><BrokerContainer /></RequireAuth>} />
        <Route path={ROUTES.slots} element={<RequireAuth isAuthenticated><RepoSlotsContainer /></RequireAuth>} />
        <Route path={ROUTES.budgets} element={<RequireAuth isAuthenticated><BudgetsContainer /></RequireAuth>} />
        <Route path={ROUTES.ops} element={<RequireAuth isAuthenticated><DaemonOpsContainer /></RequireAuth>} />
        <Route path={ROUTES.authRequired} element={<AuthRoute />} />
      </Routes>
    </AppShell>
  );
}

function AuthRoute() {
  const auth = useContext(AuthContext);
  const location = useLocation();
  const from = (location.state as {
    from?: { pathname: string; search?: string; hash?: string };
  } | null)?.from;

  if (
    auth?.status === "authenticated"
    && from !== undefined
    && from.pathname !== ROUTES.authRequired
  ) {
    return <Navigate to={from} replace />;
  }

  return <AuthRequired />;
}

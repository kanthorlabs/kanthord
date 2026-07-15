/**
 * AppRouter — wires the six area routes into AppShell (Story 000 T4).
 * Does NOT include its own BrowserRouter; the caller provides the router
 * context (BrowserRouter in main.tsx, MemoryRouter in tests).
 *
 * Each area registers a placeholder element here; real surfaces come from
 * Stories 001–007 which replace these placeholders on their routes.
 */
import { Routes, Route } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { ROUTES } from "@/app/routes";
import { locators } from "@/locators";

export function AppRouter() {
  return (
    <AppShell>
      <Routes>
        <Route
          path={ROUTES.features}
          element={<div data-testid={locators.features.placeholder} />}
        />
        <Route
          path={ROUTES.inbox}
          element={<div data-testid={locators.inbox.placeholder} />}
        />
        <Route
          path={ROUTES.broker}
          element={<div data-testid={locators.broker.placeholder} />}
        />
        <Route
          path={ROUTES.slots}
          element={<div data-testid={locators.slots.placeholder} />}
        />
        <Route
          path={ROUTES.budgets}
          element={<div data-testid={locators.budgets.placeholder} />}
        />
        <Route
          path={ROUTES.ops}
          element={<div data-testid={locators.ops.placeholder} />}
        />
      </Routes>
    </AppShell>
  );
}

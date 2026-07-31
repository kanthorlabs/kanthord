import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";
import { router } from "@/app/router";
import "@/index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root is missing from index.html");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

// EPIC 026 decision 5, accepted consequence: the service worker is fetched under
// the Basic-auth challenge, so the browser MAY refuse to register it. That is
// recorded behaviour, not a failure — registration must never break the app.
registerSW({
  immediate: true,
  onRegisterError: (error: unknown) => {
    console.warn("service worker registration refused", error);
  },
});

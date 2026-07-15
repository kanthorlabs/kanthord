/**
 * DaemonClientProvider — makes the generated Connect-Web client available
 * throughout the component tree via useDaemonClient() (Story 001 T1).
 *
 * Tests wrap components in <DaemonClientProvider client={fake}> where the
 * fake is an inline object typed as DaemonClient — the established hermetic
 * test pattern (PROFILE web variant).
 */
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { DaemonClient } from "@/lib/client";

const DaemonClientContext = createContext<DaemonClient | null>(null);

export function DaemonClientProvider({
  client,
  children,
}: {
  client: DaemonClient;
  children: ReactNode;
}) {
  return (
    <DaemonClientContext.Provider value={client}>
      {children}
    </DaemonClientContext.Provider>
  );
}

/**
 * useDaemonClient — returns the injected DaemonClient.
 * Throws when called outside a DaemonClientProvider so the error is
 * surfaced immediately rather than as a null-dereference.
 */
export function useDaemonClient(): DaemonClient {
  const ctx = useContext(DaemonClientContext);
  if (ctx === null) {
    throw new Error("useDaemonClient must be used within a DaemonClientProvider");
  }
  return ctx;
}

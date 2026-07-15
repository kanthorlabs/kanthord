/**
 * OpsPage template — DESIGN §6 card-grid page template for operational surfaces.
 * Used by daemon-ops (dead-man health, verify trigger, etc.).
 * The card-grid layout is responsive: one column on mobile, two on sm, three on lg.
 * Templates own responsive layout so story surfaces never write layout switches
 * (DESIGN §6).
 */
import type { ReactNode } from "react";
import { locators } from "@/locators";

interface OpsPageProps {
  children: ReactNode;
}

export function OpsPage({ children }: OpsPageProps) {
  return (
    <div
      data-testid={locators.opsPage.root}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {children}
    </div>
  );
}

/**
 * Story 006 T2 — OpsPage template tests (DESIGN §6 card-grid template).
 *
 * OpsPage is the page template for the daemon-ops surface: a card-grid layout
 * for operational status cards (dead-man health, verify trigger, etc.).
 * Stories mount inside AppShell + the appropriate template (DESIGN §6 rule).
 *
 * Asserts:
 *   - The root card-grid container renders (locators.opsPage.root)
 *   - Children are rendered inside the root (locators.opsPage.card slots)
 *   - All children are contained within the root
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because:
 *   - clients/web/src/components/templates/OpsPage.tsx does not exist
 *   - locators.opsPage.{root, card} are not in the registry
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpsPage } from "@/components/templates/OpsPage";
import { locators } from "@/locators";

describe("OpsPage template — DESIGN §6 card-grid (Story 006 T2)", () => {
  it("accepts fetchedAt and onRefresh and renders the shared freshness control", async () => {
    const user = userEvent.setup();
    render(
      <OpsPage
        fetchedAt={new Date("2026-07-15T14:05:00")}
        onRefresh={async () => {}}
      >
        <div data-testid={locators.opsPage.card}>card</div>
      </OpsPage>,
    );

    expect(screen.getByTestId(locators.pageFreshness.updated)).toHaveTextContent("Updated 14:05");
    await user.click(screen.getByTestId(locators.pageFreshness.refresh));
  });

  it("renders the root card-grid container", () => {
    render(
      <OpsPage>
        <div data-testid={locators.opsPage.card}>card 1</div>
      </OpsPage>
    );
    expect(screen.getByTestId(locators.opsPage.root)).toBeInTheDocument();
  });

  it("renders children in the card-grid slots", () => {
    render(
      <OpsPage>
        <div data-testid={locators.opsPage.card}>card 1</div>
        <div data-testid={locators.opsPage.card}>card 2</div>
      </OpsPage>
    );
    const cards = screen.getAllByTestId(locators.opsPage.card);
    expect(cards).toHaveLength(2);
  });

  it("all card-grid slots are contained within the root", () => {
    render(
      <OpsPage>
        <div data-testid={locators.opsPage.card}>health card</div>
        <div data-testid={locators.opsPage.card}>verify card</div>
      </OpsPage>
    );
    const root = screen.getByTestId(locators.opsPage.root);
    const cards = screen.getAllByTestId(locators.opsPage.card);
    cards.forEach((card) => {
      expect(root).toContainElement(card);
    });
  });
});

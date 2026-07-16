/**
 * Story 000 T3 — ListPage template tests.
 * Asserts: title / toolbar / content slots render their children; driving the
 * loading / empty / error slot props renders the T1 DataStates components;
 * the wide-content case scrolls inside the template container (overflow-x on
 * the content region) rather than the page body (DESIGN §6 overflow rule).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListPage } from "@/components/templates/ListPage";
import { locators } from "@/locators";

describe("ListPage template (DESIGN §6 + §7)", () => {
  it("accepts fetchedAt and onRefresh and renders the shared freshness control", async () => {
    const user = userEvent.setup();
    const onRefresh = async () => {};
    render(
      <ListPage
        title="Features"
        fetchedAt={new Date("2026-07-15T14:05:00")}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByTestId(locators.pageFreshness.updated)).toHaveTextContent("Updated 14:05");
    await user.click(screen.getByTestId(locators.pageFreshness.refresh));
  });

  // --- Slot rendering ---

  describe("title / toolbar / content slots", () => {
    it("renders the title in the title slot", () => {
      render(
        <ListPage title="Features">
          <div>content</div>
        </ListPage>
      );
      expect(screen.getByTestId(locators.listPage.title)).toHaveTextContent(
        "Features"
      );
    });

    it("renders toolbar children in the toolbar slot", () => {
      render(
        <ListPage
          title="Features"
          toolbar={<button data-testid="add-btn">Add</button>}
        >
          <div>content</div>
        </ListPage>
      );
      expect(screen.getByTestId(locators.listPage.toolbar)).toBeInTheDocument();
      expect(screen.getByTestId("add-btn")).toBeInTheDocument();
    });

    it("renders children in the content slot", () => {
      render(
        <ListPage title="Features">
          <div data-testid="main-content">table here</div>
        </ListPage>
      );
      expect(screen.getByTestId(locators.listPage.content)).toBeInTheDocument();
      expect(screen.getByTestId("main-content")).toBeInTheDocument();
    });
  });

  // --- State slot props delegate to DataStates ---

  describe("loading state slot", () => {
    it("renders the DataStates loading component when loading={true}", () => {
      render(<ListPage title="Features" loading />);
      expect(
        screen.getByTestId(locators.dataStates.loading)
      ).toBeInTheDocument();
    });

    it("does not render the content slot children when loading", () => {
      render(
        <ListPage title="Features" loading>
          <div data-testid="real-content">table</div>
        </ListPage>
      );
      expect(screen.queryByTestId("real-content")).not.toBeInTheDocument();
    });
  });

  describe("empty state slot", () => {
    it("renders the DataStates empty component with supplied wording when empty prop given", () => {
      render(
        <ListPage title="Features" empty={{ message: "No features yet" }}>
          <div data-testid="real-content">table</div>
        </ListPage>
      );
      const emptyEl = screen.getByTestId(locators.dataStates.empty);
      expect(emptyEl).toBeInTheDocument();
      expect(emptyEl).toHaveTextContent("No features yet");
    });

    it("does not render the content slot children when empty", () => {
      render(
        <ListPage title="Features" empty={{ message: "Nothing" }}>
          <div data-testid="real-content">table</div>
        </ListPage>
      );
      expect(screen.queryByTestId("real-content")).not.toBeInTheDocument();
    });
  });

  describe("error state slot", () => {
    it("renders the DataStates error component when error prop given", () => {
      render(
        <ListPage title="Features" error={{ message: "Load failed" }}>
          <div data-testid="real-content">table</div>
        </ListPage>
      );
      const errorEl = screen.getByTestId(locators.dataStates.error);
      expect(errorEl).toBeInTheDocument();
      expect(errorEl).toHaveTextContent("Load failed");
    });

    it("does not render the content slot children when error", () => {
      render(
        <ListPage title="Features" error={{ message: "Error" }}>
          <div data-testid="real-content">table</div>
        </ListPage>
      );
      expect(screen.queryByTestId("real-content")).not.toBeInTheDocument();
    });
  });

  // --- DESIGN §6 overflow rule: wide content scrolls inside the container ---

  describe("horizontal overflow (DESIGN §6)", () => {
    it("content region has horizontal overflow handling (not the page body)", () => {
      render(
        <ListPage title="Features">
          <div style={{ width: "2000px" }}>wide table</div>
        </ListPage>
      );
      const content = screen.getByTestId(locators.listPage.content);
      // The content wrapper must carry an overflow-x utility class so wide
      // content scrolls inside the template container, not the page body.
      expect(content.className).toMatch(/overflow-x/);
    });
  });
});

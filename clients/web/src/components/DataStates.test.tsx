/**
 * Story 000 T1 — DataStates component tests.
 * Asserts the DESIGN §7 state rendering patterns: skeleton loading, explicit
 * empty (caller-supplied wording), and destructive-variant error.
 * All states selected via the locator registry (DESIGN §8).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataStates } from "@/components/DataStates";
import { locators } from "@/locators";

describe("DataStates — DESIGN §7 state components", () => {
  describe("loading state", () => {
    it("renders the loading container (skeleton blocks) when loading={true}", () => {
      render(<DataStates loading />);
      expect(
        screen.getByTestId(locators.dataStates.loading)
      ).toBeInTheDocument();
    });

    it("does not render empty or error when only loading", () => {
      render(<DataStates loading />);
      expect(screen.queryByTestId(locators.dataStates.empty)).not.toBeInTheDocument();
      expect(screen.queryByTestId(locators.dataStates.error)).not.toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("renders the empty container when empty prop is supplied", () => {
      render(<DataStates empty={{ message: "No features found" }} />);
      expect(
        screen.getByTestId(locators.dataStates.empty)
      ).toBeInTheDocument();
    });

    it("renders the caller-supplied wording inside the empty container", () => {
      render(<DataStates empty={{ message: "Nothing here yet" }} />);
      expect(
        screen.getByTestId(locators.dataStates.empty)
      ).toHaveTextContent("Nothing here yet");
    });

    it("does not render loading or error when only empty", () => {
      render(<DataStates empty={{ message: "Empty" }} />);
      expect(screen.queryByTestId(locators.dataStates.loading)).not.toBeInTheDocument();
      expect(screen.queryByTestId(locators.dataStates.error)).not.toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("renders the error container when error prop is supplied", () => {
      render(<DataStates error={{ message: "Failed to load data" }} />);
      expect(
        screen.getByTestId(locators.dataStates.error)
      ).toBeInTheDocument();
    });

    it("renders the error message in the error container", () => {
      render(<DataStates error={{ message: "Connection refused" }} />);
      expect(
        screen.getByTestId(locators.dataStates.error)
      ).toHaveTextContent("Connection refused");
    });

    it("error container carries role=alert (DESIGN §7 destructive-variant Alert)", () => {
      // The Alert primitive always sets role="alert".
      // DataStates error state MUST use <Alert variant="destructive"> per DESIGN §7.
      render(<DataStates error={{ message: "Load failed" }} />);
      expect(
        screen.getByTestId(locators.dataStates.error)
      ).toHaveAttribute("role", "alert");
    });

    it("does not render loading or empty when only error", () => {
      render(<DataStates error={{ message: "Error" }} />);
      expect(screen.queryByTestId(locators.dataStates.loading)).not.toBeInTheDocument();
      expect(screen.queryByTestId(locators.dataStates.empty)).not.toBeInTheDocument();
    });
  });
});

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RepoSlots } from "@/slots/RepoSlots";
import { locators } from "@/locators";

const SLOTS_FIXTURE = [
  {
    name: "slot-001", repo: "kanthorlabs/kanthord", strategy: "exclusive",
    heldLeases: ["lease-a", "lease-b"], activeSessions: ["sess-001"],
  },
  {
    name: "slot-002", repo: "kanthorlabs/pi", strategy: "shared",
    heldLeases: [], activeSessions: ["sess-002", "sess-003"],
  },
];

describe("RepoSlots — repo slots surface (Story 005 T2)", () => {
  describe("loading state", () => {
    it("renders the loading state while data is fetching", () => {
      render(<RepoSlots loading />);
      expect(screen.getByTestId(locators.dataStates.loading)).toBeInTheDocument();
    });
  });

  describe("slots fixture — repo / strategy / held leases / active sessions", () => {
    it("table root carries the slots table testid (DESIGN §8)", () => {
      render(<RepoSlots slots={SLOTS_FIXTURE as never} />);
      expect(screen.getByTestId(locators.slots.table)).toBeInTheDocument();
    });

    it("renders exactly two slot rows", () => {
      render(<RepoSlots slots={SLOTS_FIXTURE as never} />);
      expect(screen.getAllByTestId(locators.slots.row)).toHaveLength(2);
    });

    it("renders the repo in the first slot row", () => {
      render(<RepoSlots slots={SLOTS_FIXTURE as never} />);
      expect(screen.getAllByTestId(locators.slots.row)[0]).toHaveTextContent("kanthorlabs/kanthord");
    });

    it("renders the repo in the second slot row", () => {
      render(<RepoSlots slots={SLOTS_FIXTURE as never} />);
      expect(screen.getAllByTestId(locators.slots.row)[1]).toHaveTextContent("kanthorlabs/pi");
    });

    it("renders the strategy in the first slot row", () => {
      render(<RepoSlots slots={SLOTS_FIXTURE as never} />);
      expect(screen.getAllByTestId(locators.slots.row)[0]).toHaveTextContent("exclusive");
    });

    it("renders the strategy in the second slot row", () => {
      render(<RepoSlots slots={SLOTS_FIXTURE as never} />);
      expect(screen.getAllByTestId(locators.slots.row)[1]).toHaveTextContent("shared");
    });

    it("renders held leases in the first slot row", () => {
      render(<RepoSlots slots={SLOTS_FIXTURE as never} />);
      expect(screen.getAllByTestId(locators.slots.row)[0]).toHaveTextContent("lease-a");
    });

    it("renders active sessions in the first slot row", () => {
      render(<RepoSlots slots={SLOTS_FIXTURE as never} />);
      expect(screen.getAllByTestId(locators.slots.row)[0]).toHaveTextContent("sess-001");
    });

    it("renders active sessions in the second slot row", () => {
      render(<RepoSlots slots={SLOTS_FIXTURE as never} />);
      expect(screen.getAllByTestId(locators.slots.row)[1]).toHaveTextContent("sess-002");
    });
  });

  describe("empty slots state", () => {
    it("renders the explicit empty state when no slots returned", () => {
      render(<RepoSlots slots={[]} />);
      expect(screen.getByTestId(locators.slots.empty)).toBeInTheDocument();
    });

    it("does not render any rows in the empty state", () => {
      render(<RepoSlots slots={[]} />);
      expect(screen.queryAllByTestId(locators.slots.row)).toHaveLength(0);
    });
  });

  describe("error state", () => {
    it("renders the error state when the client rejects", () => {
      render(<RepoSlots error={{ message: "slots network failure" }} />);
      expect(screen.getByTestId(locators.dataStates.error)).toBeInTheDocument();
    });
  });
});

/**
 * Story 005 T2 — Repo-slots component tests.
 *
 * RepoSlots:
 *   - Calls client.listSlots({}) and renders each SlotInfo as a table row.
 *   - Each row shows: repo, strategy, held leases, active sessions.
 *   - Empty fixture renders an explicit empty state (no blank panel).
 *   - Error state is rendered when the client rejects.
 *
 * RED: fails because:
 *   - clients/web/src/slots/RepoSlots.tsx does not exist
 *   - locators.slots.{table,row,empty} are not in the registry
 */
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RepoSlots } from "@/slots/RepoSlots";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SLOTS_FIXTURE = [
  {
    name: "slot-001",
    repo: "kanthorlabs/kanthord",
    strategy: "exclusive",
    heldLeases: ["lease-a", "lease-b"],
    activeSessions: ["sess-001"],
  },
  {
    name: "slot-002",
    repo: "kanthorlabs/pi",
    strategy: "shared",
    heldLeases: [],
    activeSessions: ["sess-002", "sess-003"],
  },
];

// ---------------------------------------------------------------------------
// Fake client helpers
// ---------------------------------------------------------------------------

function makeSlotsClient(
  slots: typeof SLOTS_FIXTURE
): DaemonClient {
  return {
    listSlots: async () => ({ slots }),
  } as unknown as DaemonClient;
}

function makeRejectingSlotsClient(): DaemonClient {
  return {
    listSlots: async () => {
      throw new Error("slots network failure");
    },
  } as unknown as DaemonClient;
}

function makeHangingSlotsClient(): DaemonClient {
  return {
    listSlots: () => new Promise(() => { /* never resolves */ }),
  } as unknown as DaemonClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RepoSlots — repo slots surface (Story 005 T2)", () => {
  describe("loading state", () => {
    it("renders the loading state while data is fetching", () => {
      render(
        <DaemonClientProvider client={makeHangingSlotsClient()}>
          <RepoSlots />
        </DaemonClientProvider>
      );
      expect(
        screen.getByTestId(locators.dataStates.loading)
      ).toBeInTheDocument();
    });
  });

  describe("slots fixture — repo / strategy / held leases / active sessions", () => {
    it("table root carries the slots table testid (DESIGN §8)", async () => {
      render(
        <DaemonClientProvider client={makeSlotsClient(SLOTS_FIXTURE)}>
          <RepoSlots />
        </DaemonClientProvider>
      );
      await screen.findAllByTestId(locators.slots.row);
      expect(
        screen.getByTestId(locators.slots.table)
      ).toBeInTheDocument();
    });

    it("renders exactly two slot rows", async () => {
      render(
        <DaemonClientProvider client={makeSlotsClient(SLOTS_FIXTURE)}>
          <RepoSlots />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.slots.row);
      expect(rows).toHaveLength(2);
    });

    it("renders the repo in the first slot row", async () => {
      render(
        <DaemonClientProvider client={makeSlotsClient(SLOTS_FIXTURE)}>
          <RepoSlots />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.slots.row);
      expect(rows[0]).toHaveTextContent("kanthorlabs/kanthord");
    });

    it("renders the repo in the second slot row", async () => {
      render(
        <DaemonClientProvider client={makeSlotsClient(SLOTS_FIXTURE)}>
          <RepoSlots />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.slots.row);
      expect(rows[1]).toHaveTextContent("kanthorlabs/pi");
    });

    it("renders the strategy in the first slot row", async () => {
      render(
        <DaemonClientProvider client={makeSlotsClient(SLOTS_FIXTURE)}>
          <RepoSlots />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.slots.row);
      expect(rows[0]).toHaveTextContent("exclusive");
    });

    it("renders the strategy in the second slot row", async () => {
      render(
        <DaemonClientProvider client={makeSlotsClient(SLOTS_FIXTURE)}>
          <RepoSlots />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.slots.row);
      expect(rows[1]).toHaveTextContent("shared");
    });

    it("renders held leases in the first slot row", async () => {
      render(
        <DaemonClientProvider client={makeSlotsClient(SLOTS_FIXTURE)}>
          <RepoSlots />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.slots.row);
      expect(rows[0]).toHaveTextContent("lease-a");
    });

    it("renders active sessions in the first slot row", async () => {
      render(
        <DaemonClientProvider client={makeSlotsClient(SLOTS_FIXTURE)}>
          <RepoSlots />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.slots.row);
      expect(rows[0]).toHaveTextContent("sess-001");
    });

    it("renders active sessions in the second slot row", async () => {
      render(
        <DaemonClientProvider client={makeSlotsClient(SLOTS_FIXTURE)}>
          <RepoSlots />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.slots.row);
      expect(rows[1]).toHaveTextContent("sess-002");
    });
  });

  describe("empty slots state", () => {
    it("renders the explicit empty state when no slots returned", async () => {
      render(
        <DaemonClientProvider client={makeSlotsClient([])}>
          <RepoSlots />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.slots.empty);
      expect(
        screen.getByTestId(locators.slots.empty)
      ).toBeInTheDocument();
    });

    it("does not render any rows in the empty state", async () => {
      render(
        <DaemonClientProvider client={makeSlotsClient([])}>
          <RepoSlots />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.slots.empty);
      expect(
        screen.queryAllByTestId(locators.slots.row)
      ).toHaveLength(0);
    });
  });

  describe("error state", () => {
    it("renders the error state when the client rejects", async () => {
      render(
        <DaemonClientProvider client={makeRejectingSlotsClient()}>
          <RepoSlots />
        </DaemonClientProvider>
      );
      await waitFor(() => {
        expect(
          screen.getByTestId(locators.dataStates.error)
        ).toBeInTheDocument();
      });
    });
  });
});

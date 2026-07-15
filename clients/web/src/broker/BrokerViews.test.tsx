/**
 * Story 005 T1 — Broker operations + verb registry component tests.
 *
 * BrokerOpsView:
 *   - Calls client.listBrokerOperations({}) and groups operations by lifecycle:
 *     in-flight (state "in_flight", expiring=false), pending (state "pending"),
 *     and expiring (expiring=true) — each group distinctly identified by testid.
 *   - Each row shows the op state (lifecycle) and correlation (reconciliation
 *     reference) — the proto fields that cover the AC "reconciliation status".
 *   - Loading, empty, and error states are rendered explicitly.
 *
 * BrokerVerbsView:
 *   - Calls client.listBrokerVerbs({}) and renders each verb with its tier.
 *   - Exposes NO editable element (DESIGN §6 read-only-by-design rule):
 *     no input, no textarea, no contentEditable.
 *   - Loading, empty, and error states are rendered explicitly.
 *
 * RED: fails because:
 *   - clients/web/src/broker/BrokerViews.tsx does not exist
 *   - locators.broker.ops.{table,row,groupInFlight,groupPending,groupExpiring,empty}
 *     are not in the registry
 *   - locators.broker.verbs.{table,row,empty} are not in the registry
 *
 * NOTE — reconciliation status gap: the proto BrokerOperation has `state`
 * (lifecycle: pending/in_flight/…) and `correlation` (external id / idempotency
 * key). The AC's "reconciliation status" maps to these two fields. There is no
 * dedicated `reconciliation_status` proto field. If a separate field is needed
 * it is an Epic 026 API change — flagged here, not invented.
 */
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BrokerOpsView, BrokerVerbsView } from "@/broker/BrokerViews";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";

// ---------------------------------------------------------------------------
// Fixtures — BrokerOpsView
// ---------------------------------------------------------------------------

const IN_FLIGHT_OP = {
  opId: "op-inf-001",
  verb: "github.merge",
  state: "in_flight",
  correlation: "corr-inf-001",
  featureId: "feat-001",
  expiresAt: 0n,
  expiring: false,
};

const PENDING_OP = {
  opId: "op-pnd-001",
  verb: "github.push",
  state: "pending",
  correlation: "corr-pnd-001",
  featureId: "feat-002",
  expiresAt: 0n,
  expiring: false,
};

/** An expiring op has expiring=true; state may still be "in_flight". */
const EXPIRING_OP = {
  opId: "op-exp-001",
  verb: "github.merge",
  state: "in_flight",
  correlation: "corr-exp-001",
  featureId: "feat-003",
  expiresAt: 1_750_000_000_000n,
  expiring: true,
};

const THREE_GROUPS_OPS = [IN_FLIGHT_OP, PENDING_OP, EXPIRING_OP];

// ---------------------------------------------------------------------------
// Fixtures — BrokerVerbsView
// ---------------------------------------------------------------------------

const VERBS_FIXTURE = [
  { verb: "github.push",  tier: "auto" },
  { verb: "github.merge", tier: "approval-required" },
  { verb: "github.read",  tier: "read-only" },
];

// ---------------------------------------------------------------------------
// Fake client helpers — BrokerOpsView
// ---------------------------------------------------------------------------

function makeOpsClient(
  operations: typeof THREE_GROUPS_OPS
): DaemonClient {
  return {
    listBrokerOperations: async () => ({ operations }),
  } as unknown as DaemonClient;
}

function makeRejectingOpsClient(): DaemonClient {
  return {
    listBrokerOperations: async () => {
      throw new Error("ops network failure");
    },
  } as unknown as DaemonClient;
}

function makeHangingOpsClient(): DaemonClient {
  return {
    listBrokerOperations: () => new Promise(() => { /* never resolves */ }),
  } as unknown as DaemonClient;
}

// ---------------------------------------------------------------------------
// Fake client helpers — BrokerVerbsView
// ---------------------------------------------------------------------------

function makeVerbsClient(
  verbs: typeof VERBS_FIXTURE
): DaemonClient {
  return {
    listBrokerVerbs: async () => ({ verbs }),
  } as unknown as DaemonClient;
}

function makeRejectingVerbsClient(): DaemonClient {
  return {
    listBrokerVerbs: async () => {
      throw new Error("verbs network failure");
    },
  } as unknown as DaemonClient;
}

function makeHangingVerbsClient(): DaemonClient {
  return {
    listBrokerVerbs: () => new Promise(() => { /* never resolves */ }),
  } as unknown as DaemonClient;
}

// ---------------------------------------------------------------------------
// BrokerOpsView tests
// ---------------------------------------------------------------------------

describe("BrokerOpsView — broker operations surface (Story 005 T1)", () => {
  describe("loading state", () => {
    it("renders the loading state while data is fetching", () => {
      render(
        <DaemonClientProvider client={makeHangingOpsClient()}>
          <BrokerOpsView />
        </DaemonClientProvider>
      );
      expect(
        screen.getByTestId(locators.dataStates.loading)
      ).toBeInTheDocument();
    });
  });

  describe("three-group fixture — in-flight / pending / expiring", () => {
    it("table root carries the broker ops table testid (DESIGN §8)", async () => {
      render(
        <DaemonClientProvider client={makeOpsClient(THREE_GROUPS_OPS)}>
          <BrokerOpsView />
        </DaemonClientProvider>
      );
      await screen.findAllByTestId(locators.broker.ops.row);
      expect(
        screen.getByTestId(locators.broker.ops.table)
      ).toBeInTheDocument();
    });

    it("renders exactly three op rows", async () => {
      render(
        <DaemonClientProvider client={makeOpsClient(THREE_GROUPS_OPS)}>
          <BrokerOpsView />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.broker.ops.row);
      expect(rows).toHaveLength(3);
    });

    it("renders a distinctly identified in-flight group", async () => {
      render(
        <DaemonClientProvider client={makeOpsClient(THREE_GROUPS_OPS)}>
          <BrokerOpsView />
        </DaemonClientProvider>
      );
      await screen.findAllByTestId(locators.broker.ops.row);
      expect(
        screen.getByTestId(locators.broker.ops.groupInFlight)
      ).toBeInTheDocument();
    });

    it("renders a distinctly identified pending group", async () => {
      render(
        <DaemonClientProvider client={makeOpsClient(THREE_GROUPS_OPS)}>
          <BrokerOpsView />
        </DaemonClientProvider>
      );
      await screen.findAllByTestId(locators.broker.ops.row);
      expect(
        screen.getByTestId(locators.broker.ops.groupPending)
      ).toBeInTheDocument();
    });

    it("renders a distinctly identified expiring group", async () => {
      render(
        <DaemonClientProvider client={makeOpsClient(THREE_GROUPS_OPS)}>
          <BrokerOpsView />
        </DaemonClientProvider>
      );
      await screen.findAllByTestId(locators.broker.ops.row);
      expect(
        screen.getByTestId(locators.broker.ops.groupExpiring)
      ).toBeInTheDocument();
    });

    it("in-flight group shows the in-flight op correlation (reconciliation reference)", async () => {
      render(
        <DaemonClientProvider client={makeOpsClient(THREE_GROUPS_OPS)}>
          <BrokerOpsView />
        </DaemonClientProvider>
      );
      await screen.findAllByTestId(locators.broker.ops.row);
      const group = screen.getByTestId(locators.broker.ops.groupInFlight);
      expect(group).toHaveTextContent(IN_FLIGHT_OP.correlation);
    });

    it("pending group shows the pending op correlation (reconciliation reference)", async () => {
      render(
        <DaemonClientProvider client={makeOpsClient(THREE_GROUPS_OPS)}>
          <BrokerOpsView />
        </DaemonClientProvider>
      );
      await screen.findAllByTestId(locators.broker.ops.row);
      const group = screen.getByTestId(locators.broker.ops.groupPending);
      expect(group).toHaveTextContent(PENDING_OP.correlation);
    });

    it("expiring group shows the expiring op correlation (reconciliation reference)", async () => {
      render(
        <DaemonClientProvider client={makeOpsClient(THREE_GROUPS_OPS)}>
          <BrokerOpsView />
        </DaemonClientProvider>
      );
      await screen.findAllByTestId(locators.broker.ops.row);
      const group = screen.getByTestId(locators.broker.ops.groupExpiring);
      expect(group).toHaveTextContent(EXPIRING_OP.correlation);
    });

    it("rows collectively show the lifecycle states from the fixture", async () => {
      render(
        <DaemonClientProvider client={makeOpsClient(THREE_GROUPS_OPS)}>
          <BrokerOpsView />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.broker.ops.row);
      const allText = rows.map((r) => r.textContent ?? "").join(" ");
      expect(allText).toContain("in_flight");
      expect(allText).toContain("pending");
    });
  });

  describe("empty ops state", () => {
    it("renders the explicit empty state when no operations returned", async () => {
      render(
        <DaemonClientProvider client={makeOpsClient([])}>
          <BrokerOpsView />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.broker.ops.empty);
      expect(
        screen.getByTestId(locators.broker.ops.empty)
      ).toBeInTheDocument();
    });

    it("does not render any rows in the empty state", async () => {
      render(
        <DaemonClientProvider client={makeOpsClient([])}>
          <BrokerOpsView />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.broker.ops.empty);
      expect(
        screen.queryAllByTestId(locators.broker.ops.row)
      ).toHaveLength(0);
    });
  });

  describe("error state", () => {
    it("renders the error state when the client rejects", async () => {
      render(
        <DaemonClientProvider client={makeRejectingOpsClient()}>
          <BrokerOpsView />
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

// ---------------------------------------------------------------------------
// BrokerVerbsView tests
// ---------------------------------------------------------------------------

describe("BrokerVerbsView — verb registry surface (Story 005 T1)", () => {
  describe("loading state", () => {
    it("renders the loading state while data is fetching", () => {
      render(
        <DaemonClientProvider client={makeHangingVerbsClient()}>
          <BrokerVerbsView />
        </DaemonClientProvider>
      );
      expect(
        screen.getByTestId(locators.dataStates.loading)
      ).toBeInTheDocument();
    });
  });

  describe("verbs fixture", () => {
    it("table root carries the broker verbs table testid (DESIGN §8)", async () => {
      render(
        <DaemonClientProvider client={makeVerbsClient(VERBS_FIXTURE)}>
          <BrokerVerbsView />
        </DaemonClientProvider>
      );
      await screen.findAllByTestId(locators.broker.verbs.row);
      expect(
        screen.getByTestId(locators.broker.verbs.table)
      ).toBeInTheDocument();
    });

    it("renders exactly three verb rows", async () => {
      render(
        <DaemonClientProvider client={makeVerbsClient(VERBS_FIXTURE)}>
          <BrokerVerbsView />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.broker.verbs.row);
      expect(rows).toHaveLength(3);
    });

    it("renders the verb name in each row", async () => {
      render(
        <DaemonClientProvider client={makeVerbsClient(VERBS_FIXTURE)}>
          <BrokerVerbsView />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.broker.verbs.row);
      expect(rows[0]).toHaveTextContent("github.push");
      expect(rows[1]).toHaveTextContent("github.merge");
      expect(rows[2]).toHaveTextContent("github.read");
    });

    it("renders the tier in each row", async () => {
      render(
        <DaemonClientProvider client={makeVerbsClient(VERBS_FIXTURE)}>
          <BrokerVerbsView />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.broker.verbs.row);
      expect(rows[0]).toHaveTextContent("auto");
      expect(rows[1]).toHaveTextContent("approval-required");
      expect(rows[2]).toHaveTextContent("read-only");
    });
  });

  describe("read-only discipline (DESIGN §6 — no edit affordance)", () => {
    it("exposes no input element", async () => {
      const { container } = render(
        <DaemonClientProvider client={makeVerbsClient(VERBS_FIXTURE)}>
          <BrokerVerbsView />
        </DaemonClientProvider>
      );
      await screen.findAllByTestId(locators.broker.verbs.row);
      expect(container.querySelector("input")).toBeNull();
    });

    it("exposes no textarea element", async () => {
      const { container } = render(
        <DaemonClientProvider client={makeVerbsClient(VERBS_FIXTURE)}>
          <BrokerVerbsView />
        </DaemonClientProvider>
      );
      await screen.findAllByTestId(locators.broker.verbs.row);
      expect(container.querySelector("textarea")).toBeNull();
    });

    it("exposes no contentEditable element", async () => {
      const { container } = render(
        <DaemonClientProvider client={makeVerbsClient(VERBS_FIXTURE)}>
          <BrokerVerbsView />
        </DaemonClientProvider>
      );
      await screen.findAllByTestId(locators.broker.verbs.row);
      expect(container.querySelector("[contenteditable='true']")).toBeNull();
    });
  });

  describe("empty verbs state", () => {
    it("renders the explicit empty state when no verbs returned", async () => {
      render(
        <DaemonClientProvider client={makeVerbsClient([])}>
          <BrokerVerbsView />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.broker.verbs.empty);
      expect(
        screen.getByTestId(locators.broker.verbs.empty)
      ).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("renders the error state when the client rejects", async () => {
      render(
        <DaemonClientProvider client={makeRejectingVerbsClient()}>
          <BrokerVerbsView />
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

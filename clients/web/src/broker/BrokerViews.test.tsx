import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrokerOpsView, BrokerVerbsView } from "@/broker/BrokerViews";
import { locators } from "@/locators";

const IN_FLIGHT_OP = {
  opId: "op-inf-001", verb: "github.merge", state: "in_flight", correlation: "corr-inf-001",
  featureId: "feat-001", expiresAt: 0n, expiring: false,
};
const PENDING_OP = {
  opId: "op-pnd-001", verb: "github.push", state: "pending", correlation: "corr-pnd-001",
  featureId: "feat-002", expiresAt: 0n, expiring: false,
};
const EXPIRING_OP = {
  opId: "op-exp-001", verb: "github.merge", state: "in_flight", correlation: "corr-exp-001",
  featureId: "feat-003", expiresAt: 1_750_000_000_000n, expiring: true,
};
const THREE_GROUPS_OPS = [IN_FLIGHT_OP, PENDING_OP, EXPIRING_OP];
const VERBS_FIXTURE = [
  { verb: "github.push", tier: "auto" },
  { verb: "github.merge", tier: "approval-required" },
  { verb: "github.read", tier: "read-only" },
];

describe("BrokerOpsView — broker operations surface (Story 005 T1)", () => {
  describe("loading state", () => {
    it("renders the loading state while data is fetching", () => {
      render(<BrokerOpsView loading />);
      expect(screen.getByTestId(locators.dataStates.loading)).toBeInTheDocument();
    });
  });

  describe("three-group fixture — in-flight / pending / expiring", () => {
    it("table root carries the broker ops table testid (DESIGN §8)", () => {
      render(<BrokerOpsView operations={THREE_GROUPS_OPS as never} />);
      expect(screen.getByTestId(locators.broker.ops.table)).toBeInTheDocument();
    });

    it("renders exactly three op rows", () => {
      render(<BrokerOpsView operations={THREE_GROUPS_OPS as never} />);
      expect(screen.getAllByTestId(locators.broker.ops.row)).toHaveLength(3);
    });

    it("renders a distinctly identified in-flight group", () => {
      render(<BrokerOpsView operations={THREE_GROUPS_OPS as never} />);
      expect(screen.getByTestId(locators.broker.ops.groupInFlight)).toBeInTheDocument();
    });

    it("renders a distinctly identified pending group", () => {
      render(<BrokerOpsView operations={THREE_GROUPS_OPS as never} />);
      expect(screen.getByTestId(locators.broker.ops.groupPending)).toBeInTheDocument();
    });

    it("renders a distinctly identified expiring group", () => {
      render(<BrokerOpsView operations={THREE_GROUPS_OPS as never} />);
      expect(screen.getByTestId(locators.broker.ops.groupExpiring)).toBeInTheDocument();
    });

    it("in-flight group shows the in-flight op correlation (reconciliation reference)", () => {
      render(<BrokerOpsView operations={THREE_GROUPS_OPS as never} />);
      expect(screen.getByTestId(locators.broker.ops.groupInFlight)).toHaveTextContent(IN_FLIGHT_OP.correlation);
    });

    it("pending group shows the pending op correlation (reconciliation reference)", () => {
      render(<BrokerOpsView operations={THREE_GROUPS_OPS as never} />);
      expect(screen.getByTestId(locators.broker.ops.groupPending)).toHaveTextContent(PENDING_OP.correlation);
    });

    it("expiring group shows the expiring op correlation (reconciliation reference)", () => {
      render(<BrokerOpsView operations={THREE_GROUPS_OPS as never} />);
      expect(screen.getByTestId(locators.broker.ops.groupExpiring)).toHaveTextContent(EXPIRING_OP.correlation);
    });

    it("rows collectively show the lifecycle states from the fixture", () => {
      render(<BrokerOpsView operations={THREE_GROUPS_OPS as never} />);
      const allText = screen.getAllByTestId(locators.broker.ops.row).map((row) => row.textContent ?? "").join(" ");
      expect(allText).toContain("in_flight");
      expect(allText).toContain("pending");
    });
  });

  describe("empty ops state", () => {
    it("renders the explicit empty state when no operations returned", () => {
      render(<BrokerOpsView operations={[]} />);
      expect(screen.getByTestId(locators.broker.ops.empty)).toBeInTheDocument();
    });

    it("does not render any rows in the empty state", () => {
      render(<BrokerOpsView operations={[]} />);
      expect(screen.queryAllByTestId(locators.broker.ops.row)).toHaveLength(0);
    });
  });

  describe("error state", () => {
    it("renders the error state when the client rejects", () => {
      render(<BrokerOpsView error={{ message: "ops network failure" }} />);
      expect(screen.getByTestId(locators.dataStates.error)).toBeInTheDocument();
    });
  });
});

describe("BrokerVerbsView — verb registry surface (Story 005 T1)", () => {
  describe("loading state", () => {
    it("renders the loading state while data is fetching", () => {
      render(<BrokerVerbsView loading />);
      expect(screen.getByTestId(locators.dataStates.loading)).toBeInTheDocument();
    });
  });

  describe("verbs fixture", () => {
    it("table root carries the broker verbs table testid (DESIGN §8)", () => {
      render(<BrokerVerbsView verbs={VERBS_FIXTURE as never} />);
      expect(screen.getByTestId(locators.broker.verbs.table)).toBeInTheDocument();
    });

    it("renders exactly three verb rows", () => {
      render(<BrokerVerbsView verbs={VERBS_FIXTURE as never} />);
      expect(screen.getAllByTestId(locators.broker.verbs.row)).toHaveLength(3);
    });

    it("renders the verb name in each row", () => {
      render(<BrokerVerbsView verbs={VERBS_FIXTURE as never} />);
      const rows = screen.getAllByTestId(locators.broker.verbs.row);
      expect(rows[0]).toHaveTextContent("github.push");
      expect(rows[1]).toHaveTextContent("github.merge");
      expect(rows[2]).toHaveTextContent("github.read");
    });

    it("renders the tier in each row", () => {
      render(<BrokerVerbsView verbs={VERBS_FIXTURE as never} />);
      const rows = screen.getAllByTestId(locators.broker.verbs.row);
      expect(rows[0]).toHaveTextContent("auto");
      expect(rows[1]).toHaveTextContent("approval-required");
      expect(rows[2]).toHaveTextContent("read-only");
    });
  });

  describe("read-only discipline (DESIGN §6 — no edit affordance)", () => {
    it("exposes no input element", () => {
      const { container } = render(<BrokerVerbsView verbs={VERBS_FIXTURE as never} />);
      expect(container.querySelector("input")).toBeNull();
    });

    it("exposes no textarea element", () => {
      const { container } = render(<BrokerVerbsView verbs={VERBS_FIXTURE as never} />);
      expect(container.querySelector("textarea")).toBeNull();
    });

    it("exposes no contentEditable element", () => {
      const { container } = render(<BrokerVerbsView verbs={VERBS_FIXTURE as never} />);
      expect(container.querySelector("[contenteditable='true']")).toBeNull();
    });
  });

  describe("empty verbs state", () => {
    it("renders the explicit empty state when no verbs returned", () => {
      render(<BrokerVerbsView verbs={[]} />);
      expect(screen.getByTestId(locators.broker.verbs.empty)).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("renders the error state when the client rejects", () => {
      render(<BrokerVerbsView error={{ message: "verbs network failure" }} />);
      expect(screen.getByTestId(locators.dataStates.error)).toBeInTheDocument();
    });
  });
});

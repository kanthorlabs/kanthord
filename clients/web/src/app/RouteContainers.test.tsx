import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import { FeatureListContainer } from "@/features/FeatureListContainer";
import { FeatureDetailContainer } from "@/features/FeatureDetailContainer";
import { InboxContainer } from "@/inbox/InboxContainer";
import { InboxItemContainer } from "@/inbox/InboxItemContainer";
import { BrokerContainer } from "@/broker/BrokerContainer";
import { RepoSlotsContainer } from "@/slots/RepoSlotsContainer";
import { BudgetsContainer } from "@/budgets/BudgetsContainer";
import { DaemonOpsContainer } from "@/daemon-ops/DaemonOpsContainer";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";

const FEATURE = {
  featureId: "feature-container-target",
  status: "running",
  phase: "coding",
  progressSummary: "1/1 tasks satisfied",
  name: "Container target",
};

const FEATURE_DETAIL = {
  featureId: FEATURE.featureId,
  status: "running",
  phase: "coding",
  stories: [
    {
      storyId: "story-container",
      status: "running",
      tasks: [
        {
          taskId: "task-container",
          status: "running",
          exitGatePassed: false,
          attempt: 1n,
        },
      ],
    },
  ],
  dag: {
    totalNodes: 1n,
    satisfiedNodes: 1n,
    totalEdges: 0n,
    satisfiedEdges: 0n,
  },
  inFlightOps: [],
  stateView: "state",
  journalView: "journal",
};

const APPROVAL_ITEM = {
  id: "approval-container-target",
  kind: "approval",
  featureId: FEATURE.featureId,
  summary: "Merge the container target",
  type: "github.merge",
  severity: "high",
  suggestedCategory: "approval",
  evidence: { type: "text", text: "approval evidence" },
  status: "open",
  expiresAt: 0n,
  expired: false,
};

const PENDING_REPLAN_PROPOSAL = {
  proposalId: "replan-proposal-container",
  featureId: FEATURE.featureId,
  baseGeneration: 8n,
  baseCompileHash: "container-base-hash",
  createdAt: 1_721_000_000_000n,
  edits: [{ path: "001-plan/001-task.md", newContent: "container revised task" }],
  displayFiles: [{
    path: "001-plan/001-task.md",
    lines: [{ kind: "add", content: "container revised task" }],
  }],
};

const PUBLIC_CONFIGURATION = {
  diffEscalationPolicy: "escalate_all_diffs",
  brokerDeclarations: [
    {
      verb: "github.create_pr",
      tier: "auto_with_audit",
      timeoutMs: 120_000,
      idempotencyWindowMs: 3_600_000,
      retryMax: 5,
      retryBackoff: "exponential",
      pollIntervalMs: 10_000,
      terminalStates: ["done", "failed", "escalation_needed"],
      requestsPerMinute: 60,
      observedStateCanRegress: true,
      pendingExpiryMs: 300_000,
    },
  ],
};

function safeClient(overrides: Record<string, unknown> = {}): DaemonClient {
  return {
    listFeatures: async () => ({ features: [] }),
    getFeature: async () => FEATURE_DETAIL,
    getFeatureSummary: async () => ({
      featureId: FEATURE.featureId,
      headline: 0,
      byConfirmedType: {
        approval: 0,
        clarification: 0,
        correction: 0,
        rework: 0,
        takeover: 0,
        external: 0,
      },
      excluded: 0,
      netCost: 0,
    }),
    listInboxItems: async () => ({ items: [] }),
    getInboxItem: async () => ({ item: undefined }),
    listBrokerOperations: async () => ({ operations: [] }),
    listBrokerVerbs: async () => ({ verbs: [] }),
    listSlots: async () => ({ slots: [] }),
    listBudgets: async () => ({ budgets: [] }),
    getDaemonStatus: async () => ({
      version: "test",
      uptimeSeconds: 0n,
      lastPing: { present: false, sentAt: 0n, tasksProcessed: 0n },
    }),
    triggerVerify: async () => ({ report: undefined }),
    respondToEscalation: async () => ({}),
    respondToApproval: async () => ({}),
    overrideBudget: async () => ({ newCeiling: 0 }),
    ...overrides,
  } as unknown as DaemonClient;
}

function renderWithClient(client: DaemonClient, child: ReactNode) {
  return render(
    <DaemonClientProvider client={client}>{child}</DaemonClientProvider>,
  );
}

function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve: (value: T) => resolve(value) };
}

describe("route fetch containers — daemon reads and view-model adaptation", () => {
  it("FeatureList records completion after a successful read and refreshes without hiding current content", async () => {
    const user = userEvent.setup();
    const secondRead = deferred<{ features: Array<typeof FEATURE> }>();
    let reads = 0;
    const client = safeClient({
      listFeatures: async () => {
        reads += 1;
        return reads === 1 ? { features: [FEATURE] } : secondRead.promise;
      },
    });

    renderWithClient(client, <MemoryRouter><FeatureListContainer /></MemoryRouter>);

    expect(await screen.findByTestId(locators.features.list.row)).toHaveTextContent(FEATURE.featureId);
    expect(screen.getByTestId(locators.pageFreshness.updated)).toBeInTheDocument();
    await user.click(screen.getByTestId(locators.pageFreshness.refresh));
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.getByTestId(locators.features.list.row)).toBeInTheDocument();
    expect(screen.queryByTestId(locators.dataStates.loading)).not.toBeInTheDocument();
  });

  it("FeatureDetail refreshes getFeature without hiding the current feature", async () => {
    const user = userEvent.setup();
    const secondRead = deferred<typeof FEATURE_DETAIL>();
    let reads = 0;
    const client = safeClient({
      getFeature: async () => {
        reads += 1;
        return reads === 1 ? FEATURE_DETAIL : secondRead.promise;
      },
    });

    renderWithClient(client, <MemoryRouter initialEntries={[`/features/${FEATURE.featureId}`]}><Routes><Route path="/features/:featureId" element={<FeatureDetailContainer />} /></Routes></MemoryRouter>);

    await screen.findByTestId(locators.features.detail.taskRow("task-container"));
    await user.click(screen.getByTestId(locators.pageFreshness.refresh));
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.getByTestId(locators.features.detail.taskRow("task-container"))).toBeInTheDocument();
    expect(screen.queryByTestId(locators.dataStates.loading)).not.toBeInTheDocument();
  });

  it("Inbox refreshes listInboxItems without hiding the current inbox", async () => {
    const user = userEvent.setup();
    const secondRead = deferred<{ items: Array<typeof APPROVAL_ITEM> }>();
    let reads = 0;
    const client = safeClient({
      listInboxItems: async () => {
        reads += 1;
        return reads === 1 ? { items: [APPROVAL_ITEM] } : secondRead.promise;
      },
    });

    renderWithClient(client, <InboxContainer />);

    await screen.findByTestId(locators.inbox.list.row);
    await user.click(screen.getByTestId(locators.pageFreshness.refresh));
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.getByTestId(locators.inbox.list.row)).toBeInTheDocument();
    expect(screen.queryByTestId(locators.dataStates.loading)).not.toBeInTheDocument();
  });

  it("Broker refreshes both daemon reads without hiding either current view", async () => {
    const user = userEvent.setup();
    const operations = [{ opId: "fresh-op", state: "in_flight", correlation: "fresh", verb: "github.commit", expiring: false }];
    const verbs = [{ verb: "github.commit", tier: "approval" }];
    const secondOperations = deferred<{ operations: typeof operations }>();
    const secondVerbs = deferred<{ verbs: typeof verbs }>();
    let operationReads = 0;
    let verbReads = 0;
    const client = safeClient({
      listBrokerOperations: async () => {
        operationReads += 1;
        return operationReads === 1 ? { operations } : secondOperations.promise;
      },
      listBrokerVerbs: async () => {
        verbReads += 1;
        return verbReads === 1 ? { verbs } : secondVerbs.promise;
      },
    });

    renderWithClient(client, <BrokerContainer />);

    await screen.findByTestId(locators.broker.ops.row);
    await screen.findByTestId(locators.broker.verbs.row);
    await user.click(screen.getByTestId(locators.pageFreshness.refresh));
    await waitFor(() => expect(operationReads).toBe(2));
    await waitFor(() => expect(verbReads).toBe(2));
    expect(screen.getByTestId(locators.broker.ops.row)).toBeInTheDocument();
    expect(screen.getByTestId(locators.broker.verbs.row)).toBeInTheDocument();
    expect(screen.queryByTestId(locators.dataStates.loading)).not.toBeInTheDocument();
  });

  it("RepoSlots refreshes listSlots without hiding the current slots", async () => {
    const user = userEvent.setup();
    const slots = [{ name: "fresh-slot", repo: "org/fresh", strategy: "single", heldLeases: [], activeSessions: [] }];
    const secondRead = deferred<{ slots: typeof slots }>();
    let reads = 0;
    const client = safeClient({
      listSlots: async () => {
        reads += 1;
        return reads === 1 ? { slots } : secondRead.promise;
      },
    });

    renderWithClient(client, <RepoSlotsContainer />);

    await screen.findByTestId(locators.slots.row);
    await user.click(screen.getByTestId(locators.pageFreshness.refresh));
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.getByTestId(locators.slots.row)).toBeInTheDocument();
    expect(screen.queryByTestId(locators.dataStates.loading)).not.toBeInTheDocument();
  });

  it("Budgets refreshes listBudgets without hiding the current ledger", async () => {
    const user = userEvent.setup();
    const budgets = [{ taskId: "fresh-budget", spent: 11, ceiling: 20, breakerState: "closed", override: undefined }];
    const secondRead = deferred<{ budgets: typeof budgets }>();
    let reads = 0;
    const client = safeClient({
      listBudgets: async () => {
        reads += 1;
        return reads === 1 ? { budgets } : secondRead.promise;
      },
    });

    renderWithClient(client, <BudgetsContainer />);

    await screen.findByTestId(locators.budgets.ledger.row);
    await user.click(screen.getByTestId(locators.pageFreshness.refresh));
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.getByTestId(locators.budgets.ledger.row)).toBeInTheDocument();
    expect(screen.queryByTestId(locators.dataStates.loading)).not.toBeInTheDocument();
  });

  it("DaemonOps refreshes getDaemonStatus without hiding the current status", async () => {
    const user = userEvent.setup();
    const status = { version: "fresh", uptimeSeconds: 0n, lastPing: { present: true, sentAt: 1n, tasksProcessed: 3n } };
    const secondRead = deferred<typeof status>();
    let reads = 0;
    const client = safeClient({
      getDaemonStatus: async () => {
        reads += 1;
        return reads === 1 ? status : secondRead.promise;
      },
    });

    renderWithClient(client, <DaemonOpsContainer />);

    await screen.findByTestId(locators.daemonOps.healthCard);
    await user.click(screen.getByTestId(locators.pageFreshness.refresh));
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.getByTestId(locators.daemonOps.healthCard)).toBeInTheDocument();
    expect(screen.queryByTestId(locators.dataStates.loading)).not.toBeInTheDocument();
  });

  it("FeatureListContainer reads listFeatures and supplies the feature list view", async () => {
    const client = safeClient({ listFeatures: async () => ({ features: [FEATURE] }) });

    renderWithClient(
      client,
      <MemoryRouter>
        <FeatureListContainer />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId(locators.features.list.row)).toHaveTextContent(
      FEATURE.featureId,
    );
  });

  it("FeatureDetailContainer reads the feature selected by the route parameter", async () => {
    let requestedFeatureId: string | undefined;
    const client = safeClient({
      getFeature: async (request: { featureId: string }) => {
        requestedFeatureId = request.featureId;
        return FEATURE_DETAIL;
      },
    });

    renderWithClient(
      client,
      <MemoryRouter initialEntries={[`/features/${FEATURE.featureId}`]}>
        <Routes>
          <Route path="/features/:featureId" element={<FeatureDetailContainer />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByTestId(locators.features.detail.taskRow("task-container")),
    ).toBeInTheDocument();
    expect(requestedFeatureId).toBe(FEATURE.featureId);
  });

  it("FeatureDetailContainer reads a pending replan and mounts its controls tab", async () => {
    const user = userEvent.setup();
    let requestedFeatureId: string | undefined;
    const client = safeClient({
      getPendingReplanProposal: async (request: { featureId: string }) => {
        requestedFeatureId = request.featureId;
        return { proposal: PENDING_REPLAN_PROPOSAL };
      },
    });

    renderWithClient(
      client,
      <MemoryRouter initialEntries={[`/features/${FEATURE.featureId}`]}>
        <Routes>
          <Route path="/features/:featureId" element={<FeatureDetailContainer />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByTestId(locators.features.detail.taskRow("task-container"));
    await user.click(screen.getByTestId(locators.detailPage.tabTrigger("controls")));
    expect(screen.getByTestId(locators.planFlows.signOff.trigger)).toBeInTheDocument();
    expect(screen.getByTestId(locators.planFlows.halt.trigger)).toBeInTheDocument();
    expect(screen.getByTestId(locators.planFlows.replan.baseGeneration)).toHaveTextContent("8");
    expect(requestedFeatureId).toBe(FEATURE.featureId);
  });

  it("InboxContainer adapts listInboxItems data before rendering Inbox", async () => {
    const client = safeClient({
      listInboxItems: async () => ({ items: [APPROVAL_ITEM] }),
    });

    renderWithClient(client, <InboxContainer />);

    expect(await screen.findByTestId(locators.inbox.list.row)).toHaveTextContent(
      APPROVAL_ITEM.summary,
    );
  });

  it("InboxItemContainer adapts getInboxItem data and supplies approval actions for an approval", async () => {
    let requestedItemId: string | undefined;
    const client = safeClient({
      getInboxItem: async (request: { id: string }) => {
        requestedItemId = request.id;
        return { item: APPROVAL_ITEM };
      },
    });

    renderWithClient(
      client,
      <MemoryRouter initialEntries={[`/inbox/${APPROVAL_ITEM.id}`]}>
        <Routes>
          <Route path="/inbox/:id" element={<InboxItemContainer />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId(locators.inbox.item.root)).toHaveTextContent(
      APPROVAL_ITEM.summary,
    );
    expect(screen.getByTestId(locators.approvals.verb)).toHaveTextContent(
      APPROVAL_ITEM.type,
    );
    expect(requestedItemId).toBe(APPROVAL_ITEM.id);
  });

  it("BrokerContainer reads operations and verbs for both broker views", async () => {
    const client = safeClient({
      listBrokerOperations: async () => ({
        operations: [
          {
            opId: "broker-container-op",
            state: "in_flight",
            correlation: "container-correlation",
            verb: "github.commit",
            expiring: false,
          },
        ],
      }),
      listBrokerVerbs: async () => ({
        verbs: [{ verb: "github.commit", tier: "approval" }],
      }),
    });

    renderWithClient(client, <BrokerContainer />);

    expect(await screen.findByTestId(locators.broker.ops.row)).toHaveTextContent(
      "container-correlation",
    );
    expect(await screen.findByTestId(locators.broker.verbs.row)).toHaveTextContent(
      "github.commit",
    );
  });

  it("RepoSlotsContainer reads listSlots and supplies the repo slots view", async () => {
    const client = safeClient({
      listSlots: async () => ({
        slots: [
          {
            name: "container-slot",
            repo: "org/container",
            strategy: "single",
            heldLeases: [],
            activeSessions: [],
          },
        ],
      }),
    });

    renderWithClient(client, <RepoSlotsContainer />);

    expect(await screen.findByTestId(locators.slots.row)).toHaveTextContent(
      "org/container",
    );
  });

  it("BudgetsContainer adapts listBudgets data before rendering the ledger", async () => {
    const client = safeClient({
      listBudgets: async () => ({
        budgets: [
          {
            taskId: "budget-container-task",
            spent: 11,
            ceiling: 20,
            breakerState: "closed",
            override: undefined,
          },
        ],
      }),
    });

    renderWithClient(client, <BudgetsContainer />);

    expect(await screen.findByTestId(locators.budgets.ledger.row)).toHaveTextContent(
      "budget-container-task",
    );
  });

  it("DaemonOpsContainer reads daemon status and supplies the operations view", async () => {
    let daemonStatusReads = 0;
    let publicConfigurationReads = 0;
    const client = safeClient({
      getDaemonStatus: async () => {
        daemonStatusReads += 1;
        return {
          version: "test",
          uptimeSeconds: 0n,
          lastPing: { present: true, sentAt: 1n, tasksProcessed: 3n },
        };
      },
      getPublicConfiguration: async () => {
        publicConfigurationReads += 1;
        return PUBLIC_CONFIGURATION;
      },
    });

    renderWithClient(client, <DaemonOpsContainer />);

    expect(await screen.findByTestId(locators.daemonOps.healthCard)).toBeInTheDocument();
    expect(screen.getByTestId(locators.daemonOps.tasksProcessed)).toHaveTextContent("3");
    expect(await screen.findByTestId(locators.daemonOps.configurationCard)).toBeInTheDocument();
    expect(daemonStatusReads).toBe(1);
    expect(publicConfigurationReads).toBe(1);
  });

  it("InboxItemContainer reloads the open inbox after an escalation response and navigates to the deterministic next item", async () => {
    const user = userEvent.setup();
    const firstItem = {
      id: "item-a-escalation",
      kind: "escalation",
      featureId: FEATURE.featureId,
      summary: "First escalation",
      type: "write-access-request",
      severity: "medium",
      suggestedCategory: "correction",
      evidence: { type: "text", text: "first evidence" },
      status: "open",
      expiresAt: 0n,
      expired: false,
    };
    const secondItem = {
      ...firstItem,
      id: "item-b-escalation",
      summary: "Second escalation",
      evidence: { type: "text", text: "second evidence" },
    };
    const requestedItems: string[] = [];
    let listReads = 0;
    let responded = false;
    const client = safeClient({
      getInboxItem: async (request: { id: string }) => {
        requestedItems.push(request.id);
        return { item: request.id === secondItem.id ? secondItem : firstItem };
      },
      listInboxItems: async () => {
        listReads += 1;
        return { items: responded ? [secondItem] : [secondItem, firstItem] };
      },
      respondToEscalation: async () => {
        responded = true;
        return {};
      },
    });

    renderWithClient(
      client,
      <MemoryRouter initialEntries={[`/inbox/${firstItem.id}`]}>
        <Routes>
          <Route path="/inbox/:id" element={<InboxItemContainer />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId(locators.inbox.item.root)).toHaveTextContent(firstItem.summary);
    await waitFor(() => expect(listReads).toBeGreaterThanOrEqual(1));
    await user.click(screen.getByTestId(locators.inbox.respond.acceptButton));
    expect(await screen.findByTestId(locators.inbox.respond.successState)).toBeInTheDocument();
    await waitFor(() => expect(requestedItems).toHaveLength(2));
    await waitFor(() => expect(listReads).toBeGreaterThanOrEqual(2));
    expect(screen.getByTestId(locators.inbox.respond.nextOpenItem)).not.toBeDisabled();
    await user.click(screen.getByTestId(locators.inbox.respond.nextOpenItem));
    expect(await screen.findByTestId(locators.inbox.item.root)).toHaveTextContent(secondItem.summary);
    expect(requestedItems).toContain(secondItem.id);
  });

  it("InboxItemContainer reloads the item and open inbox after an approval succeeds", async () => {
    const user = userEvent.setup();
    const approvalItem = {
      ...APPROVAL_ITEM,
      id: "approval-refetch-target",
    };
    let getReads = 0;
    let listReads = 0;
    const client = safeClient({
      getInboxItem: async () => {
        getReads += 1;
        return { item: approvalItem };
      },
      listInboxItems: async () => {
        listReads += 1;
        return { items: [approvalItem] };
      },
      respondToApproval: async () => ({}),
    });

    renderWithClient(
      client,
      <MemoryRouter initialEntries={[`/inbox/${approvalItem.id}`]}>
        <Routes>
          <Route path="/inbox/:id" element={<InboxItemContainer />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByTestId(locators.approvals.approveTrigger);
    await user.click(screen.getByTestId(locators.approvals.approveTrigger));
    await user.click(screen.getByTestId(locators.confirmDialog.confirm));
    expect(await screen.findByTestId(locators.approvals.successState)).toBeInTheDocument();
    await waitFor(() => expect(getReads).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(listReads).toBeGreaterThanOrEqual(2));
  });

  it("BudgetsContainer reloads ListBudgets after a successful override", async () => {
    const user = userEvent.setup();
    let listReads = 0;
    const client = safeClient({
      listBudgets: async () => {
        listReads += 1;
        return {
          budgets: [
            {
              taskId: "budget-refetch-target",
              spent: 11,
              ceiling: 20,
              breakerState: "closed",
              override: undefined,
            },
          ],
        };
      },
      overrideBudget: async () => ({ newCeiling: 25 }),
    });

    renderWithClient(client, <BudgetsContainer />);

    await screen.findByTestId(locators.budgets.ledger.row);
    await user.click(screen.getByTestId(locators.budgets.override.trigger("budget-refetch-target")));
    await user.type(screen.getByTestId(locators.confirmDialog.input), "refetch budget after override");
    await user.click(screen.getByTestId(locators.confirmDialog.confirm));
    expect(await screen.findByTestId(locators.budgets.override.successState)).toBeInTheDocument();
    await waitFor(() => expect(listReads).toBeGreaterThanOrEqual(2));
  });
});

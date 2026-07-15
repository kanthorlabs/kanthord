import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Code, ConnectError } from "@connectrpc/connect";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import { AuthContext, AuthProvider } from "@/auth/AuthProvider";
import { AppRouter } from "@/app/AppRouter";
import { ROUTES } from "@/app/routes";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";

const FEATURE = {
  featureId: "feature-summary-target",
  status: "running",
  phase: "coding",
  progressSummary: "1/1 tasks satisfied",
  name: "Summary target",
};

const FEATURE_DETAIL = {
  featureId: FEATURE.featureId,
  status: "running",
  phase: "coding",
  stories: [
    {
      storyId: "summary-story",
      status: "running",
      tasks: [
        {
          taskId: "summary-task",
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

function setupDesktopMedia() {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function safeClient(): DaemonClient {
  return {
    listFeatures: async () => ({ features: [FEATURE] }),
    getFeature: async () => FEATURE_DETAIL,
    getFeatureSummary: async () => ({
      featureId: FEATURE.featureId,
      headline: 4,
      byConfirmedType: {
        approval: 2,
        clarification: 1,
        correction: 1,
        rework: 0,
        takeover: 0,
        external: 0,
      },
      excluded: 1,
      netCost: 11,
    }),
    listInboxItems: async () => ({
      items: [
        {
          id: "router-inbox-item",
          kind: "escalation",
          featureId: FEATURE.featureId,
          summary: "Router inbox item",
          type: "write-access-request",
          severity: "medium",
          suggestedCategory: "correction",
          evidence: { type: "text", text: "evidence" },
          status: "open",
          expiresAt: 0n,
          expired: false,
        },
      ],
    }),
    getInboxItem: async () => ({
      item: {
        id: "router-inbox-item",
        kind: "escalation",
        featureId: FEATURE.featureId,
        summary: "Router inbox item",
        type: "write-access-request",
        severity: "medium",
        suggestedCategory: "correction",
        evidence: { type: "text", text: "evidence" },
        status: "open",
        expiresAt: 0n,
        expired: false,
      },
    }),
    listBrokerOperations: async () => ({
      operations: [
        {
          opId: "router-op",
          state: "in_flight",
          correlation: "router-correlation",
          verb: "github.commit",
          expiring: false,
        },
      ],
    }),
    listBrokerVerbs: async () => ({
      verbs: [{ verb: "github.commit", tier: "approval" }],
    }),
    listSlots: async () => ({
      slots: [
        {
          name: "router-slot",
          repo: "org/router",
          strategy: "single",
          heldLeases: [],
          activeSessions: [],
        },
      ],
    }),
    listBudgets: async () => ({
      budgets: [
        {
          taskId: "router-budget-task",
          spent: 1,
          ceiling: 2,
          breakerState: "closed",
          override: undefined,
        },
      ],
    }),
    getDaemonStatus: async () => ({
      version: "test",
      uptimeSeconds: 0n,
      lastPing: { present: true, sentAt: 1n, tasksProcessed: 1n },
    }),
    triggerVerify: async () => ({ report: undefined }),
    respondToEscalation: async () => ({}),
    respondToApproval: async () => ({}),
    overrideBudget: async () => ({ newCeiling: 0 }),
  } as unknown as DaemonClient;
}

function renderRoute(path: string) {
  return render(
    <DaemonClientProvider client={safeClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AppRouter />
      </MemoryRouter>
    </DaemonClientProvider>,
  );
}

function renderRouteWithClient(path: string, client: DaemonClient) {
  return render(
    <DaemonClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRouter />
      </MemoryRouter>
    </DaemonClientProvider>,
  );
}

describe("AppRouter — real dashboard routes", () => {
  beforeEach(() => {
    setupDesktopMedia();
  });

  it("mounts the real list and operations routes inside AppShell", async () => {
    const routes = [
      [ROUTES.features, locators.features.list.row],
      [ROUTES.inbox, locators.inbox.list.row],
      [ROUTES.broker, locators.broker.ops.row],
      [ROUTES.slots, locators.slots.row],
      [ROUTES.budgets, locators.budgets.ledger.row],
      [ROUTES.ops, locators.daemonOps.healthCard],
    ] as const;

    for (const [path, surfaceLocator] of routes) {
      const result = renderRoute(path);
      expect(await screen.findByTestId(surfaceLocator)).toBeInTheDocument();
      expect(screen.getByTestId(locators.appShell.content)).toBeInTheDocument();
      result.unmount();
    }
  });

  it("mounts the real inbox item route", async () => {
    renderRoute("/inbox/router-inbox-item");

    expect(await screen.findByTestId(locators.inbox.item.root)).toBeInTheDocument();
  });

  it("reaches FeatureSummary from the feature detail summary tab", async () => {
    const user = userEvent.setup();
    renderRoute(`/features/${FEATURE.featureId}`);

    await user.click(
      await screen.findByTestId(locators.detailPage.tabTrigger("summary")),
    );

    expect(
      await screen.findByTestId(locators.metrics.featureSummary.root),
    ).toBeInTheDocument();
  });

  it("mounts the auth-required route", () => {
    renderRoute(ROUTES.authRequired);

    expect(screen.getByTestId(locators.auth.required)).toBeInTheDocument();
  });

  it("redirects the root route to features and shows the open Inbox count in AppShell", async () => {
    const openItems = [
      {
        id: "root-inbox-1",
        kind: "escalation",
        featureId: FEATURE.featureId,
        summary: "First open inbox item",
        type: "write-access-request",
        severity: "medium",
        suggestedCategory: "correction",
        evidence: { type: "text", text: "evidence" },
        status: "open",
        expiresAt: 0n,
        expired: false,
      },
      {
        id: "root-inbox-2",
        kind: "approval",
        featureId: FEATURE.featureId,
        summary: "Second open inbox item",
        type: "github.merge",
        severity: "high",
        suggestedCategory: "approval",
        evidence: { type: "text", text: "evidence" },
        status: "open",
        expiresAt: 0n,
        expired: false,
      },
    ];
    const client = {
      ...safeClient(),
      listInboxItems: async () => ({ items: openItems }),
    } as unknown as DaemonClient;

    renderRouteWithClient("/", client);

    expect(await screen.findByTestId(locators.features.list.row)).toBeInTheDocument();
    expect(screen.getByTestId(locators.appShell.navBadge)).toHaveTextContent("2");
  });

  it("does not load the Inbox count while the AuthProvider probe is pending or after it rejects as unauthenticated", async () => {
    let pendingInboxCalls = 0;
    const pendingClient = {
      ...safeClient(),
      listFeatures: () => new Promise(() => {}),
      listInboxItems: async () => {
        pendingInboxCalls += 1;
        return { items: [] };
      },
    } as unknown as DaemonClient;

    const pending = render(
      <DaemonClientProvider client={pendingClient}>
        <AuthProvider client={pendingClient}>
          <MemoryRouter initialEntries={[ROUTES.features]}>
            <AppRouter />
          </MemoryRouter>
        </AuthProvider>
      </DaemonClientProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(pendingInboxCalls).toBe(0);
    pending.unmount();

    let unauthenticatedInboxCalls = 0;
    const unauthenticatedClient = {
      ...safeClient(),
      listFeatures: async () => {
        throw new ConnectError("unauthenticated", Code.Unauthenticated);
      },
      listInboxItems: async () => {
        unauthenticatedInboxCalls += 1;
        return { items: [] };
      },
    } as unknown as DaemonClient;

    render(
      <DaemonClientProvider client={unauthenticatedClient}>
        <AuthProvider client={unauthenticatedClient}>
          <MemoryRouter initialEntries={[ROUTES.features]}>
            <AppRouter />
          </MemoryRouter>
        </AuthProvider>
      </DaemonClientProvider>,
    );

    expect(await screen.findByTestId(locators.auth.required)).toBeInTheDocument();
    expect(unauthenticatedInboxCalls).toBe(0);
  });

  it("restores an unauthenticated protected deep link when authentication becomes available", async () => {
    const client = safeClient();
    const renderTree = (status: "authenticated" | "unauthenticated") => (
      <DaemonClientProvider client={client}>
        <AuthContext.Provider value={{ status }}>
          <MemoryRouter initialEntries={[`/features/${FEATURE.featureId}`]}>
            <AppRouter />
          </MemoryRouter>
        </AuthContext.Provider>
      </DaemonClientProvider>
    );
    const result = render(renderTree("unauthenticated"));

    expect(await screen.findByTestId(locators.auth.required)).toBeInTheDocument();
    result.rerender(renderTree("authenticated"));

    expect(
      await screen.findByTestId(locators.features.detail.taskRow("summary-task")),
    ).toBeInTheDocument();
  });

  it("surfaces an Inbox-count loading failure in the shell", async () => {
    const client = {
      ...safeClient(),
      listInboxItems: async () => {
        throw new Error("Inbox count unavailable");
      },
    } as unknown as DaemonClient;

    renderRouteWithClient(ROUTES.features, client);

    expect(await screen.findByTestId(locators.appShell.navCountError)).toBeInTheDocument();
  });

  it("updates the AppShell Inbox badge after a successful inbox response changes the open count", async () => {
    const user = userEvent.setup();
    let responded = false;
    const firstItem = {
      id: "badge-response-first",
      kind: "escalation",
      featureId: FEATURE.featureId,
      summary: "First badge item",
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
      id: "badge-response-second",
      summary: "Second badge item",
    };
    const client = {
      ...safeClient(),
      getInboxItem: async () => ({ item: firstItem }),
      listInboxItems: async () => ({
        items: responded ? [secondItem] : [firstItem, secondItem],
      }),
      respondToEscalation: async () => {
        responded = true;
        return {};
      },
    } as unknown as DaemonClient;

    renderRouteWithClient(`/inbox/${firstItem.id}`, client);

    expect(await screen.findByTestId(locators.appShell.navBadge)).toHaveTextContent("2");
    await user.click(screen.getByTestId(locators.inbox.respond.acceptButton));
    expect(await screen.findByTestId(locators.inbox.respond.successState)).toBeInTheDocument();
    expect(await screen.findByTestId(locators.appShell.navBadge)).toHaveTextContent("1");
  });
});

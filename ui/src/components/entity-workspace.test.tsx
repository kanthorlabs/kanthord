import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import type { Gate } from "@/lib/entity-scope";
import { EntityWorkspace } from "./entity-workspace";

afterEach(() => {
  cleanup();
});

function makeTabs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    value: `tab-${i}`,
    label: `Tab ${i}`,
    panel: <span data-testid={`panel-${i}`}>Panel {i} content</span>,
  }));
}

describe("EntityWorkspace", () => {
  test("gate null with 3 tabs: header, tabs, single tab-panel with first panel", () => {
    const tabs = makeTabs(3);
    render(
      <MemoryRouter>
        <EntityWorkspace
          projectId="p1"
          segments={[]}
          gate={null}
          kindLabel="Initiative"
          name="init-1"
          tabs={tabs}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("entity-header")).toHaveTextContent("init-1");
    expect(screen.getByTestId("entity-header")).toHaveTextContent("Initiative");

    const tabTriggers = screen
      .getByTestId("entity-tabs")
      .querySelectorAll('[role="tab"]');
    expect(tabTriggers).toHaveLength(3);

    // Radix Tabs renders all panels in the DOM; only the active one is visible
    const panels = screen.queryAllByTestId("tab-panel");
    expect(panels).toHaveLength(3);
    expect(panels[0]).toHaveTextContent("Panel 0 content");
    expect(panels[0]).not.toHaveAttribute("hidden");
    expect(panels[1]).toHaveAttribute("hidden");
    expect(panels[1]).toBeEmptyDOMElement();
    expect(panels[2]).toHaveAttribute("hidden");
    expect(panels[2]).toBeEmptyDOMElement();
  });

  test("gate null, click second tab: single tab-panel switches to second panel", async () => {
    const user = userEvent.setup();
    const tabs = makeTabs(3);
    render(
      <MemoryRouter>
        <EntityWorkspace
          projectId="p1"
          segments={[]}
          gate={null}
          kindLabel="Initiative"
          name="init-1"
          tabs={tabs}
        />
      </MemoryRouter>,
    );

    const tabTriggers = screen
      .getByTestId("entity-tabs")
      .querySelectorAll('[role="tab"]');
    await user.click(tabTriggers[1]!);

    // Radix Tabs renders all panels; active one has the clicked tab's content
    const panels = screen.queryAllByTestId("tab-panel");
    expect(panels).toHaveLength(3);
    expect(panels[1]).toHaveTextContent("Panel 1 content");
    expect(panels[0]).toHaveAttribute("hidden");
    expect(panels[0]).toBeEmptyDOMElement();
    expect(screen.queryByText("Panel 0 content")).toBeNull();
  });

  test("gate null with tabs empty: no entity-tabs, no tab-panel, header still renders", () => {
    render(
      <MemoryRouter>
        <EntityWorkspace
          projectId="p1"
          segments={[]}
          gate={null}
          kindLabel="Initiative"
          name="init-1"
          tabs={[]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("entity-header")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-tabs")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-panel")).not.toBeInTheDocument();
  });

  test("gate async missing: exactly one async-missing, zero scope-mismatch, zero entity-header, project-shell still present", () => {
    const gate: Gate = {
      kind: "async",
      state: "missing",
      what: "task",
    };
    render(
      <MemoryRouter>
        <EntityWorkspace
          projectId="p1"
          segments={[]}
          gate={gate}
          kindLabel="Task"
          name=""
          tabs={[]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("async-missing")).toBeInTheDocument();
    expect(screen.queryByTestId("scope-mismatch")).not.toBeInTheDocument();
    expect(screen.queryByTestId("entity-header")).not.toBeInTheDocument();
    expect(screen.getByTestId("project-shell")).toBeInTheDocument();
  });

  test("gate mismatch: exactly one scope-mismatch, zero async-missing, zero entity-header", () => {
    const gate: Gate = {
      kind: "mismatch",
      info: {
        level: "task",
        what: "task",
        expected: "oB",
        actual: "oA",
        correctHref: null,
      },
    };
    render(
      <MemoryRouter>
        <EntityWorkspace
          projectId="p1"
          segments={[]}
          gate={gate}
          kindLabel="Task"
          name=""
          tabs={[]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("scope-mismatch")).toBeInTheDocument();
    expect(screen.queryByTestId("async-missing")).not.toBeInTheDocument();
    expect(screen.queryByTestId("entity-header")).not.toBeInTheDocument();
  });

  test("gate async error with message boom: alert text contains boom", () => {
    const gate: Gate = {
      kind: "async",
      state: "error",
      what: "task",
      message: "boom",
    };
    render(
      <MemoryRouter>
        <EntityWorkspace
          projectId="p1"
          segments={[]}
          gate={gate}
          kindLabel="Task"
          name=""
          tabs={[]}
        />
      </MemoryRouter>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("boom");
  });

  test("segments alpha, init-1 reach breadcrumb, breadcrumb text contains both", () => {
    render(
      <MemoryRouter>
        <EntityWorkspace
          projectId="p1"
          segments={["alpha", "init-1"]}
          gate={null}
          kindLabel="Initiative"
          name="init-1"
          tabs={[]}
        />
      </MemoryRouter>,
    );

    const breadcrumb = screen.getByTestId("breadcrumb");
    expect(breadcrumb.textContent).toContain("alpha");
    expect(breadcrumb.textContent).toContain("init-1");
    expect(breadcrumb.textContent).not.toContain("p1");
    expect(breadcrumb.textContent).not.toContain("Tab");
  });
});

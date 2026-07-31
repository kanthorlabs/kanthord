import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { GlobalShell, ProjectShell } from "./shell";

afterEach(() => {
  cleanup();
});

describe("GlobalShell", () => {
  test("renders global-shell and exactly 3 nav links in order", () => {
    render(
      <MemoryRouter>
        <GlobalShell>
          <div>child</div>
        </GlobalShell>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("global-shell")).toBeInTheDocument();

    const links = screen.getByTestId("global-nav").querySelectorAll("a");
    expect(links).toHaveLength(3);

    expect(links[0]!).toHaveTextContent("Inbox");
    expect(links[0]!.getAttribute("href")).toMatch(/\/inbox$/);
    expect(links[1]!).toHaveTextContent("Projects");
    expect(links[1]!.getAttribute("href")).toMatch(/\/project$/);
    expect(links[2]!).toHaveTextContent("Operations");
    expect(links[2]!.getAttribute("href")).toMatch(/\/operations$/);
  });

  test("renders children inside shell-main", () => {
    render(
      <MemoryRouter>
        <GlobalShell>
          <span data-testid="probe">hello</span>
        </GlobalShell>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("shell-main")).toContainElement(
      screen.getByTestId("probe"),
    );
  });

  test("freshness slot renders the given node", () => {
    render(
      <MemoryRouter>
        <GlobalShell freshness={<span data-testid="probe" />}>
          <div />
        </GlobalShell>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("header-slot")).toContainElement(
      screen.getByTestId("probe"),
    );
  });

  test("freshness slot is empty when omitted", () => {
    render(
      <MemoryRouter>
        <GlobalShell>
          <div />
        </GlobalShell>
      </MemoryRouter>,
    );

    const slot = screen.getByTestId("header-slot");
    expect(slot).toBeInTheDocument();
    expect(slot.textContent?.trim()).toBe("");
  });

  test("nav-toggle exists with accessible name", () => {
    render(
      <MemoryRouter>
        <GlobalShell>
          <div />
        </GlobalShell>
      </MemoryRouter>,
    );

    const toggle = screen.getByTestId("nav-toggle");
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-label", "Open navigation");
  });

  test("pendingCount default: nav-pending is not in document", () => {
    render(
      <MemoryRouter>
        <GlobalShell>
          <div />
        </GlobalShell>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("nav-pending")).not.toBeInTheDocument();
  });

  test("pendingCount=4 shows nav-pending with text 4", () => {
    render(
      <MemoryRouter>
        <GlobalShell pendingCount={4}>
          <div />
        </GlobalShell>
      </MemoryRouter>,
    );

    const pending = screen.getByTestId("nav-pending");
    expect(pending).toBeInTheDocument();
    expect(pending).toHaveTextContent("4");
  });
});

describe("ProjectShell", () => {
  test("renders project-shell and exactly 5 nav links in order", () => {
    render(
      <MemoryRouter>
        <ProjectShell projectId="p1" segments={["alpha"]}>
          <div>child</div>
        </ProjectShell>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("project-shell")).toBeInTheDocument();

    const links = screen.getByTestId("project-nav").querySelectorAll("a");
    expect(links).toHaveLength(5);

    expect(links[0]!).toHaveTextContent("Overview");
    expect(links[0]!.getAttribute("href")).toMatch(/\/project\/p1\/overview$/);
    expect(links[1]!).toHaveTextContent("Graph");
    expect(links[1]!.getAttribute("href")).toMatch(/\/project\/p1\/graph$/);
    expect(links[2]!).toHaveTextContent("Plan");
    expect(links[2]!.getAttribute("href")).toMatch(/\/project\/p1\/plan$/);
    expect(links[3]!).toHaveTextContent("Resources");
    expect(links[3]!.getAttribute("href")).toMatch(/\/project\/p1\/resource$/);
    expect(links[4]!).toHaveTextContent("Readiness");
    expect(links[4]!.getAttribute("href")).toMatch(/\/project\/p1\/readiness$/);
  });

  test("breadcrumb with one segment renders the segment", () => {
    render(
      <MemoryRouter>
        <ProjectShell projectId="p1" segments={["alpha"]}>
          <div />
        </ProjectShell>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("breadcrumb")).toHaveTextContent("alpha");
  });

  test("breadcrumb with two segments contains both and no project id", () => {
    render(
      <MemoryRouter>
        <ProjectShell projectId="p1" segments={["alpha", "init-1"]}>
          <div />
        </ProjectShell>
      </MemoryRouter>,
    );

    const breadcrumb = screen.getByTestId("breadcrumb");
    expect(breadcrumb.textContent).toContain("alpha");
    expect(breadcrumb.textContent).toContain("init-1");
    expect(breadcrumb.textContent).not.toContain("p1");
    expect(breadcrumb.textContent).not.toContain("Project");
  });

  test("nav-toggle exists with accessible name", () => {
    render(
      <MemoryRouter>
        <ProjectShell projectId="p1" segments={["alpha"]}>
          <div />
        </ProjectShell>
      </MemoryRouter>,
    );

    const toggle = screen.getByTestId("nav-toggle");
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-label", "Open navigation");
  });

  test("pendingCount default: nav-pending is not in document", () => {
    render(
      <MemoryRouter>
        <ProjectShell projectId="p1" segments={["alpha"]}>
          <div />
        </ProjectShell>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("nav-pending")).not.toBeInTheDocument();
  });

  test("pendingCount=7 shows nav-pending with text 7", () => {
    render(
      <MemoryRouter>
        <ProjectShell projectId="p1" segments={["alpha"]} pendingCount={7}>
          <div />
        </ProjectShell>
      </MemoryRouter>,
    );

    const pending = screen.getByTestId("nav-pending");
    expect(pending).toBeInTheDocument();
    expect(pending).toHaveTextContent("7");
  });

  test("renders children inside shell-main", () => {
    render(
      <MemoryRouter>
        <ProjectShell projectId="p1" segments={["alpha"]}>
          <span data-testid="probe">content</span>
        </ProjectShell>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("shell-main")).toContainElement(
      screen.getByTestId("probe"),
    );
  });

  // --- human review regression tests ---

  test("B3: mobile Sheet contains navigation links when opened", () => {
    render(
      <MemoryRouter>
        <GlobalShell>
          <div />
        </GlobalShell>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("nav-toggle"));

    // Sheet should contain nav links (same as desktop nav)
    const navLinks = screen.getAllByRole("link");
    const linkTexts = navLinks.map((l) => l.textContent);
    expect(linkTexts).toContain("Inbox");
    expect(linkTexts).toContain("Projects");
    expect(linkTexts).toContain("Operations");
  });

  test("S5: nav-toggle is hidden on desktop (md:hidden)", () => {
    render(
      <MemoryRouter>
        <GlobalShell>
          <div />
        </GlobalShell>
      </MemoryRouter>,
    );

    const toggle = screen.getByTestId("nav-toggle");
    expect(toggle.className).toMatch(/md:hidden/);
  });

  // --- human review regression tests (continued) ---

  test("S6: pending count is perceivable — button accessible name includes count", () => {
    render(
      <MemoryRouter>
        <GlobalShell pendingCount={4}>
          <div />
        </GlobalShell>
      </MemoryRouter>,
    );

    const toggle = screen.getByTestId("nav-toggle");
    // aria-label must include the count so screen readers announce it
    expect(toggle.getAttribute("aria-label")).toContain("4");
  });

  test("S6: ProjectShell pending count is also in accessible name", () => {
    render(
      <MemoryRouter>
        <ProjectShell projectId="p1" segments={["alpha"]} pendingCount={7}>
          <div />
        </ProjectShell>
      </MemoryRouter>,
    );

    const toggle = screen.getByTestId("nav-toggle");
    expect(toggle.getAttribute("aria-label")).toContain("7");
  });
});

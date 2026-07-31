// S5 — AsyncBoundary: presentational component over the seven-state union.
// Each state renders exactly one element with its own test id; no other async-* test id present.
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { AsyncState } from "@/lib/async-state";

afterEach(() => {
  cleanup();
});

const ALL_ASYNC_TEST_IDS = [
  "async-loading",
  "async-empty",
  "async-error",
  "async-missing",
  "async-resolved",
  "async-expired",
  "async-truncated",
] as const;

function expectOnlyTestId(_state: AsyncState, expectedTestId: string) {
  for (const tid of ALL_ASYNC_TEST_IDS) {
    if (tid === expectedTestId) {
      expect(screen.getByTestId(tid)).toBeInTheDocument();
    } else {
      expect(screen.queryByTestId(tid)).not.toBeInTheDocument();
    }
  }
}

describe("AsyncBoundary", () => {
  test("loading renders async-loading with data-role='neutral' and non-empty text", async () => {
    const { AsyncBoundary } = await import("./async-boundary");
    render(<AsyncBoundary state="loading" what="project" />);
    expectOnlyTestId("loading", "async-loading");
    const el = screen.getByTestId("async-loading");
    expect(el.textContent?.trim().length).toBeGreaterThan(0);
    expect(el.getAttribute("data-role")).toBe("neutral");
  });

  test("empty renders async-empty with data-role='neutral', not role='alert', no text-role-danger", async () => {
    const { AsyncBoundary } = await import("./async-boundary");
    render(<AsyncBoundary state="empty" what="project" />);
    expectOnlyTestId("empty", "async-empty");
    const el = screen.getByTestId("async-empty");
    expect(el.textContent?.trim().length).toBeGreaterThan(0);
    expect(el.getAttribute("data-role")).toBe("neutral");
    expect(el.getAttribute("role")).not.toBe("alert");
    expect(el.className).not.toContain("text-role-danger");
  });

  test("error renders async-error with data-role='danger', role='alert', and shows message", async () => {
    const { AsyncBoundary } = await import("./async-boundary");
    render(<AsyncBoundary state="error" what="project" message="boom" />);
    expectOnlyTestId("error", "async-error");
    const el = screen.getByTestId("async-error");
    expect(el.getAttribute("data-role")).toBe("danger");
    expect(screen.getByRole("alert")).toBe(el);
    expect(el.textContent).toContain("boom");
  });

  test("missing renders async-missing with no links and non-empty text", async () => {
    const { AsyncBoundary } = await import("./async-boundary");
    render(<AsyncBoundary state="missing" what="project" />);
    expectOnlyTestId("missing", "async-missing");
    const el = screen.getByTestId("async-missing");
    expect(el.textContent?.trim().length).toBeGreaterThan(0);
    expect(el.getAttribute("data-role")).toBe("attention");
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  test("resolved renders async-resolved with children, no data-role", async () => {
    const { AsyncBoundary } = await import("./async-boundary");
    render(
      <AsyncBoundary state="resolved" what="project">
        <div>child content</div>
      </AsyncBoundary>,
    );
    expectOnlyTestId("resolved", "async-resolved");
    expect(screen.getByTestId("async-resolved")).toHaveTextContent(
      "child content",
    );
    expect(
      screen.getByTestId("async-resolved").getAttribute("data-role"),
    ).toBeNull();
  });

  test("expired renders async-expired with data-role='attention' and non-empty text", async () => {
    const { AsyncBoundary } = await import("./async-boundary");
    render(<AsyncBoundary state="expired" what="project" />);
    expectOnlyTestId("expired", "async-expired");
    const el = screen.getByTestId("async-expired");
    expect(el.textContent?.trim().length).toBeGreaterThan(0);
    expect(el.getAttribute("data-role")).toBe("attention");
  });

  test("truncated renders async-truncated with data-role='attention' and non-empty text", async () => {
    const { AsyncBoundary } = await import("./async-boundary");
    render(<AsyncBoundary state="truncated" what="project" />);
    expectOnlyTestId("truncated", "async-truncated");
    const el = screen.getByTestId("async-truncated");
    expect(el.textContent?.trim().length).toBeGreaterThan(0);
    expect(el.getAttribute("data-role")).toBe("attention");
  });

  test("what='project' appears in loading, empty, error, missing, expired and truncated texts", async () => {
    const { AsyncBoundary } = await import("./async-boundary");

    const statesWithWhat: AsyncState[] = [
      "loading",
      "empty",
      "error",
      "missing",
      "expired",
      "truncated",
    ];
    const testIds = [
      "async-loading",
      "async-empty",
      "async-error",
      "async-missing",
      "async-expired",
      "async-truncated",
    ];

    for (let i = 0; i < statesWithWhat.length; i++) {
      const { unmount } = render(
        <AsyncBoundary
          state={statesWithWhat[i]!}
          what="project"
          message="detail"
        />,
      );
      expect(screen.getByTestId(testIds[i]!)).toHaveTextContent("project");
      unmount();
    }
  });

  // --- human review regression tests ---

  test("S3: resolved without children renders non-empty output (not blank)", async () => {
    const { AsyncBoundary } = await import("./async-boundary");
    render(<AsyncBoundary state="resolved" what="project" />);
    const el = screen.getByTestId("async-resolved");
    // An empty resolved state must not render a blank page
    expect(el.textContent?.trim().length).toBeGreaterThan(0);
  });
});

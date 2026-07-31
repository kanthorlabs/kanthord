import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { ScopeLevel, ScopeMismatchInfo } from "@/lib/entity-scope";
import { ScopeMismatch } from "./scope-mismatch";

afterEach(() => {
  cleanup();
});

const SENTENCES: Record<Exclude<ScopeLevel, "chain">, string> = {
  initiative: "This initiative exists, but not in this project.",
  objective: "This objective exists, but not in this initiative.",
  task: "This task exists, but not under this objective.",
  "resource-type": "This resource exists, but it is not of this type.",
  "resource-project": "This resource exists, but not in this project.",
};

describe("ScopeMismatch", () => {
  for (const level of Object.keys(SENTENCES) as Exclude<
    ScopeLevel,
    "chain"
  >[]) {
    test(`level ${level}: sentence is exactly the pinned string`, () => {
      const info: ScopeMismatchInfo = {
        level,
        what: "task",
        expected: "x",
        actual: "y",
        correctHref: null,
      };
      render(
        <MemoryRouter>
          <ScopeMismatch info={info} />
        </MemoryRouter>,
      );
      const el = screen.getByTestId("scope-mismatch");
      expect(el).toHaveAttribute("data-level", level);
      expect(screen.getByTestId("scope-mismatch-sentence").textContent).toBe(
        SENTENCES[level],
      );
    });
  }

  for (const what of ["project", "initiative", "objective"]) {
    test(`level chain with what=${what}: sentence interpolates the noun`, () => {
      const info: ScopeMismatchInfo = {
        level: "chain",
        what,
        expected: "",
        actual: null,
        correctHref: null,
      };
      render(
        <MemoryRouter>
          <ScopeMismatch info={info} />
        </MemoryRouter>,
      );
      expect(screen.getByTestId("scope-mismatch-sentence").textContent).toBe(
        `This URL names a ${what} that does not exist.`,
      );
    });
  }

  test("actual null → no scope-mismatch-actual element", () => {
    const info: ScopeMismatchInfo = {
      level: "task",
      what: "task",
      expected: "oB",
      actual: null,
      correctHref: null,
    };
    render(
      <MemoryRouter>
        <ScopeMismatch info={info} />
      </MemoryRouter>,
    );
    expect(
      screen.queryByTestId("scope-mismatch-actual"),
    ).not.toBeInTheDocument();
  });

  test("actual x → scope-mismatch-actual contains x", () => {
    const info: ScopeMismatchInfo = {
      level: "task",
      what: "task",
      expected: "oB",
      actual: "oA",
      correctHref: null,
    };
    render(
      <MemoryRouter>
        <ScopeMismatch info={info} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("scope-mismatch-actual").textContent).toBe("oA");
  });

  test("correctHref null → no links", () => {
    const info: ScopeMismatchInfo = {
      level: "task",
      what: "task",
      expected: "oB",
      actual: "oA",
      correctHref: null,
    };
    render(
      <MemoryRouter>
        <ScopeMismatch info={info} />
      </MemoryRouter>,
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  test("correctHref provided → exactly one link ending with that path", () => {
    const info: ScopeMismatchInfo = {
      level: "objective",
      what: "objective",
      expected: "i1",
      actual: "i2",
      correctHref: "/project/p1/initiative/i2/objective/o1",
    };
    render(
      <MemoryRouter>
        <ScopeMismatch info={info} />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toContain(
      "/project/p1/initiative/i2/objective/o1",
    );
  });

  test("element carries data-role=attention and no async test id", () => {
    const info: ScopeMismatchInfo = {
      level: "chain",
      what: "objective",
      expected: "",
      actual: null,
      correctHref: null,
    };
    render(
      <MemoryRouter>
        <ScopeMismatch info={info} />
      </MemoryRouter>,
    );
    const el = screen.getByTestId("scope-mismatch");
    expect(el).toHaveAttribute("data-role", "attention");
    expect(screen.queryByTestId("async-missing")).not.toBeInTheDocument();
    expect(screen.queryByTestId("async-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("async-error")).not.toBeInTheDocument();
  });
});

/**
 * Story 002 T3 — DiffPane composite tests.
 *
 * DiffPane is the DESIGN §5 diff-pane composite:
 *   - Renders a list of file diffs (DiffFile[])
 *   - Each DiffFile has a path and an array of lines typed as 'add' | 'del' | 'ctx'
 *   - File boundaries are preserved: each file renders its own section
 *   - Add lines carry semantic-token treatment, identified via locators.diffPane.addLine
 *   - Del lines carry semantic-token treatment, identified via locators.diffPane.delLine
 *   - Long content scrolls inside a scroll-area pane (DESIGN §7)
 *
 * DESIGN §8 locator placement:
 *   diffPane.root = root element of the pane (scroll-area or its container)
 *   diffPane.file = each per-file section
 *   diffPane.addLine = each added line
 *   diffPane.delLine = each deleted line
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because:
 *   - clients/web/src/components/DiffPane.tsx does not exist
 *   - locators.diffPane.{root,file,addLine,delLine} are not in locators.ts
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiffPane } from "@/components/DiffPane";
import { locators } from "@/locators";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MULTI_FILE_DIFF = [
  {
    path: "stories/S1.md",
    lines: [
      { type: "ctx" as const, content: "# Story S1" },
      { type: "del" as const, content: "Old task description" },
      { type: "add" as const, content: "New task description" },
      { type: "add" as const, content: "Additional context for new task" },
    ],
  },
  {
    path: "tasks/T3.md",
    lines: [
      { type: "ctx" as const, content: "## Task T3" },
      { type: "del" as const, content: "Old dependency reference: T5" },
      { type: "add" as const, content: "Updated dependency reference: T6" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DiffPane — diff pane composite (Story 002 T3)", () => {
  describe("root element renders", () => {
    it("renders the diff pane root element", () => {
      render(<DiffPane files={MULTI_FILE_DIFF} />);
      expect(
        screen.getByTestId(locators.diffPane.root)
      ).toBeInTheDocument();
    });
  });

  describe("file boundaries preserved", () => {
    it("renders a section for each file — exactly two sections for two files", () => {
      render(<DiffPane files={MULTI_FILE_DIFF} />);
      const fileSections = screen.getAllByTestId(locators.diffPane.file);
      expect(fileSections).toHaveLength(2);
    });

    it("first file section contains the path stories/S1.md", () => {
      render(<DiffPane files={MULTI_FILE_DIFF} />);
      const fileSections = screen.getAllByTestId(locators.diffPane.file);
      expect(fileSections[0]).toHaveTextContent("stories/S1.md");
    });

    it("second file section contains the path tasks/T3.md", () => {
      render(<DiffPane files={MULTI_FILE_DIFF} />);
      const fileSections = screen.getAllByTestId(locators.diffPane.file);
      expect(fileSections[1]).toHaveTextContent("tasks/T3.md");
    });

    it("first file section does not contain the second file path", () => {
      render(<DiffPane files={MULTI_FILE_DIFF} />);
      const fileSections = screen.getAllByTestId(locators.diffPane.file);
      expect(fileSections[0]).not.toHaveTextContent("tasks/T3.md");
    });
  });

  describe("add lines carry semantic-token treatment (addLine locator)", () => {
    it("renders exactly three add lines across the two-file fixture", () => {
      render(<DiffPane files={MULTI_FILE_DIFF} />);
      const addLines = screen.getAllByTestId(locators.diffPane.addLine);
      // File 1: 2 add lines; File 2: 1 add line = 3 total
      expect(addLines).toHaveLength(3);
    });

    it("first add line contains the correct add-line content", () => {
      render(<DiffPane files={MULTI_FILE_DIFF} />);
      const addLines = screen.getAllByTestId(locators.diffPane.addLine);
      expect(addLines[0]).toHaveTextContent("New task description");
    });

    it("second add line contains the correct add-line content", () => {
      render(<DiffPane files={MULTI_FILE_DIFF} />);
      const addLines = screen.getAllByTestId(locators.diffPane.addLine);
      expect(addLines[1]).toHaveTextContent("Additional context for new task");
    });

    it("third add line (from second file) contains its content", () => {
      render(<DiffPane files={MULTI_FILE_DIFF} />);
      const addLines = screen.getAllByTestId(locators.diffPane.addLine);
      expect(addLines[2]).toHaveTextContent("Updated dependency reference: T6");
    });
  });

  describe("del lines carry semantic-token treatment (delLine locator)", () => {
    it("renders exactly two del lines across the two-file fixture", () => {
      render(<DiffPane files={MULTI_FILE_DIFF} />);
      const delLines = screen.getAllByTestId(locators.diffPane.delLine);
      // File 1: 1 del line; File 2: 1 del line = 2 total
      expect(delLines).toHaveLength(2);
    });

    it("first del line contains the correct del-line content", () => {
      render(<DiffPane files={MULTI_FILE_DIFF} />);
      const delLines = screen.getAllByTestId(locators.diffPane.delLine);
      expect(delLines[0]).toHaveTextContent("Old task description");
    });

    it("second del line (from second file) contains its content", () => {
      render(<DiffPane files={MULTI_FILE_DIFF} />);
      const delLines = screen.getAllByTestId(locators.diffPane.delLine);
      expect(delLines[1]).toHaveTextContent("Old dependency reference: T5");
    });
  });

  describe("long content scrolls inside a scroll-area (DESIGN §7)", () => {
    it("renders the pane content inside a ScrollArea (data-slot='scroll-area')", () => {
      const { container } = render(<DiffPane files={MULTI_FILE_DIFF} />);
      // The scroll-area primitive sets data-slot="scroll-area" on its root
      expect(
        container.querySelector("[data-slot='scroll-area']")
      ).not.toBeNull();
    });
  });
});

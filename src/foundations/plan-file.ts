import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * Typed representation of a task file's YAML frontmatter block
 * (PRD §7.1.1 §5 task frontmatter shape).
 */
export interface TaskFrontmatter {
  ticket: string;
  write_scope: string[];
  depends_on: Array<{ task: string; output: string; semantics: string }>;
  outputs: string[];
  source_of_truth: Record<string, string>;
}

/**
 * Cast an unknown frontmatter value (returned by `parsePlanFile`) to the
 * typed `TaskFrontmatter` shape.  The caller is responsible for ensuring the
 * parsed YAML matches the shape; no runtime validation is applied here.
 */
export function asTaskFrontmatter(x: unknown): TaskFrontmatter {
  return x as TaskFrontmatter;
}

/**
 * Thrown when a plan file's `---` frontmatter fence is missing or unterminated.
 * The message always includes the file path so callers can surface it.
 */
export class PlanFileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanFileParseError";
  }
}

/**
 * Parse a plan file that begins with a `---`-fenced YAML frontmatter block.
 *
 * Returns the yaml-parsed frontmatter object and the exact remaining body
 * string (byte-preserving, no reflow).
 *
 * Throws `PlanFileParseError` (message includes `path`) if the opening or
 * closing `---` fence is absent.
 */
export function parsePlanFile(
  path: string,
  text: string,
): { frontmatter: unknown; body: string } {
  if (!text.startsWith("---\n")) {
    throw new PlanFileParseError(
      `Missing opening frontmatter fence in ${path}`,
    );
  }

  // Text after the opening "---\n"
  const afterOpen = text.slice(4);

  // The closing fence must appear as "\n---\n" (a line containing only "---")
  const closingIdx = afterOpen.indexOf("\n---\n");
  if (closingIdx === -1) {
    throw new PlanFileParseError(
      `Missing closing frontmatter fence in ${path}`,
    );
  }

  const yamlBlock = afterOpen.slice(0, closingIdx);
  const body = afterOpen.slice(closingIdx + "\n---\n".length);

  const frontmatter = parseYaml(yamlBlock) as unknown;
  return { frontmatter, body };
}

/**
 * Partition a plan-file body string into sections keyed by `## Heading` text.
 *
 * Each key is the heading text (without the leading `## `).  The value is the
 * raw content between that heading line and the next `## ` heading (or
 * end-of-string).  An empty section maps to an empty or whitespace-only string.
 */
export function sections(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  const headingRe = /^## (.+)$/gm;
  let prevHeading: string | null = null;
  let prevContentStart = 0;

  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(body)) !== null) {
    const headingText = match[1] ?? "";
    if (prevHeading !== null) {
      result[prevHeading] = body.slice(prevContentStart, match.index);
    }
    prevHeading = headingText;
    // match[0] does not include the trailing \n (multiline $ matches before \n),
    // so +1 positions prevContentStart after the newline following the heading.
    prevContentStart = match.index + match[0].length + 1;
  }

  if (prevHeading !== null) {
    result[prevHeading] = body.slice(prevContentStart);
  }

  return result;
}

/**
 * Serialize an arbitrary frontmatter object to a `---`-fenced YAML block.
 *
 * The output is a string of the form `---\n<yaml>\n---\n`, which
 * `parsePlanFile` can parse back to an equal object (round-trip stable).
 */
export function serializeFrontmatter(obj: unknown): string {
  const yamlText = stringifyYaml(obj);
  // yaml.stringify always appends a trailing newline; guard to keep the fence
  // delimiter on its own line even if that contract ever changes.
  const normalized = yamlText.endsWith("\n") ? yamlText : `${yamlText}\n`;
  return `---\n${normalized}---\n`;
}

/**
 * Pure graph-package codec — parse (string → DTO) and serialize (DTO → string).
 * Zero I/O: parsing accepts pre-read file contents; serialization returns strings.
 *
 * RF1: exposes `parseTask` for single-file task parsing (no package machinery).
 * RF2: `parseGraphPackage` takes already-read `{sourcePath, content}[]` (no dir walk).
 */
import { parse as parseYaml } from "yaml";
import type {
  GraphPackage,
  PkgInitiative,
  PkgObjective,
  PkgTask,
  ExportManifest,
} from "./graph-package.ts";
import { DEFAULT_AGENT } from "./format.ts";
import { DuplicateRefError } from "./import-errors.ts";
import { classifyRef } from "./refs.ts";

// ---------------------------------------------------------------------------
// Frontmatter extraction
// ---------------------------------------------------------------------------

/** Extract raw YAML frontmatter from a markdown file's content. */
function extractFrontmatter(content: string): Record<string, unknown> | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return null;
  const yamlText = content.slice(3, end).trim();
  return parseYaml(yamlText) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Body section parsing
// ---------------------------------------------------------------------------

/**
 * Extract the body of a markdown file (everything after the closing `---`
 * of frontmatter). Returns `""` when frontmatter is not present.
 */
function extractBody(content: string): string {
  if (!content.startsWith("---")) return "";
  const end = content.indexOf("\n---", 3);
  if (end === -1) return "";
  const afterClose = content.indexOf("\n", end + 1);
  if (afterClose === -1) return "";
  return content.slice(afterClose + 1);
}

/**
 * Split the body into named sections keyed by their `# Heading` text.
 * Returns a map from lowercased heading text → section body lines.
 */
function splitSections(body: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let currentKey: string | null = null;
  let currentLines: string[] = [];

  for (const line of body.split("\n")) {
    const headingMatch = /^#{1,6}\s+(.+)$/.exec(line);
    if (headingMatch) {
      if (currentKey !== null) {
        sections.set(currentKey, currentLines);
      }
      currentKey = (headingMatch[1] ?? "").trim().toLowerCase();
      currentLines = [];
    } else {
      if (currentKey !== null) {
        currentLines.push(line);
      }
    }
  }
  if (currentKey !== null) {
    sections.set(currentKey, currentLines);
  }
  return sections;
}

/** Extract `instructions` from a section's lines: join trimmed lines. */
function extractInstructions(lines: string[]): string {
  return lines.join("\n").trim();
}

/**
 * Extract `ac` from `# Acceptance Criteria` lines.
 * Each `- [ ] <text>` is one item (single-line).
 */
function extractAc(lines: string[], sourcePath: string): string[] {
  const items: string[] = [];
  let prevWasItem = false;

  for (const line of lines) {
    if (line === "" || line.trim() === "") {
      prevWasItem = false;
      continue;
    }
    if (prevWasItem && /^[ \t]{2}/.test(line)) {
      throw new Error(
        `multi-line ac item is not allowed (single-line rule, B12) in ${sourcePath}: continuation: "${line.trim()}"`,
      );
    }
    const itemMatch = /^- \[ \] (.+)$/.exec(line) ?? /^\* (.+)$/.exec(line);
    if (itemMatch) {
      items.push(itemMatch[1] ?? "");
      prevWasItem = true;
    } else {
      prevWasItem = false;
    }
  }
  return items;
}

/**
 * Extract `verification` from `# Verification` lines.
 * Looks for a ```sh fence; absent section → `undefined`; empty fence → `[]`.
 */
function extractVerification(
  lines: string[] | undefined,
): string[] | undefined {
  if (lines === undefined) return undefined;

  let inFence = false;
  let fenceFound = false;
  const commands: string[] = [];

  for (const line of lines) {
    if (!inFence && /^```sh\s*$/.test(line)) {
      inFence = true;
      fenceFound = true;
      continue;
    }
    if (inFence && /^```\s*$/.test(line)) {
      inFence = false;
      continue;
    }
    if (inFence) {
      const trimmed = line.trimEnd();
      if (trimmed !== "") {
        commands.push(trimmed);
      }
    }
  }

  if (!fenceFound) return undefined;
  return commands;
}

// ---------------------------------------------------------------------------
// DTO node builders
// ---------------------------------------------------------------------------

function buildInitiative(
  fm: Record<string, unknown>,
  sourcePath: string,
): PkgInitiative {
  const id = typeof fm["id"] === "string" ? (fm["id"] as string) : undefined;
  const ref =
    typeof fm["ref"] === "string"
      ? (fm["ref"] as string)
      : id !== undefined
        ? id
        : "";
  const name = typeof fm["name"] === "string" ? (fm["name"] as string) : "";
  const rawBindings = fm["bindings"];
  const bindings =
    typeof rawBindings === "object" && rawBindings !== null
      ? (rawBindings as Record<string, string>)
      : undefined;
  return { id, ref, name, sourcePath, bindings };
}

function buildObjective(
  fm: Record<string, unknown>,
  sourcePath: string,
): PkgObjective {
  const id = typeof fm["id"] === "string" ? (fm["id"] as string) : undefined;
  const ref =
    typeof fm["ref"] === "string"
      ? (fm["ref"] as string)
      : id !== undefined
        ? id
        : "";
  const name = typeof fm["name"] === "string" ? (fm["name"] as string) : "";
  const initiativeRef =
    typeof fm["initiative"] === "string" ? (fm["initiative"] as string) : "";
  const rawContext = fm["context"];
  const context =
    typeof rawContext === "object" && rawContext !== null
      ? (rawContext as Record<string, string>)
      : undefined;
  return { id, ref, initiativeRef, name, sourcePath, context };
}

function buildTask(
  fm: Record<string, unknown>,
  content: string,
  sourcePath: string,
): PkgTask {
  const id = typeof fm["id"] === "string" ? (fm["id"] as string) : undefined;
  const ref =
    typeof fm["ref"] === "string"
      ? (fm["ref"] as string)
      : id !== undefined
        ? id
        : "";
  const objectiveRef =
    typeof fm["objective"] === "string" ? (fm["objective"] as string) : "";
  const title = typeof fm["title"] === "string" ? (fm["title"] as string) : "";
  const agent =
    typeof fm["agent"] === "string" ? (fm["agent"] as string) : DEFAULT_AGENT;

  let dependsOn: string[] = [];
  const rawDeps = fm["depends-on"];
  if (Array.isArray(rawDeps)) {
    dependsOn = rawDeps.filter((d): d is string => typeof d === "string");
  }
  for (const dep of dependsOn) {
    classifyRef(dep);
  }

  const body = extractBody(content);
  const sections = splitSections(body);

  const instructionLines = sections.get("instructions");
  const instructions =
    instructionLines !== undefined ? extractInstructions(instructionLines) : "";

  const acLines = sections.get("acceptance criteria");
  const ac = acLines !== undefined ? extractAc(acLines, sourcePath) : [];

  const verificationLines = sections.get("verification");
  const verification = extractVerification(verificationLines);

  const rawContext = fm["context"];
  const context =
    typeof rawContext === "object" && rawContext !== null
      ? (rawContext as Record<string, string>)
      : undefined;

  return {
    id,
    ref,
    objectiveRef,
    title,
    instructions,
    ac,
    agent,
    verification,
    dependsOn,
    sourcePath,
    context,
  };
}

// ---------------------------------------------------------------------------
// Public parse API
// ---------------------------------------------------------------------------

/**
 * Parse a single markdown task file's content into a `PkgTask` DTO (RF1).
 * Does not require an initiative file or a package directory.
 * Throws if the content has no frontmatter.
 */
export function parseTask(content: string, sourcePath?: string): PkgTask {
  const sp = sourcePath ?? "";
  const fm = extractFrontmatter(content);
  if (fm === null) {
    throw new Error(`no frontmatter found${sp ? ` in ${sp}` : ""}`);
  }
  return buildTask(fm, content, sp);
}

/**
 * Parse a graph-package from already-read file contents (RF2).
 * `files` is an array of `{ sourcePath, content }` entries — relative paths.
 * Include `.kanthord-export.json` in the array to populate `manifest`.
 * Throws if no initiative file is found.
 */
export function parseGraphPackage(
  files: { sourcePath: string; content: string }[],
): GraphPackage {
  let initiative: PkgInitiative | null = null;
  const objectives: PkgObjective[] = [];
  const tasks: PkgTask[] = [];
  let manifest: ExportManifest | undefined;
  let packageId = "";
  let formatVersion = 1;

  for (const { sourcePath, content } of files) {
    if (sourcePath === ".kanthord-export.json") {
      manifest = JSON.parse(content) as ExportManifest;
      packageId = manifest.packageId;
      formatVersion = manifest.formatVersion;
      continue;
    }
    const fm = extractFrontmatter(content);
    if (!fm) continue;
    const kind = fm["kind"];
    if (kind === "initiative") {
      initiative = buildInitiative(fm, sourcePath);
    } else if (kind === "objective") {
      objectives.push(buildObjective(fm, sourcePath));
    } else if (kind === "task") {
      tasks.push(buildTask(fm, content, sourcePath));
    }
  }

  if (!initiative) {
    throw new Error("no initiative file found in package");
  }

  const taskRefMap = new Map<string, string>();
  for (const task of tasks) {
    const existing = taskRefMap.get(task.ref);
    if (existing !== undefined) {
      throw new DuplicateRefError(existing, task.sourcePath, task.ref);
    }
    taskRefMap.set(task.ref, task.sourcePath);
  }

  return {
    packageId,
    formatVersion,
    initiative,
    objectives,
    tasks,
    manifest,
  };
}

// ---------------------------------------------------------------------------
// Serialize helpers
// ---------------------------------------------------------------------------

/**
 * YAML scalar safety: single-quote a string value when the yaml library would
 * otherwise coerce it to a non-string type on round-trip.
 */
function yamlScalar(value: string): string {
  if (
    /^\d+$/.test(value) ||
    /^(true|false|yes|no|on|off|null|~)$/i.test(value)
  ) {
    return `'${value}'`;
  }
  return value;
}

/**
 * Emit `id:` only, `ref:` only, or both — depending on the node's identity.
 */
function identityLines(id: string | undefined, ref: string): string[] {
  if (id === undefined) {
    return [`ref: ${yamlScalar(ref)}`];
  }
  if (id === ref) {
    return [`id: ${yamlScalar(id)}`];
  }
  return [`id: ${yamlScalar(id)}`, `ref: ${yamlScalar(ref)}`];
}

function serializeInitiative(node: PkgInitiative): string {
  const lines = [
    "---",
    "kind: initiative",
    ...identityLines(node.id, node.ref),
    `name: ${node.name}`,
  ];
  if (node.bindings !== undefined && Object.keys(node.bindings).length > 0) {
    lines.push("bindings:");
    for (const [k, v] of Object.entries(node.bindings)) {
      lines.push(`  ${k}: ${v}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

function serializeObjective(node: PkgObjective): string {
  const lines = [
    "---",
    "kind: objective",
    ...identityLines(node.id, node.ref),
    `initiative: ${yamlScalar(node.initiativeRef)}`,
    `name: ${node.name}`,
  ];
  if (node.context !== undefined && Object.keys(node.context).length > 0) {
    lines.push("context:");
    for (const [k, v] of Object.entries(node.context)) {
      lines.push(`  ${k}: ${v}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

function serializeTask(node: PkgTask): string {
  const fmLines: string[] = [
    "---",
    "kind: task",
    ...identityLines(node.id, node.ref),
    `objective: ${yamlScalar(node.objectiveRef)}`,
    `title: ${node.title}`,
    `agent: ${node.agent}`,
  ];

  const sortedDeps = [...node.dependsOn].sort();
  if (sortedDeps.length > 0) {
    fmLines.push(`depends-on: [${sortedDeps.map(yamlScalar).join(", ")}]`);
  }
  if (node.context !== undefined && Object.keys(node.context).length > 0) {
    fmLines.push("context:");
    for (const [k, v] of Object.entries(node.context)) {
      fmLines.push(`  ${k}: ${v}`);
    }
  }
  fmLines.push("---");

  const bodyLines: string[] = [];
  bodyLines.push("# Instructions");
  bodyLines.push(node.instructions);
  bodyLines.push("# Acceptance Criteria");
  for (const item of node.ac) {
    bodyLines.push(`- [ ] ${item}`);
  }

  if (node.verification !== undefined) {
    bodyLines.push("# Verification");
    bodyLines.push("```sh");
    if (node.verification !== null) {
      for (const cmd of node.verification) {
        bodyLines.push(cmd);
      }
    }
    bodyLines.push("```");
  }

  bodyLines.push("");

  return [...fmLines, ...bodyLines].join("\n");
}

// ---------------------------------------------------------------------------
// Public serialize API
// ---------------------------------------------------------------------------

/**
 * Serialize a graph node to its canonical markdown bytes (B9/B16).
 */
export function serializeNode(
  node: PkgTask | PkgObjective | PkgInitiative,
): string {
  if ("objectiveRef" in node) {
    return serializeTask(node as PkgTask);
  }
  if ("initiativeRef" in node) {
    return serializeObjective(node as PkgObjective);
  }
  return serializeInitiative(node as PkgInitiative);
}

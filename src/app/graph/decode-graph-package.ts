/**
 * Server-side validator for an already-parsed JSON graph package (a JSON
 * document, NOT markdown) — the trust-boundary closer for `CreateGraph` and
 * `ApplyGraph` over HTTP. This is deliberately NOT the client-side markdown
 * codec (`parseGraphPackage` in `./graph-codec.ts`), which parses `.md`
 * source files and never runs on the server.
 */
import type { GraphPackage } from "./graph-package.ts";

export class GraphPackageDocumentError extends Error {
  readonly field: string;

  constructor(field: string, detail: string) {
    super(`invalid graph package: ${field} ${detail}`);
    this.name = "GraphPackageDocumentError";
    this.field = field;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(
  obj: Record<string, unknown>,
  key: string,
  field: string,
): void {
  const v = obj[key];
  if (typeof v !== "string" || v === "") {
    throw new GraphPackageDocumentError(field, "must be a non-empty string");
  }
}

function requireNumberField(
  obj: Record<string, unknown>,
  key: string,
  field: string,
): void {
  if (typeof obj[key] !== "number") {
    throw new GraphPackageDocumentError(field, "must be a number");
  }
}

function requireStringArrayField(
  obj: Record<string, unknown>,
  key: string,
  field: string,
): void {
  const v = obj[key];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
    throw new GraphPackageDocumentError(field, "must be an array of strings");
  }
}

function optionalStringArrayField(
  obj: Record<string, unknown>,
  key: string,
  field: string,
): void {
  const v = obj[key];
  if (v === undefined) return;
  requireStringArrayField(obj, key, field);
}

function optionalStringRecordField(
  obj: Record<string, unknown>,
  key: string,
  field: string,
): void {
  const v = obj[key];
  if (v === undefined) return;
  if (
    !isPlainRecord(v) ||
    !Object.values(v).every((x) => typeof x === "string")
  ) {
    throw new GraphPackageDocumentError(field, "must be an object of strings");
  }
}

function requireStringRecordField(
  obj: Record<string, unknown>,
  key: string,
  field: string,
): void {
  const v = obj[key];
  if (
    !isPlainRecord(v) ||
    !Object.values(v).every((x) => typeof x === "string")
  ) {
    throw new GraphPackageDocumentError(field, "must be an object of strings");
  }
}

/**
 * Structurally validate an already-parsed graph package (a JSON document, NOT
 * markdown) and return it typed. Validates exactly the fields `CreateGraph` and
 * `ApplyGraph` dereference — nothing more, so it cannot drift into a second
 * schema. Never touches the filesystem and never parses markdown.
 *
 * `packageId` is optional (review blocker S1): `project.graph.create` mints
 * its own id via `deps.newId()` and discards the client's, and the CLI's
 * create-mode parser emits `packageId: ""` for a package with no
 * `.kanthord-export.json` yet. When present it must still be a string.
 */
export function parseGraphPackageDocument(value: unknown): GraphPackage {
  if (!isPlainRecord(value)) {
    throw new GraphPackageDocumentError("pkg", "must be an object");
  }
  const hasRecognizedTopLevelKey =
    "packageId" in value ||
    "formatVersion" in value ||
    "initiative" in value ||
    "objectives" in value ||
    "tasks" in value;
  if (!hasRecognizedTopLevelKey) {
    throw new GraphPackageDocumentError("pkg", "must be an object");
  }

  const packageId = value["packageId"];
  if (packageId !== undefined && typeof packageId !== "string") {
    throw new GraphPackageDocumentError("packageId", "must be a string");
  }
  requireNumberField(value, "formatVersion", "formatVersion");

  const initiative = value["initiative"];
  if (!isPlainRecord(initiative)) {
    throw new GraphPackageDocumentError("initiative", "must be an object");
  }
  requireNonEmptyString(initiative, "ref", "initiative.ref");
  requireNonEmptyString(initiative, "name", "initiative.name");
  requireNonEmptyString(initiative, "sourcePath", "initiative.sourcePath");
  optionalStringArrayField(initiative, "after", "initiative.after");
  optionalStringRecordField(initiative, "bindings", "initiative.bindings");

  const objectives = value["objectives"];
  if (!Array.isArray(objectives)) {
    throw new GraphPackageDocumentError("objectives", "must be an array");
  }
  objectives.forEach((obj: unknown, i: number) => {
    const field = `objectives[${i}]`;
    if (!isPlainRecord(obj)) {
      throw new GraphPackageDocumentError(field, "must be an object");
    }
    requireNonEmptyString(obj, "ref", `${field}.ref`);
    requireNonEmptyString(obj, "initiativeRef", `${field}.initiativeRef`);
    requireNonEmptyString(obj, "name", `${field}.name`);
    requireNonEmptyString(obj, "sourcePath", `${field}.sourcePath`);
    optionalStringArrayField(obj, "after", `${field}.after`);
    optionalStringRecordField(obj, "context", `${field}.context`);
  });

  const tasks = value["tasks"];
  if (!Array.isArray(tasks)) {
    throw new GraphPackageDocumentError("tasks", "must be an array");
  }
  tasks.forEach((t: unknown, i: number) => {
    const field = `tasks[${i}]`;
    if (!isPlainRecord(t)) {
      throw new GraphPackageDocumentError(field, "must be an object");
    }
    requireNonEmptyString(t, "ref", `${field}.ref`);
    requireNonEmptyString(t, "objectiveRef", `${field}.objectiveRef`);
    requireNonEmptyString(t, "title", `${field}.title`);
    requireNonEmptyString(t, "instructions", `${field}.instructions`);
    requireNonEmptyString(t, "agent", `${field}.agent`);
    requireNonEmptyString(t, "sourcePath", `${field}.sourcePath`);
    requireStringArrayField(t, "ac", `${field}.ac`);
    requireStringArrayField(t, "dependencies", `${field}.dependencies`);
    const verification = t["verification"];
    if (
      verification !== undefined &&
      verification !== null &&
      !(
        Array.isArray(verification) &&
        verification.every((x) => typeof x === "string")
      )
    ) {
      throw new GraphPackageDocumentError(
        `${field}.verification`,
        "must be absent, null, or an array of strings",
      );
    }
    optionalStringRecordField(t, "context", `${field}.context`);
  });

  const manifest = value["manifest"];
  if (manifest !== undefined) {
    if (!isPlainRecord(manifest)) {
      throw new GraphPackageDocumentError("manifest", "must be an object");
    }
    requireNonEmptyString(manifest, "initiativeId", "manifest.initiativeId");
    requireNonEmptyString(manifest, "packageId", "manifest.packageId");
    requireNumberField(manifest, "formatVersion", "manifest.formatVersion");
    if (manifest["digestAlgorithm"] !== "sha256") {
      throw new GraphPackageDocumentError(
        "manifest.digestAlgorithm",
        "must be 'sha256'",
      );
    }
    requireStringRecordField(manifest, "nodes", "manifest.nodes");
    const refToId = manifest["refToId"];
    if (
      !isPlainRecord(refToId) ||
      !isPlainRecord(refToId["objectives"]) ||
      !Object.values(refToId["objectives"]).every(
        (x) => typeof x === "string",
      ) ||
      !isPlainRecord(refToId["tasks"]) ||
      !Object.values(refToId["tasks"]).every((x) => typeof x === "string")
    ) {
      throw new GraphPackageDocumentError(
        "manifest.refToId",
        "must be {objectives, tasks} objects of strings",
      );
    }
    requireStringArrayField(manifest, "files", "manifest.files");
    optionalStringArrayField(manifest, "objectiveIds", "manifest.objectiveIds");
  }

  return value as unknown as GraphPackage;
}

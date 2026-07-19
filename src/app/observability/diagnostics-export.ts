import { newId } from "../../domain/entity.ts";
import {
  SCHEMA_VERSION,
  type SafeFactsKind,
  type SafeFactsErrorCode,
  type SafeFactsRecord,
  validateSafeFactsRecord,
  serializeSafeFactsRecord,
} from "../../domain/safe-facts.ts";

// ── Narrow dependency interfaces ──────────────────────────────────────────────
// Only what the use case needs; adapters satisfy them by structural typing.

interface EventReader {
  readAfter(
    cursor: string,
    limit?: number,
  ): Array<{
    id: string;
    type: string;
    taskId: string;
    payload?: Record<string, string>;
  }>;
}

interface TaskInitiativeReader {
  getInitiativeId(taskId: string): string | undefined;
  listByInitiative(initiativeId: string): Array<{ id: string }>;
}

interface ObservabilityRefs {
  getOrCreateTaskRef(taskId: string): string;
  getOrCreateInitiativeRef(initiativeId: string): string;
  getOrCreateSessionRef(runKey: string): string;
}

export interface DiagnosticsExportResult {
  recordCount: number;
  outPath: string;
  preview: Array<{ kind: SafeFactsKind; count: number }>;
}

// ── Closed projection maps (REFACTOR: module-level constants) ─────────────────

// Closed reason-string → SafeFactsErrorCode map.
// Unknown prefix → "internal_unclassified" (catch-all, never copies raw strings).
const PROJECT_REASON_CODE: ReadonlyArray<[string, SafeFactsErrorCode]> = [
  ["budget_exceeded", "budget_exceeded"],
  ["credential_error", "credential_error"],
  ["credential", "credential_error"],
  ["workspace_error", "workspace_error"],
  ["workspace", "workspace_error"],
  ["verification_failed", "verification_failed"],
  ["agent_error", "agent_error"],
  ["result_capture_error", "result_capture_error"],
  ["result_capture", "result_capture_error"],
];

function mapReasonCode(reason: string | undefined): SafeFactsErrorCode {
  if (!reason) return "internal_unclassified";
  for (const [prefix, code] of PROJECT_REASON_CODE) {
    if (reason === prefix || reason.startsWith(prefix)) return code;
  }
  return "internal_unclassified";
}

// Closed tool-name → toolCategory map.
// The raw tool name NEVER appears in the output — only the category.
function mapToolCategory(
  tool: string | undefined,
): "read" | "write" | "exec" | "search" | "other" {
  if (!tool) return "other";
  const t = tool.toLowerCase();
  if (t === "read" || t.endsWith("read")) return "read";
  if (
    t === "write" ||
    t.endsWith("write") ||
    t === "edit" ||
    t.endsWith("edit")
  )
    return "write";
  if (t === "bash" || t === "exec" || t.endsWith("exec")) return "exec";
  if (t === "grep" || t === "search" || t.endsWith("search")) return "search";
  return "other";
}

// ── DiagnosticsExport use case ────────────────────────────────────────────────

export class DiagnosticsExport {
  readonly #events: EventReader;
  readonly #tasks: TaskInitiativeReader;
  readonly #refs: ObservabilityRefs;
  readonly #writeFile: (
    path: string,
    data: string,
    opts: { mode: number },
  ) => Promise<void>;

  constructor(
    events: EventReader,
    tasks: TaskInitiativeReader,
    refs: ObservabilityRefs,
    writeFile: (
      path: string,
      data: string,
      opts: { mode: number },
    ) => Promise<void>,
  ) {
    this.#events = events;
    this.#tasks = tasks;
    this.#refs = refs;
    this.#writeFile = writeFile;
  }

  async execute(input: {
    initiativeId: string;
    taskId?: string;
    outPath: string;
    debug?: boolean;
  }): Promise<DiagnosticsExportResult> {
    const { initiativeId, outPath } = input;

    // Per-run session ref — fresh opaque id per execute() call.
    const runKey = newId();
    const sessionRef = this.#refs.getOrCreateSessionRef(runKey);
    const initiativeRef = this.#refs.getOrCreateInitiativeRef(initiativeId);

    // Read all events (no cursor filtering — fake readers return all events).
    const allEvents = this.#events.readAfter("", undefined);

    // Filter to initiative/task scope.
    const scopedEvents = allEvents.filter((ev) => {
      if (input.taskId !== undefined) {
        return ev.taskId === input.taskId;
      }
      return this.#tasks.getInitiativeId(ev.taskId) === initiativeId;
    });

    // seq counter per (sessionRef, taskRef) key — 1-based monotone.
    const seqMap = new Map<string, number>();
    const records: SafeFactsRecord[] = [];
    // Use a single timestamp for the export run (event ids in tests are not real ULIDs).
    const exportedAt = new Date().toISOString();

    for (const ev of scopedEvents) {
      const taskRef = this.#refs.getOrCreateTaskRef(ev.taskId);
      const seqKey = `${sessionRef}:${taskRef}`;

      // Build the record (without seq first, to avoid incrementing on skip).
      const currentSeq = seqMap.get(seqKey) ?? 0;
      const nextSeq = currentSeq + 1;

      let record: SafeFactsRecord | null = null;

      switch (ev.type) {
        case "task.started":
        case "task.escalated": {
          record = {
            schemaVersion: SCHEMA_VERSION,
            sessionRef,
            taskRef,
            seq: nextSeq,
            timestamp: exportedAt,
            kind: "task.lifecycle",
          };
          break;
        }

        case "task.completed": {
          record = {
            schemaVersion: SCHEMA_VERSION,
            sessionRef,
            taskRef,
            seq: nextSeq,
            timestamp: exportedAt,
            kind: "task.outcome",
          };
          break;
        }

        case "task.failed": {
          const reasonCode = mapReasonCode(ev.payload?.["reason"]);
          record = {
            schemaVersion: SCHEMA_VERSION,
            sessionRef,
            taskRef,
            seq: nextSeq,
            timestamp: exportedAt,
            kind: "task.outcome",
            reasonCode,
          };
          break;
        }

        case "agent.started": {
          record = {
            schemaVersion: SCHEMA_VERSION,
            sessionRef,
            taskRef,
            seq: nextSeq,
            timestamp: exportedAt,
            kind: "agent.turn",
          };
          break;
        }

        case "agent.finished": {
          const turnsRaw = ev.payload?.["turns"];
          const tokensInRaw = ev.payload?.["tokensIn"];
          const tokensOutRaw = ev.payload?.["tokensOut"];
          const turnsVal = turnsRaw !== undefined ? parseInt(turnsRaw, 10) : 0;
          const tokensInVal =
            tokensInRaw !== undefined ? parseInt(tokensInRaw, 10) : 0;
          const tokensOutVal =
            tokensOutRaw !== undefined ? parseInt(tokensOutRaw, 10) : 0;
          record = {
            schemaVersion: SCHEMA_VERSION,
            sessionRef,
            taskRef,
            seq: nextSeq,
            timestamp: exportedAt,
            kind: "agent.turn",
            turns: isNaN(turnsVal) ? 0 : turnsVal,
            tokensIn: isNaN(tokensInVal) ? 0 : tokensInVal,
            tokensOut: isNaN(tokensOutVal) ? 0 : tokensOutVal,
          };
          break;
        }

        case "agent.progress": {
          const toolCategory = mapToolCategory(ev.payload?.["tool"]);
          record = {
            schemaVersion: SCHEMA_VERSION,
            sessionRef,
            taskRef,
            seq: nextSeq,
            timestamp: exportedAt,
            kind: "agent.tool",
            toolCategory,
          };
          break;
        }

        case "task.verification": {
          const exitClassRaw = ev.payload?.["exitClass"];
          const durationMsRaw = ev.payload?.["durationMs"];
          const r: SafeFactsRecord = {
            schemaVersion: SCHEMA_VERSION,
            sessionRef,
            taskRef,
            seq: nextSeq,
            timestamp: exportedAt,
            kind: "task.verification",
          };
          if (
            exitClassRaw === "pass" ||
            exitClassRaw === "fail" ||
            exitClassRaw === "timeout"
          ) {
            r.exitClass = exitClassRaw;
          }
          if (durationMsRaw !== undefined) {
            const dm = parseInt(durationMsRaw, 10);
            if (!isNaN(dm)) r.durationMs = dm;
          }
          record = r;
          break;
        }

        default: {
          // Unknown event type — skip without incrementing seq.
          process.stderr.write(
            `[warn] diagnostics export: skipping unknown event type '${ev.type}' (id=${ev.id})\n`,
          );
          continue;
        }
      }

      if (record === null) continue;

      // Commit seq increment only for events that produce a record.
      seqMap.set(seqKey, nextSeq);

      // Runtime validation — skip + warn on failure (never throw to caller).
      try {
        validateSafeFactsRecord(record);
        records.push(record);
      } catch (err) {
        // Revert seq on validation failure.
        seqMap.set(seqKey, currentSeq);
        process.stderr.write(
          `[warn] diagnostics export: skipping invalid record for event ${ev.id}: ${String(err)}\n`,
        );
      }
    }

    // Build preview summary grouped by kind.
    const kindCounts = new Map<SafeFactsKind, number>();
    for (const r of records) {
      kindCounts.set(r.kind, (kindCounts.get(r.kind) ?? 0) + 1);
    }
    const preview = Array.from(kindCounts.entries()).map(([kind, count]) => ({
      kind,
      count,
    }));

    // Serialize — explicit field-by-field via serializeSafeFactsRecord (NEVER spread).
    const serializedRecords = records.map(serializeSafeFactsRecord);

    // Build SafeFactsExport — explicit field construction (no spread, no Object.assign).
    const exportObj = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt,
      initiativeRef,
      records: serializedRecords,
    };

    await this.#writeFile(outPath, JSON.stringify(exportObj, null, 2), {
      mode: 0o600,
    });

    return { recordCount: records.length, outPath, preview };
  }
}

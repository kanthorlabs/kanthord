/** Structural mirror of SafeFactsRecord (src/domain/safe-facts.ts:23-38). */
export interface DiagnosticRecordResult {
  readonly schemaVersion: string;
  readonly sessionRef: string;
  readonly taskRef: string;
  readonly seq: number;
  readonly timestamp: string;
  readonly kind: string;
  readonly outcomeCode?: string;
  readonly reasonCode?: string;
  readonly toolCategory?: string;
  readonly exitClass?: string;
  readonly durationMs?: number;
  readonly turns?: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
}

/** Structural mirror of SafeFactsExport (src/domain/safe-facts.ts:40-45). */
export interface DiagnosticResult {
  readonly schemaVersion: string;
  readonly exportedAt: string;
  readonly initiativeRef: string;
  readonly records: readonly DiagnosticRecordResult[];
}

export interface DiagnosticRecordView {
  readonly schemaVersion: string;
  readonly sessionRef: string;
  readonly taskRef: string;
  readonly seq: number;
  readonly timestamp: string;
  readonly kind: string;
  readonly outcomeCode?: string;
  readonly reasonCode?: string;
  readonly toolCategory?: string;
  readonly exitClass?: string;
  readonly durationMs?: number;
  readonly turns?: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
}

export function diagnosticRecordView(
  r: DiagnosticRecordResult,
): DiagnosticRecordView {
  return {
    schemaVersion: r.schemaVersion,
    sessionRef: r.sessionRef,
    taskRef: r.taskRef,
    seq: r.seq,
    timestamp: r.timestamp,
    kind: r.kind,
    ...(r.outcomeCode !== undefined ? { outcomeCode: r.outcomeCode } : {}),
    ...(r.reasonCode !== undefined ? { reasonCode: r.reasonCode } : {}),
    ...(r.toolCategory !== undefined ? { toolCategory: r.toolCategory } : {}),
    ...(r.exitClass !== undefined ? { exitClass: r.exitClass } : {}),
    ...(r.durationMs !== undefined ? { durationMs: r.durationMs } : {}),
    ...(r.turns !== undefined ? { turns: r.turns } : {}),
    ...(r.tokensIn !== undefined ? { tokensIn: r.tokensIn } : {}),
    ...(r.tokensOut !== undefined ? { tokensOut: r.tokensOut } : {}),
  };
}

export interface DiagnosticView {
  readonly schemaVersion: string;
  readonly exportedAt: string;
  readonly initiativeRef: string;
  readonly records: DiagnosticRecordView[];
}

export function diagnosticView(r: DiagnosticResult): DiagnosticView {
  return {
    schemaVersion: r.schemaVersion,
    exportedAt: r.exportedAt,
    initiativeRef: r.initiativeRef,
    records: r.records.map(diagnosticRecordView),
  };
}

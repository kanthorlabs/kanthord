import type { ReadinessEntry } from "../../../app/graph/check-graph.ts";
import type {
  ReadinessReport,
  CheckRecord,
  NextAction,
  ProbeRecord,
} from "../../../app/project/project-readiness.ts";

export interface ReadinessEntryView {
  readonly id: string;
  readonly state: ReadinessEntry["state"];
  readonly waiting: string[];
  readonly [key: string]: unknown;
}

export function readinessEntryView(r: ReadinessEntry): ReadinessEntryView {
  return { id: r.id, state: r.state, waiting: [...r.waiting] };
}

export interface ProbeRecordView {
  readonly resourceId: string;
  readonly status: ProbeRecord["status"];
  readonly detail: string;
}

export function probeRecordView(r: ProbeRecord): ProbeRecordView {
  return { resourceId: r.resourceId, status: r.status, detail: r.detail };
}

export interface CheckRecordView {
  readonly name: CheckRecord["name"];
  readonly status: CheckRecord["status"];
  readonly blocking: boolean;
  readonly detail: string;
  readonly probes?: ProbeRecordView[];
  readonly ageSeconds?: number | null;
}

export function checkRecordView(r: CheckRecord): CheckRecordView {
  return {
    name: r.name,
    status: r.status,
    blocking: r.blocking,
    detail: r.detail,
    ...(r.probes !== undefined
      ? { probes: r.probes.map(probeRecordView) }
      : {}),
    ...(r.ageSeconds !== undefined ? { ageSeconds: r.ageSeconds } : {}),
  };
}

export interface NextActionView {
  readonly check: NextAction["check"];
  readonly action: string;
  readonly requiresInput: string[];
  readonly command?: string;
}

export function nextActionView(r: NextAction): NextActionView {
  return {
    check: r.check,
    action: r.action,
    requiresInput: [...r.requiresInput],
    ...(r.command !== undefined ? { command: r.command } : {}),
  };
}

export interface ProjectReadinessView {
  readonly projectId: string;
  readonly configured: boolean;
  readonly verified: boolean | null;
  readonly operational: boolean;
  readonly ready: boolean;
  readonly checks: CheckRecordView[];
  readonly next: NextActionView | null;
  readonly [key: string]: unknown;
}

export function projectReadinessView(r: ReadinessReport): ProjectReadinessView {
  return {
    projectId: r.projectId,
    configured: r.configured,
    verified: r.verified,
    operational: r.operational,
    ready: r.ready,
    checks: r.checks.map(checkRecordView),
    next: r.next === null ? null : nextActionView(r.next),
  };
}

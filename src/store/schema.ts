/**
 * Unified schema aggregator for all subsystems.
 *
 * initSchema(store) is idempotent: every subsystem init uses
 * CREATE TABLE IF NOT EXISTS, so calling it twice is safe.
 *
 * This is the single bootstrap entry point for daemon boot and test harness
 * setup. All subsystem tables are created here; there are no lazy per-method
 * DDL calls anywhere in the codebase.
 */

import type { Store } from "../foundations/sqlite-store.ts";
import { initBrokerSchema } from "../broker/schema.ts";
import { initInboxSchema } from "../inbox/schema.ts";
import { initRpcSchema } from "../rpc/schema.ts";
import { initSchedulerSubsystemSchema } from "../scheduler/schema.ts";
import { initRing1Schema } from "../ring1/schema.ts";
import { initTaskTimelineSchema } from "../metrics/task-timeline.ts";
import { initModelCallLogSchema } from "../metrics/model-call-log.ts";
import { initInteractionCaptureSchema } from "../metrics/interaction-capture.ts";
import { initExternalTrackingSchema } from "./external-tracking-schema.ts";

export function initSchema(store: Store): void {
  initBrokerSchema(store);
  initInboxSchema(store);
  initRpcSchema(store);
  initSchedulerSubsystemSchema(store);
  initRing1Schema(store);
  initTaskTimelineSchema(store);
  initModelCallLogSchema(store);
  initInteractionCaptureSchema(store);
  initExternalTrackingSchema(store);
}

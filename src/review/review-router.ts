import { createHash } from "node:crypto";
import type { Store } from "../foundations/sqlite-store.ts";
import type { Clock } from "../foundations/clock.ts";
import { createEscalationItem } from "../inbox/inbox.ts";

export interface ReviewRequest {
  taskId: string;
  prNumber: number;
  prUrl: string;
}

export interface ReviewRouter {
  requestReview(req: ReviewRequest): Promise<void>;
}

/**
 * Derive the inbox item id the same way createEscalationItem does:
 *   deterministicId("esc", source_id) = "esc:" + sha256(source_id).slice(0,32)
 */
function escalationId(sourceId: string): string {
  const digest = createHash("sha256").update(sourceId).digest("hex").slice(0, 32);
  return `esc:${digest}`;
}

export class UserReviewRouter implements ReviewRouter {
  readonly #store: Store;
  readonly #clock: Clock;

  constructor({ store, clock }: { store: Store; clock: Clock }) {
    this.#store = store;
    this.#clock = clock;
  }

  async requestReview(req: ReviewRequest): Promise<void> {
    // Deterministic source_id from taskId + prNumber so calls are idempotent.
    const sourceId = `review_requested:${req.taskId}:${req.prNumber}`;

    createEscalationItem({
      source_id: sourceId,
      task_id: req.taskId,
      reason: "review_requested",
      payload_summary: `PR #${req.prNumber}: ${req.prUrl}`,
      store: this.#store,
      clock: this.#clock,
    });

    // Augment evidence with pr_number and pr_url after the INSERT OR IGNORE.
    // The row may already exist (idempotent restart); we still patch the evidence
    // to ensure pr_number / pr_url are present even if they weren't on first write.
    const id = escalationId(sourceId);
    const existing = this.#store.get<{ evidence: string }>(
      `SELECT evidence FROM inbox_items WHERE id = ?`,
      id,
    );
    if (existing !== undefined) {
      const ev = JSON.parse(existing.evidence) as Record<string, unknown>;
      ev["pr_number"] = req.prNumber;
      ev["pr_url"] = req.prUrl;
      this.#store.run(
        `UPDATE inbox_items SET evidence = ? WHERE id = ?`,
        JSON.stringify(ev),
        id,
      );
    }
  }
}

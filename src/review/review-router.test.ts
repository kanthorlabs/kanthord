import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import { FakeClock } from "../foundations/clock.ts";
import { initSchema } from "../store/schema.ts";
// RED: module does not exist yet — import will fail
import type { ReviewRouter, ReviewRequest } from "./review-router.ts";
import { UserReviewRouter } from "./review-router.ts";

// Suite: src/review/review-router.ts
// Story 019.18-001 Task T1 — ReviewRouter seam + UserReviewRouter

describe("src/review/review-router.ts", () => {
  // -------------------------------------------------------------------------
  // T1a — UserReviewRouter records open escalation with review_requested reason
  // -------------------------------------------------------------------------
  test("UserReviewRouter records inbox escalation with review_requested reason, task id, PR number and url", async () => {
    const dir = await mkdtemp(join(tmpdir(), "review-router-t1a-"));
    try {
      const store = openStore(join(dir, "review.db"), { busyTimeout: 1000 });
      initSchema(store);
      const clock = new FakeClock(2000);
      const router = new UserReviewRouter({ store, clock });

      const req: ReviewRequest = {
        taskId: "task-review-001",
        prNumber: 5,
        prUrl: "https://github.com/example/repo/pull/5",
      };
      await router.requestReview(req);

      const rows = store
        .all<{ id: string; kind: string; status: string; evidence: string }>(
          `SELECT id, kind, status, evidence FROM inbox_items WHERE kind = 'escalation'`,
        )
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          status: r.status,
          evidence: JSON.parse(r.evidence) as Record<string, unknown>,
        }));

      assert.equal(rows.length, 1, "exactly one inbox item must be created");
      const row = rows[0];
      assert.ok(row, "inbox item must exist");
      assert.equal(row.kind, "escalation", "kind must be 'escalation'");
      assert.equal(row.status, "open", "status must be 'open'");
      assert.equal(
        row.evidence["reason"],
        "review_requested",
        "evidence.reason must be 'review_requested'",
      );
      assert.equal(
        row.evidence["task_id"],
        "task-review-001",
        "evidence must carry task_id",
      );
      assert.equal(
        row.evidence["pr_number"],
        5,
        "evidence must carry pr_number",
      );
      assert.equal(
        row.evidence["pr_url"],
        "https://github.com/example/repo/pull/5",
        "evidence must carry pr_url",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T1b — idempotent: calling requestReview twice creates only one inbox item
  // -------------------------------------------------------------------------
  test("UserReviewRouter is idempotent — calling requestReview twice does not duplicate inbox items", async () => {
    const dir = await mkdtemp(join(tmpdir(), "review-router-t1b-"));
    try {
      const store = openStore(join(dir, "review.db"), { busyTimeout: 1000 });
      initSchema(store);
      const clock = new FakeClock(3000);
      const router = new UserReviewRouter({ store, clock });

      const req: ReviewRequest = {
        taskId: "task-idem-001",
        prNumber: 7,
        prUrl: "https://github.com/example/repo/pull/7",
      };
      await router.requestReview(req);
      await router.requestReview(req);

      const count = store.get<{ c: number }>(
        `SELECT COUNT(*) as c FROM inbox_items WHERE kind = 'escalation'`,
      );
      assert.equal(count?.["c"], 1, "idempotent: must produce exactly one row");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T1c — seam: a hand-written fake can implement the ReviewRouter interface
  // -------------------------------------------------------------------------
  test("ReviewRouter interface can be implemented by a fake (seam is pluggable)", async () => {
    const captured: ReviewRequest[] = [];

    // Type-level seam proof: a plain object satisfying the interface compiles
    const fake: ReviewRouter = {
      async requestReview(req: ReviewRequest): Promise<void> {
        captured.push(req);
      },
    };

    await fake.requestReview({
      taskId: "task-fake-001",
      prNumber: 3,
      prUrl: "https://example.com/pull/3",
    });

    assert.equal(captured.length, 1, "fake must receive the request");
    assert.equal(captured[0]?.taskId, "task-fake-001");
  });
});

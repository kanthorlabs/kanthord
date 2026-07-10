import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonlLog } from "../foundations/jsonl.ts";
import {
  SIGNAL_MAP,
  recordInteraction,
  queryInteractionsByFeature,
  MissingCategoryError,
  InvalidCategoryError,
} from "./interaction-capture.ts";

describe("src/metrics/interaction-capture.ts", () => {
  test("approval-tier-verb signal proposes 'approval'; accept-of-proposal recorded; actor and cost written to event", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ic-t1a-"));
    try {
      const log = new JsonlLog(join(dir, "interactions.jsonl"));
      await recordInteraction({
        item_id: "apv:abc123",
        task_id: "task-1",
        feature_id: "feat-1",
        signal: "approval-tier-verb",
        confirmed_category: "approval",
        actor: "operator",
        timestamp: 1000,
        cost_to_date: 42.5,
        no_ledger: false,
        log,
      });
      const events = await log.readAll();
      assert.equal(events.length, 1);
      const evt = events[0] as Record<string, unknown>;
      assert.equal(evt["item_id"], "apv:abc123");
      assert.equal(evt["task_id"], "task-1");
      assert.equal(evt["feature_id"], "feat-1");
      assert.equal(evt["proposed_type"], "approval");
      assert.equal(evt["confirmed_category"], "approval");
      assert.equal(evt["classification_mode"], "accept");
      assert.equal(evt["actor"], "operator");
      assert.equal(evt["timestamp"], 1000);
      assert.equal(evt["cost_to_date"], 42.5);
      assert.equal(evt["no_ledger"], false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("budget-breach signal proposes 'correction'; override recorded when confirmed differs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ic-t1b-"));
    try {
      const log = new JsonlLog(join(dir, "interactions.jsonl"));
      await recordInteraction({
        item_id: "esc:def456",
        task_id: "task-2",
        feature_id: "feat-1",
        signal: "budget-breach",
        confirmed_category: "rework",
        actor: "operator",
        timestamp: 2000,
        cost_to_date: 100,
        no_ledger: false,
        log,
      });
      const events = await log.readAll();
      const evt = events[0] as Record<string, unknown>;
      assert.equal(evt["proposed_type"], "correction");
      assert.equal(evt["confirmed_category"], "rework");
      assert.equal(evt["classification_mode"], "override");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("response without a category throws MissingCategoryError", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ic-t1c-"));
    try {
      const log = new JsonlLog(join(dir, "interactions.jsonl"));
      await assert.rejects(
        () =>
          recordInteraction({
            item_id: "apv:xyz",
            task_id: "task-3",
            feature_id: "feat-1",
            signal: "approval-tier-verb",
            confirmed_category: "",
            actor: "operator",
            timestamp: 3000,
            cost_to_date: 0,
            no_ledger: false,
            log,
          }),
        MissingCategoryError,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("out-of-vocabulary confirmed category throws InvalidCategoryError", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ic-t1d-"));
    try {
      const log = new JsonlLog(join(dir, "interactions.jsonl"));
      await assert.rejects(
        () =>
          recordInteraction({
            item_id: "apv:xyz",
            task_id: "task-4",
            feature_id: "feat-1",
            signal: "approval-tier-verb",
            confirmed_category: "not-a-type",
            actor: "operator",
            timestamp: 4000,
            cost_to_date: 0,
            no_ledger: false,
            log,
          }),
        InvalidCategoryError,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("task with no ledger emits cost_to_date=0 and no_ledger=true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ic-t1e-"));
    try {
      const log = new JsonlLog(join(dir, "interactions.jsonl"));
      await recordInteraction({
        item_id: "apv:nolg",
        task_id: "task-5",
        feature_id: "feat-1",
        signal: "approval-tier-verb",
        confirmed_category: "approval",
        actor: "operator",
        timestamp: 5000,
        cost_to_date: 0,
        no_ledger: true,
        log,
      });
      const events = await log.readAll();
      const evt = events[0] as Record<string, unknown>;
      assert.equal(evt["cost_to_date"], 0);
      assert.equal(evt["no_ledger"], true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("SIGNAL_MAP maps 'approval-tier-verb' to 'approval' and 'budget-breach' to 'correction'", () => {
    assert.equal(SIGNAL_MAP["approval-tier-verb"], "approval");
    assert.equal(SIGNAL_MAP["budget-breach"], "correction");
  });

  describe("T2 — exclusion tag and per-feature query", () => {
    test("unclassified-artifact-change tag emits excluded_from_automation_metric=true", async () => {
      const dir = await mkdtemp(join(tmpdir(), "ic-t2a-"));
      try {
        const log = new JsonlLog(join(dir, "interactions.jsonl"));
        await recordInteraction({
          item_id: "esc:uac1",
          task_id: "task-uac",
          feature_id: "feat-uac",
          signal: "budget-breach",
          confirmed_category: "correction",
          actor: "operator",
          timestamp: 6000,
          cost_to_date: 10,
          no_ledger: false,
          tags: ["unclassified-artifact-change"],
          log,
        });
        const events = await log.readAll();
        assert.equal(events.length, 1);
        const evt = events[0] as Record<string, unknown>;
        assert.equal(evt["excluded_from_automation_metric"], true);
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    test("events filter by feature id across two features", async () => {
      const dir = await mkdtemp(join(tmpdir(), "ic-t2b-"));
      try {
        const log = new JsonlLog(join(dir, "interactions.jsonl"));
        // Two events for feat-A, one for feat-B
        await recordInteraction({
          item_id: "apv:fa1",
          task_id: "task-a1",
          feature_id: "feat-A",
          signal: "approval-tier-verb",
          confirmed_category: "approval",
          actor: "op",
          timestamp: 7001,
          cost_to_date: 0,
          no_ledger: true,
          log,
        });
        await recordInteraction({
          item_id: "apv:fa2",
          task_id: "task-a2",
          feature_id: "feat-A",
          signal: "approval-tier-verb",
          confirmed_category: "approval",
          actor: "op",
          timestamp: 7002,
          cost_to_date: 5,
          no_ledger: false,
          log,
        });
        await recordInteraction({
          item_id: "esc:fb1",
          task_id: "task-b1",
          feature_id: "feat-B",
          signal: "budget-breach",
          confirmed_category: "correction",
          actor: "op",
          timestamp: 7003,
          cost_to_date: 20,
          no_ledger: false,
          log,
        });
        const featAEvents = await queryInteractionsByFeature(log, "feat-A");
        assert.equal(featAEvents.length, 2);
        assert.ok(featAEvents.every((e) => (e as Record<string, unknown>)["feature_id"] === "feat-A"));
        const featBEvents = await queryInteractionsByFeature(log, "feat-B");
        assert.equal(featBEvents.length, 1);
        assert.equal((featBEvents[0] as Record<string, unknown>)["feature_id"], "feat-B");
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });
});

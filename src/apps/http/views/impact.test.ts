import { test } from "node:test";
import assert from "node:assert/strict";
import {
  discardPreviewView,
  taskRejectionView,
  objectiveRejectionView,
} from "./impact.ts";
import type { DiscardPreview } from "../../../app/errors.ts";

test("discardPreviewView: exact top-level keys, damage-entry keys, target keys; extra fields dropped", () => {
  const result = {
    damage: [
      {
        target: { type: "task", id: "t1", name: "Task One", extra: "drop" },
        effect: "left-blocked",
        extra: "drop",
      },
    ],
    counts: {
      "discarded-by-cascade": 0,
      "left-blocked": 1,
      "permanently-unsatisfiable": 0,
    },
    digest: "abc123",
    extra: "drop",
  } as unknown as DiscardPreview;
  const view = discardPreviewView(result) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(view).sort(), ["counts", "damage", "digest"]);
  const damage = view.damage as Record<string, unknown>[];
  assert.equal(damage.length, 1);
  assert.deepEqual(Object.keys(damage[0]!).sort(), ["effect", "target"]);
  const target = damage[0]!.target as Record<string, unknown>;
  assert.deepEqual(Object.keys(target).sort(), ["id", "name", "type"]);
  assert.equal(target.id, "t1");
  assert.equal(target.name, "Task One");
  assert.equal(target.type, "task");
  assert.equal(damage[0]!.effect, "left-blocked");
  assert.equal(view.digest, "abc123");
});

test("discardPreviewView: counts keys are exactly the three damage effects", () => {
  const result: DiscardPreview = {
    damage: [],
    counts: {
      "discarded-by-cascade": 0,
      "left-blocked": 0,
      "permanently-unsatisfiable": 0,
    },
    digest: "empty",
  };
  const view = discardPreviewView(result) as unknown as Record<string, unknown>;
  const counts = view.counts as Record<string, unknown>;
  assert.deepEqual(Object.keys(counts).sort(), [
    "discarded-by-cascade",
    "left-blocked",
    "permanently-unsatisfiable",
  ]);
});

test("taskRejectionView: exact keys, skipped is a copy not an alias", () => {
  const skipped = ["s1"];
  const preview: DiscardPreview = {
    damage: [],
    counts: {
      "discarded-by-cascade": 0,
      "left-blocked": 0,
      "permanently-unsatisfiable": 0,
    },
    digest: "d1",
  };
  const view = taskRejectionView({ skipped, preview }) as unknown as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(view).sort(), ["preview", "skipped"]);
  skipped.push("s2");
  assert.deepEqual(view.skipped, ["s1"]);
});

// ─── EPIC 023 Story S4 — objectiveRejectionView ───

test("objectiveRejectionView: exact keys ['preview'], nested preview keys are counts/damage/digest", () => {
  const preview: DiscardPreview = {
    damage: [],
    counts: {
      "discarded-by-cascade": 0,
      "left-blocked": 0,
      "permanently-unsatisfiable": 0,
    },
    digest: "d1",
  };
  const view = objectiveRejectionView({ preview }) as unknown as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(view), ["preview"]);
  const nested = view.preview as Record<string, unknown>;
  assert.deepEqual(Object.keys(nested).sort(), ["counts", "damage", "digest"]);
});

test("objectiveRejectionView: never carries a skipped key", () => {
  const preview: DiscardPreview = {
    damage: [],
    counts: {
      "discarded-by-cascade": 0,
      "left-blocked": 0,
      "permanently-unsatisfiable": 0,
    },
    digest: "d1",
  };
  const view = objectiveRejectionView({ preview }) as unknown as Record<
    string,
    unknown
  >;
  assert.equal("skipped" in view, false);
});

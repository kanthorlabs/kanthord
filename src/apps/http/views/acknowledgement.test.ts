// src/apps/http/views/acknowledgement.test.ts — EPIC 022 Story S1.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acknowledgementView,
  type AcknowledgementResult,
} from "./acknowledgement.ts";

test("acknowledgementView leak test: an object carrying cursor plus an extra field presents only cursor", () => {
  const source = {
    cursor: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    stored: "leak-me",
  } as unknown as AcknowledgementResult;

  const view = acknowledgementView(source);

  assert.deepEqual(Object.keys(view).sort(), ["cursor"]);
  assert.equal(view.cursor, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
});

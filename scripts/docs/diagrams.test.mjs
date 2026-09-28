import assert from "node:assert/strict";
import test from "node:test";
import { diagramZoom } from "../../docs/assets/diagrams.mjs";

test("fit follows the container while actual size restores the natural width", () => {
  assert.deepEqual(diagramZoom("fit", 5120, 1280), {
    width: "100%",
    label: "Fit",
  });
  assert.deepEqual(diagramZoom("actual", 5120, 1280), {
    width: "5120px",
    label: "100%",
  });
});

test("zoom steps start at the currently rendered fit scale", () => {
  assert.deepEqual(diagramZoom("in", 5120, 1280), {
    width: "1792px",
    label: "35%",
  });
  assert.deepEqual(diagramZoom("out", 5120, 1280), {
    width: "768px",
    label: "15%",
  });
});

test("zoom stays bounded while fit can accommodate very small screens", () => {
  assert.deepEqual(diagramZoom("in", 2000, 4000), {
    width: "4000px",
    label: "200%",
  });
  assert.deepEqual(diagramZoom("out", 2000, 20), {
    width: "20px",
    label: "1%",
  });
  assert.deepEqual(diagramZoom("fit", 100000, 320), {
    width: "100%",
    label: "Fit",
  });
});

test("invalid dimensions and actions fail explicitly", () => {
  const invalid = [0, -1, NaN, Infinity];
  assert.equal(invalid.length, 4);
  for (const width of invalid) {
    assert.throws(() => diagramZoom("fit", width, 100), /Diagram width/);
    assert.throws(() => diagramZoom("in", 100, width), /Rendered width/);
  }
  assert.throws(() => diagramZoom("unknown", 100, 100), /Unknown.*action/);
});

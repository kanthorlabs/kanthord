import assert from "node:assert/strict";
import test from "node:test";
import { viewerTarget } from "../../docs/assets/redirect.mjs";

test("a section page maps to its HTML page and keeps the anchor", () => {
  assert.equal(
    viewerTarget("?p=reference/upgrade.md", "#reset"),
    "reference/upgrade.html#reset",
  );
});

test("a README maps to the index page", () => {
  assert.equal(viewerTarget("?p=README.md", ""), "index.html");
  assert.equal(
    viewerTarget("?p=reference/erd/README.md", "#map"),
    "reference/erd/index.html#map",
  );
});

test("a path outside the public sections goes to the home page", () => {
  for (const search of [
    "",
    "?p=brainstorm/agent.md",
    "?p=DESIGN.md",
    "?p=../secret.md",
    "?p=https://example.com/x.md",
    "?p=//example.com/x.md",
    "?p=reference/page.html",
  ])
    assert.equal(viewerTarget(search, "#x"), "index.html", search);
});

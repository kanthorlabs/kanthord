// src/apps/http/ui.test.ts — Story 06: the UI shell document.
import test from "node:test";
import assert from "node:assert/strict";
import { UI_SHELL_HTML, uiShell } from "./ui.ts";

test("UI_SHELL_HTML contains the required markers", () => {
  assert.ok(UI_SHELL_HTML.includes("<!doctype html>"));
  assert.ok(UI_SHELL_HTML.includes("<title>kanthord</title>"));
  assert.ok(UI_SHELL_HTML.includes('id="health"'));
  assert.ok(UI_SHELL_HTML.includes("/healthz"));
  assert.ok(UI_SHELL_HTML.includes("same-origin"));
});

test("UI_SHELL_HTML contains none of the forbidden substrings", () => {
  assert.ok(!UI_SHELL_HTML.includes("<script src"));
  assert.ok(!UI_SHELL_HTML.includes('<link rel="stylesheet"'));
  assert.ok(!UI_SHELL_HTML.includes("http://"));
  assert.ok(!UI_SHELL_HTML.includes("https://"));
});

test("uiShell() returns UI_SHELL_HTML by identity", () => {
  assert.equal(uiShell(), UI_SHELL_HTML);
});

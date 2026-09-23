import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  resolveMarkdownLink,
  validatePath,
} from "../../docs/assets/navigation.mjs";

const root = fileURLToPath(new URL("../../docs/", import.meta.url));

test("accepts public nested Markdown paths only", () => {
  assert.equal(validatePath("README.md"), "README.md");
  assert.equal(
    validatePath("reference/api/gateway/verify.md"),
    "reference/api/gateway/verify.md",
  );
  const rejected = [
    null,
    "",
    "overview.md",
    "brainstorm/README.md",
    "engine/docs/README.md",
    "../README.md",
    "/README.md",
    "reference/../brainstorm/README.md",
    "reference//README.md",
    "reference/%2e%2e/README.md",
    "reference\\README.md",
    "https://example.com/a.md",
    "reference/README.md?x=1",
    "reference/README.md#anchor",
    "reference/" + "a".repeat(512) + ".md",
  ];
  assert.ok(rejected.length < 32);
  for (const path of rejected)
    assert.equal(validatePath(path), null, String(path));
});

test("resolves sibling, parent, index and fragment links from the document directory", () => {
  assert.equal(
    resolveMarkdownLink("verify.md", "reference/api/gateway/openapi.md"),
    "viewer.html?p=reference%2Fapi%2Fgateway%2Fverify.md",
  );
  assert.equal(
    resolveMarkdownLink(
      "../../errors.md#api-failures",
      "reference/api/gateway/verify.md",
    ),
    "viewer.html?p=reference%2Ferrors.md#api-failures",
  );
  assert.equal(
    resolveMarkdownLink("../README.md", "reference/README.md"),
    "viewer.html?p=README.md",
  );
  assert.equal(
    resolveMarkdownLink("./reference/README.md", "README.md"),
    "viewer.html?p=reference%2FREADME.md",
  );
});

test("rejects escapes, private links, schemes and query tricks", () => {
  const rejected = [
    "../brainstorm/README.md",
    "../../README.md",
    "/README.md",
    "//evil.invalid/a.md",
    "https://evil.invalid/a.md",
    "javascript:a.md",
    "data:a.md",
    "%2e%2e/README.md",
    "..\\README.md",
    "README.md?p=brainstorm/README.md",
    "#errors",
  ];
  assert.ok(rejected.length < 32);
  for (const href of rejected)
    assert.equal(resolveMarkdownLink(href, "reference/README.md"), null, href);
  assert.throws(
    () => resolveMarkdownLink("README.md", "brainstorm/README.md"),
    /Invalid current/,
  );
  assert.throws(() => resolveMarkdownLink(null, "README.md"), /string/);
});

test("every public relative Markdown link resolves to its actual document", () => {
  const paths = readdirSync(root, { recursive: true }).filter(
    (path) => path.endsWith(".md") && !path.startsWith("brainstorm" + sep),
  );
  assert.ok(paths.length > 10);
  assert.ok(paths.length < 256);
  for (const path of paths) {
    const text = readFileSync(resolve(root, path), "utf8");
    const links = [
      ...text.matchAll(/\[[^\]\n]*\]\(([^\s)]+\.md(?:#[^)]*)?)\)/g),
    ];
    assert.ok(links.length < 256);
    for (const [, href] of links) {
      if (/^https?:/.test(href)) continue;
      const result = resolveMarkdownLink(href, path.split(sep).join("/"));
      const url = new URL(result, "https://example.com/project/");
      const expected = relative(
        root,
        resolve(root, dirname(path), href.split("#")[0]),
      );
      assert.equal(
        url.searchParams.get("p"),
        expected.split(sep).join("/"),
        `${path}: ${href}`,
      );
      assert.equal(url.pathname, "/project/viewer.html");
    }
  }
});

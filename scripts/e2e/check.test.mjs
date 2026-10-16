import assert from "node:assert/strict";
import test from "node:test";
import {
  githubAuthHeader,
  matchesScratch,
  matchesSecret,
  pendingCheckAction,
  shouldPause,
} from "./check.mjs";

test("scratch-path: matches .kanthord paths", () => {
  assert.equal(matchesScratch(".kanthord/config"), true);
  assert.equal(matchesScratch("subdir/.kanthord"), true);
});

test("scratch-path: matches scratch in path segment", () => {
  assert.equal(matchesScratch("scratch"), true);
  assert.equal(matchesScratch("my-scratch-file.js"), true);
  assert.equal(matchesScratch("dir/scratch/foo.js"), true);
});

test("scratch-path: matches forbidden extensions", () => {
  assert.equal(matchesScratch("file.tmp"), true);
  assert.equal(matchesScratch("app.log"), true);
  assert.equal(matchesScratch("backup.bak"), true);
  assert.equal(matchesScratch("file~"), true);
  assert.equal(matchesScratch("merge.orig"), true);
  assert.equal(matchesScratch(".env"), true);
  assert.equal(matchesScratch("dir/.env"), true);
  assert.equal(matchesScratch("data.db"), true);
});

test("scratch-path: matches node_modules", () => {
  assert.equal(matchesScratch("node_modules/foo/bar.js"), true);
  assert.equal(matchesScratch("dir/node_modules/pkg"), true);
});

test("scratch-path: case-insensitive", () => {
  assert.equal(matchesScratch("file.TMP"), true);
  assert.equal(matchesScratch("file.LOG"), true);
  assert.equal(matchesScratch(".KANTHORD/x"), true);
});

test("scratch-path: allows normal source files", () => {
  assert.equal(matchesScratch("src/index.js"), false);
  assert.equal(matchesScratch("README.md"), false);
  assert.equal(matchesScratch("package.json"), false);
  assert.equal(matchesScratch("test/foo.test.js"), false);
});

test("secret: matches GitHub tokens", () => {
  assert.equal(
    matchesSecret("+" + "ghp" + "_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"),
    true,
  );
  assert.equal(
    matchesSecret("+" + "ghs" + "_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"),
    true,
  );
  assert.equal(
    matchesSecret("+" + "gho" + "_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"),
    true,
  );
  assert.equal(
    matchesSecret("+" + "ghu" + "_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"),
    true,
  );
  assert.equal(
    matchesSecret("+" + "ghr" + "_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"),
    true,
  );
});

test("secret: matches github_pat_", () => {
  assert.equal(matchesSecret("+" + "github" + "_pat_11ABCDEF0"), true);
});

test("secret: matches OpenAI-style sk- key", () => {
  assert.equal(
    matchesSecret("+" + "sk" + "-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"),
    true,
  );
});

test("secret: matches AWS access key", () => {
  assert.equal(matchesSecret("+" + "AKIA" + "IOSFODNN7EXAMPLE"), true);
});

test("secret: matches private key header", () => {
  assert.equal(
    matchesSecret("+" + "-----BEGIN" + " RSA PRIVATE KEY-----"),
    true,
  );
  assert.equal(
    matchesSecret("+" + "-----BEGIN" + " EC PRIVATE KEY-----"),
    true,
  );
  assert.equal(matchesSecret("+" + "-----BEGIN" + " PRIVATE KEY-----"), true);
});

test("secret: matches Slack tokens", () => {
  assert.equal(
    matchesSecret(
      "+" + "xoxb" + "-123456789012-123456789012-abcdefghijklmnopqrstuvwx",
    ),
    true,
  );
  assert.equal(
    matchesSecret(
      "+" + "xoxp" + "-123456789012-123456789012-abcdefghijklmnopqrstuvwx",
    ),
    true,
  );
});

test("secret: matches nvapi-", () => {
  assert.equal(
    matchesSecret("+" + "nvapi" + "-ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
    true,
  );
});

test("secret: does not match ordinary lines", () => {
  assert.equal(matchesSecret("+const x = 1;"), false);
  assert.equal(matchesSecret('+token: "placeholder"'), false);
  assert.equal(matchesSecret("+sk-short"), false);
});

test("secret: matches content regardless of diff prefix", () => {
  assert.equal(
    matchesSecret("-" + "ghp" + "_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"),
    true,
  );
  assert.equal(
    matchesSecret("+" + "ghp" + "_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"),
    true,
  );
});

test("shouldPause: pauses on fail", () => {
  assert.equal(shouldPause("fail"), true);
});

test("shouldPause: does not pause on pass", () => {
  assert.equal(shouldPause("pass"), false);
});

test("shouldPause: does not pause on unknown result", () => {
  assert.equal(shouldPause("error"), false);
});

test("githubAuthHeader: builds correct Authorization header", () => {
  const header = githubAuthHeader("mytoken");
  const expected =
    "Authorization: Basic " +
    Buffer.from("x-access-token:mytoken").toString("base64");
  assert.equal(header, expected);
});

test("githubAuthHeader: encodes token correctly", () => {
  const token = "abc123";
  const header = githubAuthHeader(token);
  assert.ok(header.startsWith("Authorization: Basic "));
  const encoded = header.slice("Authorization: Basic ".length);
  assert.equal(
    Buffer.from(encoded, "base64").toString(),
    "x-access-token:" + token,
  );
});

test("pendingCheckAction: no completed nodes returns none", () => {
  assert.equal(pendingCheckAction(0, false), "none");
  assert.equal(pendingCheckAction(0, true), "none");
});

test("pendingCheckAction: completed nodes when idle returns start", () => {
  assert.equal(pendingCheckAction(1, false), "start");
  assert.equal(pendingCheckAction(3, false), "start");
});

test("pendingCheckAction: completed nodes when busy returns queue", () => {
  assert.equal(pendingCheckAction(1, true), "queue");
  assert.equal(pendingCheckAction(5, true), "queue");
});

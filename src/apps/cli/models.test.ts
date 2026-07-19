import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runGetModels, type ModelInfo } from "./models.ts";

const CATALOG: ModelInfo[] = [
  {
    provider: "openai-codex",
    id: "gpt-5.5",
    name: "GPT-5.5",
    reasoning: true,
    contextWindow: 200000,
  },
  {
    provider: "anthropic",
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    reasoning: true,
    contextWindow: 1000000,
  },
];

describe("runGetModels", () => {
  test("lists all models with a count header and one line each", () => {
    const r = runGetModels({}, () => CATALOG);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout[0], "2 model(s):");
    assert.equal(r.stdout.length, 3);
    assert.ok(r.stdout.some((l) => l.includes("gpt-5.5")));
    assert.ok(r.stdout.some((l) => l.includes("claude-opus-4-8")));
  });

  test("passes the --provider filter through to the catalog function", () => {
    let seen: string | undefined = "unset";
    const r = runGetModels({ provider: "openai-codex" }, (p) => {
      seen = p;
      return CATALOG.filter((m) => m.provider === p);
    });
    assert.equal(seen, "openai-codex");
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.some((l) => l.includes("gpt-5.5")));
    assert.ok(!r.stdout.some((l) => l.includes("claude-opus-4-8")));
  });

  test("--json emits parseable JSON of the catalog", () => {
    const r = runGetModels({ json: true }, () => CATALOG);
    assert.equal(r.exitCode, 0);
    assert.deepEqual(JSON.parse(r.stdout.join("\n")), CATALOG);
  });

  test("empty catalog for a provider: exit 0 with an explanatory stderr line", () => {
    const r = runGetModels({ provider: "nope" }, () => []);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout.length, 0);
    assert.equal(r.stderr.length, 1);
    assert.ok(r.stderr[0]?.includes("nope"));
  });
});

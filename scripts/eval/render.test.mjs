import assert from "node:assert/strict";
import test from "node:test";
import { renderEvals } from "./render.mjs";

const result = (duration_ms, cost = 0.01) => ({
  input_tokens: 100,
  output_tokens: 50,
  cost,
  duration_ms,
});

const entryOf = (overrides = {}) => ({
  run: "20260101-120000",
  subject: "ops@1",
  engine_revision: "abc1234",
  configuration: {},
  prompt_digests: [
    { layer: 0, source: "base", digest: "0123456789abcdef0123456789abcdef" },
  ],
  repeat: 3,
  comparison: { regressed: [], improved: [], new: [], dropped: [] },
  cases: [
    {
      case_id: "alpha",
      case_digest: "d1",
      pass_rate: 1,
      runs: [result(100), result(200), result(300)],
    },
  ],
  ...overrides,
});

const rowsOf = (html, tableIndex) => {
  const tables = html.split('<div class="table-wrap">').slice(1);
  const body = tables[tableIndex].split("<tbody>")[1].split("</tbody>")[0];
  return body
    .split("</tr>")
    .filter((row) => row.includes("<td>"))
    .map((row) =>
      [...row.matchAll(/<td>(.*?)<\/td>/gs)].map((match) => match[1]),
    );
};

test("two entries of one subject give two ordered rows and the p50", () => {
  const second = entryOf({
    run: "20260102-120000",
    cases: [
      {
        case_id: "alpha",
        case_digest: "d1",
        pass_rate: 0.5,
        rerun_pass_rate: 1,
        runs: [result(100), result(200), result(300), result(400)],
      },
    ],
    comparison: {
      regressed: ["alpha"],
      improved: ["beta", "gamma"],
      new: [],
      dropped: [],
    },
  });
  const html = renderEvals([[entryOf(), second]]);
  assert.equal(html.split("<h2 ").length, 2);
  const rows = rowsOf(html, 0);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][0], "2026-01-01 12:00:00");
  assert.equal(rows[1][0], "2026-01-02 12:00:00");
  assert.equal(rows[0][2], "0123456789ab");
  assert.equal(rows[0][3], "1/1");
  assert.equal(rows[1][3], "1/1");
  assert.deepEqual(rows[1].slice(4, 6), ["1", "2"]);
  assert.equal(rows[0][6], "450");
  assert.equal(rows[0][7], "0.03");
  assert.equal(rows[0][8], "200");
  assert.equal(rows[1][8], "250");
});

test("a case absent from the first entry shows a dash", () => {
  const second = entryOf({
    run: "20260102-120000",
    cases: [
      ...entryOf().cases,
      { case_id: "beta", case_digest: "d2", pass_rate: 0.5, runs: [] },
    ],
  });
  const rows = rowsOf(renderEvals([[entryOf(), second]]), 1);
  assert.deepEqual(rows[0], ["alpha", "1", "1"]);
  assert.deepEqual(rows[1], ["beta", "–", "0.5"]);
});

test("two subjects give two sections in name order", () => {
  const html = renderEvals([
    [entryOf({ subject: "swe@1" })],
    [entryOf({ subject: "ops@1" })],
  ]);
  const headings = [...html.matchAll(/<h2 id="([^"]+)">([^<]+)<\/h2>/g)];
  assert.deepEqual(
    headings.map((match) => [match[1], match[2]]),
    [
      ["ops-1", "ops@1"],
      ["swe-1", "swe@1"],
    ],
  );
  assert.ok(html.indexOf('<li><a href="#ops-1">') < html.indexOf("#swe-1"));
  assert.ok(html.includes('<li><a href="#swe-1">swe@1</a></li>'));
});

test("no history gives the empty notice and the page frame", () => {
  const html = renderEvals([]);
  assert.ok(html.includes("<p>No recorded run.</p>"));
  assert.ok(html.includes('href="../../assets/base.css"'));
  assert.ok(html.includes('href="../../assets/reference.css"'));
  assert.ok(html.includes('href="../index.html"'));
  assert.ok(html.includes('<li><a href="#agent-evaluations">'));
  const withHistory = renderEvals([[entryOf()]]);
  const tables = withHistory.match(/<table>/g).length;
  assert.equal(withHistory.match(/<div class="table-wrap">/g).length, tables);
  assert.equal(tables, 2);
});

test("the output holds no reply text and no detail", () => {
  const entry = entryOf();
  entry.cases[0].runs[0].checks = [
    { kind: "reply", passed: false, detail: "SECRET-REPLY-TEXT" },
  ];
  entry.cases[0].detail = "SECRET-REPLY-TEXT";
  const html = renderEvals([[entry]]);
  assert.ok(!html.includes("SECRET-REPLY-TEXT"));
  assert.ok(!/\bdetail\b/.test(html));
});

test("a value from a history file is escaped", () => {
  const entry = entryOf({ engine_revision: 'a<b&c"d' });
  entry.cases[0].case_id = 'x<y&z"w';
  const html = renderEvals([[entry]]);
  assert.ok(html.includes("a&lt;b&amp;c&quot;d"));
  assert.ok(html.includes("x&lt;y&amp;z&quot;w"));
  assert.ok(!html.includes("a<b"));
  assert.ok(!html.includes("x<y"));
});

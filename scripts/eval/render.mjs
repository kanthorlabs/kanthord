import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HISTORY_DIR = join(REPO, "docs/reference/agent/evals");
const PAGE = join(REPO, "docs/reference/agent/evals.html");
const PASS_RATE_THRESHOLD = 2 / 3;
const DIGEST_LENGTH = 12;
const COST_DECIMALS = 4;
const RUN_FORMAT = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;
const ABSENT = "–";
const PAGE_ANCHOR = "agent-evaluations";

const escape = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const table = (headings, rows) => [
  '<div class="table-wrap">',
  "<table>",
  "<thead>",
  "<tr>",
  ...headings.map((heading) => `<th>${heading}</th>`),
  "</tr>",
  "</thead>",
  `<tbody>${rows
    .map((row) =>
      ["<tr>", ...row.map((value) => `<td>${value}</td>`), "</tr>"].join("\n"),
    )
    .join("\n")}`,
  "</tbody></table>",
  "</div>",
];

const anchorOf = (subject) => subject.replace(/[^a-z0-9]/g, "-");

function runDate(run) {
  const match = RUN_FORMAT.exec(run);
  if (!match) throw new Error(`The run ${run} is not yyyymmdd-HHMMSS.`);
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

const resultsOf = (entry) =>
  entry.cases.flatMap((value) => [...value.runs, ...(value.reruns ?? [])]);

const sum = (values) => values.reduce((total, value) => total + value, 0);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function casePassed(value) {
  const rerun = value.rerun_pass_rate ?? null;
  return (
    value.pass_rate >= PASS_RATE_THRESHOLD ||
    (rerun !== null && rerun >= PASS_RATE_THRESHOLD)
  );
}

function runRow(entry) {
  const results = resultsOf(entry);
  const tokens = sum(
    results.map((result) => result.input_tokens + result.output_tokens),
  );
  const cost = sum(results.map((result) => result.cost));
  return [
    escape(runDate(entry.run)),
    escape(entry.engine_revision),
    entry.prompt_digests
      .map((prompt) => escape(prompt.digest.slice(0, DIGEST_LENGTH)))
      .join(" "),
    `${escape(entry.cases.filter(casePassed).length)}/${escape(entry.cases.length)}`,
    escape(entry.comparison.regressed.length),
    escape(entry.comparison.improved.length),
    escape(tokens),
    escape(Number(cost.toFixed(COST_DECIMALS))),
    escape(median(results.map((result) => result.duration_ms))),
  ];
}

function caseRows(entries) {
  const ids = [
    ...new Set(entries.flatMap((entry) => entry.cases.map((v) => v.case_id))),
  ].sort();
  return ids.map((id) => [
    escape(id),
    ...entries.map((entry) => {
      const found = entry.cases.find((value) => value.case_id === id);
      return found ? escape(found.pass_rate) : ABSENT;
    }),
  ]);
}

function subjectSection(subject, entries) {
  return [
    `<h2 id="${anchorOf(subject)}">${escape(subject)}</h2>`,
    ...table(
      [
        "Run (UTC)",
        "Engine revision",
        "Prompt digests",
        "Passed cases",
        "Regressed",
        "Improved",
        "Tokens",
        "Cost",
        "p50 duration (ms)",
      ],
      entries.map(runRow),
    ),
    ...table(
      ["Case", ...entries.map((entry) => escape(runDate(entry.run)))],
      caseRows(entries),
    ),
  ];
}

export function renderEvals(histories) {
  const subjects = histories
    .filter((entries) => entries.length > 0)
    .map((entries) => ({ subject: entries[0].subject, entries }))
    .sort((a, b) =>
      a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0,
    );
  const tocItems = subjects.length
    ? subjects.map(
        ({ subject }) =>
          `<li><a href="#${anchorOf(subject)}">${escape(subject)}</a></li>`,
      )
    : [`<li><a href="#${PAGE_ANCHOR}">Agent evaluations</a></li>`];
  const lines = [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "    <title>Agent evaluations · KanthorD</title>",
    '    <link rel="preconnect" href="https://fonts.googleapis.com" />',
    '    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
    '    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&amp;family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700;9..40,800&amp;display=swap" />',
    '    <link rel="stylesheet" href="../../assets/base.css" />',
    '    <link rel="stylesheet" href="../../assets/reference.css" />',
    "  </head>",
    '  <body class="reference">',
    '    <header class="site-header">',
    '      <a class="brand" href="../../index.html"><img src="../../assets/logo/logo.svg" alt="" width="28" height="28" />KanthorD</a>',
    '      <nav aria-label="Sections">',
    '        <a href="../../tutorials/index.html">Tutorials</a>',
    '        <a href="../../how-to-guides/index.html">How-to guides</a>',
    '        <a href="../../reference/index.html" aria-current="true">Reference</a>',
    '        <a href="../../explanation/index.html">Explanation</a>',
    "      </nav>",
    "    </header>",
    '    <div class="page has-toc">',
    '      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="../../index.html">Home</a> / <a href="../index.html">Reference</a></nav>',
    '      <details class="toc">',
    "        <summary>On this page</summary>",
    "        <ul>",
    ...tocItems,
    "        </ul>",
    "      </details>",
    "      <main>",
    "        <article>",
    `<h1 id="${PAGE_ANCHOR}">Agent evaluations</h1>`,
    "<p><code>scripts/eval/render.mjs</code> generates the page from <code>docs/reference/agent/evals/&lt;subject&gt;.json</code>. <code>make eval</code> compares a run with the latest entry. <code>make eval ACCEPT=1</code> appends a run.</p>",
  ];
  if (subjects.length === 0) lines.push("<p>No recorded run.</p>");
  for (const { subject, entries } of subjects)
    lines.push(...subjectSection(subject, entries));
  lines.push(
    "        </article>",
    "      </main>",
    "    </div>",
    '    <footer class="site-footer">KanthorD documentation · <a href="https://github.com/kanthorlabs/kanthord">GitHub</a></footer>',
    '    <script type="module" src="../../assets/page.mjs"></script>',
    "  </body>",
    "</html>",
  );
  return `${lines.join("\n")}\n`;
}

function readHistories() {
  if (!existsSync(HISTORY_DIR)) return [];
  return readdirSync(HISTORY_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(HISTORY_DIR, name), "utf8")));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(PAGE, renderEvals(readHistories()));
  process.stdout.write(`${PAGE}\n`);
}

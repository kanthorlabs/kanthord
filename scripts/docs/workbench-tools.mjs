import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ENGINE = join(REPO, "engine/src");
const PAGE = join(REPO, "docs/reference/workbench/tools.html");
const CHECK_FLAG = "--check";

const CONTRACTS = [
  ["agent", ["agentOperations"]],
  ["footprint", ["footprintOperations"]],
  ["gateway", ["gatewayOperations"]],
  ["intake", ["intakeOperations", "intakeCredentialOperations"]],
  ["llm", ["llmOperations"]],
  ["mission", ["missionOperations"]],
  ["project", ["projectOperations", "environmentSecretOperations"]],
  ["repository", ["repositoryOperations"]],
  ["scheduler", ["schedulerOperations"]],
  ["storage", ["storageOperations"]],
  ["tracking", ["trackingOperations"]],
  ["workbench", ["workbenchOperations"]],
  ["worker", ["workerOperations"]],
];

const escape = (text) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const inline = (text) =>
  escape(text.replaceAll("\n", " ")).replace(/`([^`]+)`/g, "<code>$1</code>");

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

async function sections() {
  const { toolOperations, toolName } = await import(
    join(ENGINE, "workbench/tools.ts")
  );
  const { AGENT_DECLARATIONS } = await import(join(ENGINE, "agent/catalog.ts"));
  const { ACTION_CARD_OPERATIONS } = await import(
    join(ENGINE, "workbench/actions.ts")
  );
  const operations = [];
  for (const [directory, exportNames] of CONTRACTS) {
    const contract = await import(join(ENGINE, directory, "contract.ts"));
    for (const exportName of exportNames) {
      assert.ok(
        contract[exportName],
        `${directory}/contract.ts exports ${exportName}`,
      );
      operations.push(...Object.values(contract[exportName]));
    }
  }
  const actions = Object.entries(ACTION_CARD_OPERATIONS).map(([id, target]) => {
    assert.ok(
      operations.some((operation) => operation.id === id),
      `ACTION_CARD_OPERATIONS lists ${id}, which resolves to no operation`,
    );
    return { id, target };
  });
  const result = [];
  for (const agent of Object.values(AGENT_DECLARATIONS)) {
    const listed = agent.tools.operation;
    if (listed.length === 0) continue;
    const tools = toolOperations(operations, listed).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    for (const id of listed)
      assert.ok(
        tools.some((tool) => tool.id === id),
        `${agent.agent_name} lists ${id}, which resolves to no eligible operation`,
      );
    result.push({
      title: `${agent.display_name} (${agent.agent_name})`,
      anchor: agent.agent_name.replace(/[^a-z0-9]+/g, "-"),
      tools,
      toolName,
    });
  }
  return { groups: result, actions };
}

function render({ groups, actions }) {
  const anchor = (group) => group.anchor;
  const offerTitle = "Workbench tool <code>offer_action</code>";
  const lines = [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "    <title>Workbench operation tools · KanthorD</title>",
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
    '      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="../../index.html">Home</a> / <a href="../../reference/index.html">Reference</a></nav>',
    '      <details class="toc">',
    "        <summary>On this page</summary>",
    "        <ul>",
    ...groups.map(
      (group) =>
        `          <li><a href="#${anchor(group)}">${group.title}</a></li>`,
    ),
    `          <li><a href="#offer-action">${offerTitle}</a></li>`,
    "        </ul>",
    "      </details>",
    "      <main>",
    "        <article>",
    '<h1 id="workbench-operation-tools">Workbench operation tools</h1>',
    "<!-- Generated by scripts/docs/workbench-tools.mjs. Run `make docs-tools` after an operation change. Do not edit by hand. -->",
    "",
    `<p>Each Workbench agent holds only the operation tools that its declaration lists. A tool that changes state waits for the approval of the human. <a href="../../explanation/native-agent.html#tools">How the native agent works</a> explains the selection rule and the exclusions.</p>`,
    "<p>The tool name is the operation id with each <code>.</code> replaced by <code>--</code>. A tool runs with the identity of the human who sent the last message.</p>",
    ...table(
      ["Agent", "Tools", "Change state"],
      groups.map((group) => [
        `<a href="#${anchor(group)}">${group.title}</a>`,
        String(group.tools.length),
        String(group.tools.filter((tool) => tool.mutation).length),
      ]),
    ),
  ];
  for (const group of groups) {
    lines.push(
      `<h2 id="${anchor(group)}">${group.title}</h2>`,
      ...table(
        ["Tool", "Route", "Approval", "Description"],
        group.tools.map((tool) => [
          `<code>${escape(group.toolName(tool.id))}</code>`,
          `<code>${escape(`${tool.method} ${tool.path}`)}</code>`,
          tool.mutation ? "Yes" : "No",
          inline(tool.description),
        ]),
      ),
    );
  }
  lines.push(
    `<h2 id="offer-action">${offerTitle}</h2>`,
    "<p>Every Workbench agent also holds the tool <code>offer_action</code>. The tool runs nothing. It shows one action card in the chat, and the owner decides whether the act runs. It needs no approval, because it is no operation.</p>",
    "<p>A run offers one card. A second call in the same run fails.</p>",
    ...table(
      ["Parameter", "Description"],
      [
        [
          "<code>operation_id</code>",
          "The act of the card. One of the ids in the table below.",
        ],
        [
          "<code>target_id</code>",
          "The identity of the node or the project of the act.",
        ],
      ],
    ),
    ...table(
      ["Operation", "Target"],
      actions.map(({ id, target }) => [
        `<code>${escape(id)}</code>`,
        escape(target),
      ]),
    ),
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

const page = render(await sections());
if (process.argv.includes(CHECK_FLAG)) {
  let current = "";
  try {
    current = readFileSync(PAGE, "utf8");
  } catch {}
  if (current !== page) {
    process.stderr.write(
      "docs/reference/workbench/tools.html is stale. Run make docs-tools\n",
    );
    process.exit(1);
  }
} else {
  mkdirSync(dirname(PAGE), { recursive: true });
  writeFileSync(PAGE, page);
  process.stdout.write(`${PAGE}\n`);
}

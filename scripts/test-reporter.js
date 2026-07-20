import { inspect } from "node:util";
import { relative } from "node:path";

const cwd = process.cwd();

function cleanFile(file) {
  if (!file) return "";
  const path = file.replace(/^file:\/\//, "");
  return relative(cwd, path) || path;
}

function formatError(err) {
  if (!err) return "";
  const parts = [];

  if (err.stack) {
    parts.push(
      err.stack
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n"),
    );
  } else if (err.message) {
    parts.push(`  ${err.message}`);
  }

  const skip = new Set(["stack", "message", "name"]);
  const extras = Object.entries(err).filter(([k]) => !skip.has(k));
  if (extras.length) {
    parts.push("  {");
    for (const [k, v] of extras) {
      parts.push(`    ${k}: ${inspect(v)},`);
    }
    parts.push("  }");
  }

  return parts.join("\n");
}

export default async function* (source) {
  const failures = [];
  let summary = null;
  const counts = {
    tests: 0,
    suites: 0,
    passed: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
  };
  let startMs = Date.now();
  const files = new Set();

  for await (const event of source) {
    switch (event.type) {
      case "test:enqueue":
        if (event.data.nesting === 0 && event.data.file) {
          files.add(cleanFile(event.data.file));
        }
        break;
      case "test:fail":
        counts.failed++;
        counts.tests++;
        if (event.data.details?.error?.failureType !== "subtestsFailed") {
          failures.push(event.data);
        }
        break;
      case "test:pass":
        counts.passed++;
        counts.tests++;
        break;
      case "test:skip":
        counts.skipped++;
        counts.tests++;
        break;
      case "test:todo":
        counts.todo++;
        counts.tests++;
        break;
      case "test:summary":
        summary = event.data;
        break;
    }
  }

  const c = summary ? summary.counts : counts;
  const duration = summary ? summary.duration_ms : Date.now() - startMs;
  const passed = summary ? c.passed : counts.passed;
  const failed = summary ? c.failed : counts.failed;

  yield `node:test  ${process.version}  ${files.size} file${files.size !== 1 ? "s" : ""}\n`;
  yield `tests: ${c.tests ?? counts.tests} suites: ${c.suites ?? 0} pass: ${passed} fail: ${failed} cancelled: ${c.cancelled ?? 0} skipped: ${c.skipped ?? counts.skipped} todo: ${c.todo ?? counts.todo} duration_ms: ${duration}\n`;

  for (const { name, details, line, column, file } of failures) {
    const loc = [cleanFile(file), line, column]
      .filter((v) => v != null && v !== "")
      .join(":");
    yield `\ntest at ${loc}\n`;
    yield `✖ ${name} (${details.duration_ms}ms)\n`;
    const formatted = formatError(details.error);
    if (formatted) yield `${formatted}\n`;
  }
}

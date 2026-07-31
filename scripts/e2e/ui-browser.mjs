// ui-browser.mjs — the shared browser driver for every UI epic's Proof
// (EPIC 026 decision 10, EPIC 026.1 decision 1).
//
// A UI Proof must open the REAL served build in a REAL browser: jsdom does not
// execute `<script type="module">`, which is exactly what a Vite build emits.
//
// Read-only over the network: it talks to the loopback daemon only. The pinned
// Chromium must already be installed; this module never downloads it and says
// exactly how to install it when it is missing.
//
// Usage from a proof script:
//   node scripts/e2e/ui-browser.mjs --base=http://127.0.0.1:PORT --key=KEY \
//        --script=/path/to/steps.mjs
// `steps.mjs` default-exports `async ({ page, context, goto, text, count,
// visible, consoleErrors, requests, responses, base }) => { ... }` and throws
// to fail the phase.

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const i = a.indexOf("=");
      return i === -1 ? [a.slice(2), "true"] : [a.slice(2, i), a.slice(i + 1)];
    }),
);

for (const required of ["base", "key", "script"]) {
  if (!args[required]) {
    console.error(`ui-browser: --${required}= is required`);
    process.exit(2);
  }
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "ui-browser: the 'playwright' package is not installed.\n" +
      "  EPIC 026 decision 9 installs it: npm install --save-dev playwright@1.62.0",
  );
  process.exit(2);
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (err) {
  console.error(
    "ui-browser: Chromium is not installed for Playwright.\n" +
      "  Install it once, outside the Proof (the Proof itself makes no network request):\n" +
      "    npx playwright install chromium\n" +
      `  Underlying error: ${err.message.split("\n")[0]}`,
  );
  process.exit(2);
}

const consoleErrors = [];
const requests = [];
const responses = [];
let exitCode = 0;

try {
  const context = await browser.newContext({
    httpCredentials: { username: "kanthord", password: args.key },
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("request", (req) => {
    requests.push({
      url: req.url(),
      method: req.method(),
      // Basic auth is added by the context, not by page code. R3 says no
      // ui/ module may set this header, so the proof inspects what the PAGE
      // asked for, before the context's credential is applied.
      authorization: req.headers()["authorization"] ?? null,
      fromPage: req.frame() !== null,
    });
  });
  // Status codes the PAGE saw. A 412 conflict proof needs the response, not
  // only the request: fetch() does not reject on 4xx, so the app must read
  // response.status itself and the Proof must be able to check it did.
  page.on("response", (res) => {
    responses.push({
      url: res.url(),
      status: res.status(),
      method: res.request().method(),
      etag: res.headers()["etag"] ?? null,
    });
  });

  // A cold load at a hash: the browser must resolve the whole route from the
  // URL, exactly as a shared deep link does. Never a client-side navigation.
  // Optional waitFor: after networkidle, wait for a selector to be visible
  // before returning (fixes React concurrent commit races).
  const goto = async (hash, waitFor) => {
    const url = hash
      ? `${args.base}/${hash.startsWith("#") ? hash : `#${hash}`}`
      : `${args.base}/`;
    await page.goto(url, { waitUntil: "networkidle" });
    if (waitFor) {
      await page
        .locator(waitFor)
        .first()
        .waitFor({ state: "visible", timeout: 10_000 });
    }
  };
  const text = async (selector) =>
    (await page.locator(selector).first().innerText()).trim();
  const count = async (selector) => page.locator(selector).count();
  const visible = async (selector) =>
    page.locator(selector).first().isVisible();

  const steps = (await import(args.script)).default;
  await steps({
    page,
    context,
    goto,
    text,
    count,
    visible,
    consoleErrors,
    requests,
    responses,
    base: args.base,
  });
  console.log("ui-browser: steps passed");
} catch (err) {
  console.error(`ui-browser: FAILED — ${err.stack ?? err.message}`);
  if (consoleErrors.length > 0) {
    console.error(
      `ui-browser: page console errors:\n  ${consoleErrors.join("\n  ")}`,
    );
  }
  exitCode = 1;
} finally {
  await browser.close();
}

process.exit(exitCode);
